/**
 * `beforeDevCommand` for Tauri.
 *
 * Starting the desktop shell while a browser dev server is already running used
 * to fail on "port in use", because Vite is pinned to a strict port. Reuse the
 * running server instead: the desktop window and the browser tab then share one
 * Vite process and one HMR stream.
 */
import { spawn } from 'node:child_process'

const PORT = Number(process.env.VITE_PORT ?? 5180)
const URL = `http://localhost:${PORT}/`

async function isUp() {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 800)
    const res = await fetch(URL, { signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

if (await isUp()) {
  console.log(`[dev-server] reusing the Vite server already on ${URL}`)
  process.exit(0)
}

console.log(`[dev-server] starting Vite on ${URL}`)
const vite = spawn('npm', ['run', 'dev'], { stdio: 'inherit', shell: true })
vite.on('exit', (code) => process.exit(code ?? 0))

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => vite.kill())
}
