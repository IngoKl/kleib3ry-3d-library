import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri drives this dev server, so the port and host must be predictable.
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
  // Vite must not obscure Rust errors, and src-tauri is not frontend source.
  clearScreen: false,
  server: {
    port: 5180,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 5181 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    // WebView2 on Windows is evergreen Chromium; no need to down-level.
    target: 'chrome110',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // Leave the minifier to Vite (oxc); naming esbuild explicitly hits a
    // deprecated path that is no longer bundled.
    minify: !process.env.TAURI_ENV_DEBUG,
  },
})
