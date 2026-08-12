/**
 * End-to-end check of the built desktop app.
 *
 * The browser smoke tests can only exercise the `browser` driver, so they never
 * touch IPC, the CSP, WebView2, or the real indexer. This launches the actual
 * executable with WebView2's remote debugging port open, attaches over CDP, and
 * drives a full scan → shelve → read cycle against a library folder.
 *
 * It restores whatever library folder was configured before it ran, and it
 * never writes to the library folder itself.
 *
 *   node scripts/probe-desktop.mjs [libraryFolder] [pathToExe]
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2).filter((a) => a !== '--keep')
/** Leave the library folder configured instead of restoring the previous one. */
const keep = process.argv.includes('--keep')
const libraryFolder = resolve(args[0] ?? 'C:/tmp/kleib3ry-test-library')
const exe = args[1] ?? resolve(root, 'src-tauri/target/release/kleib3ry.exe')
const PORT = 9223

if (!existsSync(exe)) {
  console.error(`no executable at ${exe} — run \`npm run tauri:build\` first`)
  process.exit(1)
}
if (!existsSync(libraryFolder)) {
  console.error(`no library folder at ${libraryFolder}`)
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function findPageTarget(deadlineMs = 30_000) {
  const started = Date.now()
  while (Date.now() - started < deadlineMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // WebView2 has not opened the port yet.
    }
    await sleep(500)
  }
  throw new Error(`no CDP page target on port ${PORT} within ${deadlineMs}ms`)
}

class Cdp {
  #ws
  #id = 0
  #pending = new Map()

  constructor(ws) {
    this.#ws = ws
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      const entry = this.#pending.get(msg.id)
      if (!entry) return
      this.#pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(msg.error.message))
      else entry.resolve(msg.result)
    })
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', () => rej(new Error('CDP socket failed')), { once: true })
    })
    return new Cdp(ws)
  }

  send(method, params = {}) {
    const id = ++this.#id
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    }
    return result.value
  }

  /**
   * Evaluate and bring the value back as JSON. Wrapped in `Promise.resolve` so
   * this works for both sync expressions and invokes — stringifying a pending
   * promise directly yields `{}`, which looks like a successful empty result.
   */
  json(expression) {
    return this.evaluate(
      `Promise.resolve(${expression}).then(v => JSON.stringify(v ?? null))`,
    ).then((v) => (v === undefined ? undefined : JSON.parse(v)))
  }

  close() {
    this.#ws.close()
  }
}

const child = spawn(exe, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: 'ignore',
})

const failures = []
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(name)
}

let cdp
let previousRoot
try {
  const target = await findPageTarget()
  cdp = await Cdp.connect(target.webSocketDebuggerUrl)

  // Poll in short bursts rather than one long-lived evaluate: the WebView
  // navigates to the app shortly after the target appears, and any evaluate
  // spanning that navigation dies with "execution context was destroyed".
  let booted = false
  for (let attempt = 0; attempt < 120 && !booted; attempt++) {
    booted = await cdp.evaluate('Boolean(window.__app && window.__app.ready())').catch(() => false)
    if (!booted) await sleep(250)
  }
  if (!booted) throw new Error('the app never became ready')
  await sleep(1500)

  const invoke = (cmd, args = {}) =>
    cdp.json(
      `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`,
    )

  const stats = await cdp.json('window.__app.stats()')
  check('window opens and the app boots', true, target.title)
  check('Tauri bridge detected', stats.driver === 'tauri', `driver=${stats.driver}`)
  check('scene rasterised in WebView2', stats.triangles > 1000, `${stats.triangles} triangles`)
  check(
    'render loop running',
    stats.frames > 30,
    `${stats.frames} frames, ${stats.fps.toFixed(0)} fps`,
  )

  // --- indexing ---------------------------------------------------------
  previousRoot = await invoke('get_library_root')
  await invoke('set_library_root', { path: libraryFolder })
  check('library folder accepted', true, libraryFolder)

  const summary = await invoke('scan_library')
  check(
    'scan found books',
    summary.found > 0,
    `${summary.found} found, ${summary.added} added, ${summary.failed} unreadable`,
  )
  check('nothing failed to index', summary.failed === 0, `failed=${summary.failed}`)

  const books = await invoke('list_books')
  check('books listed with titles', books.length > 0 && books.every((b) => b.title), `${books.length} books`)

  // The generated library keeps a PDF in `music/` precisely so this can fail:
  // a scan reads `books/` and leaves the rest of the folder alone.
  const strays = books.filter((b) => /[\\/](music|artwork)[\\/]/i.test(b.path))
  check('only the books folder was indexed', strays.length === 0, strays.map((b) => b.path).join(', '))

  const epubs = books.filter((b) => b.format === 'epub')
  const withCovers = epubs.filter((b) => b.cover)
  check(
    'EPUB covers extracted during the scan',
    epubs.length === 0 || withCovers.length > 0,
    `${withCovers.length}/${epubs.length} epubs have a cover`,
  )

  const titled = books.find((b) => b.author)
  check('metadata read from inside the files', Boolean(titled), titled && `${titled.title} — ${titled.author}`)

  // --- the scene picked the real books up -------------------------------
  await cdp.json('window.__app.reloadLibrary()')
  await sleep(1500)
  const after = await cdp.json('window.__app.stats()')
  check(
    'real books arrived in the boxes',
    after.books > 0 && after.boxed === after.books,
    `${after.boxed} boxed of ${after.books}`,
  )

  // A library arrives boxed; unpacking one is what puts books on the shelves.
  const boxes = await cdp.json('window.__app.boxIds()')
  await cdp.json(`window.__app.emptyBoxForTest(${JSON.stringify(boxes?.[0] ?? '')})`)
  await sleep(800)
  const unpacked = await cdp.json('window.__app.stats()')
  check(
    'unpacking a box puts real books on the shelves',
    unpacked.shelved > 0,
    `${unpacked.shelved} shelved of ${unpacked.books}`,
  )

  // --- reading ----------------------------------------------------------
  const pdf = books.find((b) => b.format === 'pdf')
  if (pdf) {
    const reader = await cdp.json(`window.__app.readForTest(${JSON.stringify(pdf.id)})`)
    check('a real PDF opens in the reader', reader?.pages > 0, reader && `${pdf.title}: ${reader.pages} pages`)
    check('the first page rasterised', reader?.rendered === true, JSON.stringify(reader))
  } else {
    check('a real PDF opens in the reader', false, 'no PDF in the library folder')
  }

  const errors = await cdp.json('window.__pageErrors ?? []')
  check('no uncaught page errors', (errors ?? []).length === 0, JSON.stringify(errors))
} catch (err) {
  check('desktop probe', false, err.message)
} finally {
  // Put the user's own setting back, whatever happened.
  if (keep) {
    console.log(`\nleaving the library folder set to ${libraryFolder}`)
  } else if (cdp && previousRoot !== undefined) {
    await cdp
      .json(
        `window.__TAURI_INTERNALS__.invoke('set_library_root', ${JSON.stringify({
          path: previousRoot ?? null,
        })})`,
      )
      .then(() => console.log(`\nrestored library folder to ${previousRoot ?? 'none'}`))
      .catch((e) => console.error(`could not restore library folder: ${e.message}`))
  }
  cdp?.close()
  child.kill()
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall desktop checks passed')
