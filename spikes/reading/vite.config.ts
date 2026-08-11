import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5183, strictPort: true },
  // pdf.js ships its worker as a separate ESM entry; keep it out of optimizeDeps
  // so the ?url import resolves to a real file rather than a prebundled chunk.
  optimizeDeps: { exclude: ['pdfjs-dist'] },
})
