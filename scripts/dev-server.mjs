/**
 * `beforeDevCommand` for Tauri. Vite is pinned to a strict port, so starting the
 * shell beside a running dev server would fail on "port in use"; reusing it lets
 * the desktop window and the browser tab share one HMR stream.
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
