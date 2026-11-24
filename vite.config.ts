import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// Git Bash on Windows starts Node with a lower-case drive ("c:\..."), while package resolution returns "C:\...".
// Rollup treats the two spellings as different modules and bundles React twice (blank page, "reading useRef").
// One spelling for every path this config hands to Vite avoids that; macOS and Linux paths are unchanged.
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url)).replace(/^[a-z]:/, (drive) => drive.toUpperCase())

export default defineConfig({
  root: r('./client'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@core': r('./core'),
      '@': r('./client/src'),
    },
  },
  server: {
    port: 5173,
    // changeOrigin must stay false: the API compares Origin with Host (CSRF guard), and rewriting Host to the API port
    // would make every POST/PUT from the dev server look cross-origin.
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.SALES_PULSE_API_PORT ?? 8787}`, changeOrigin: false } },
  },
  build: {
    outDir: r('./dist/client'),
    emptyOutDir: true,
    // The two chart libraries are lazy chunks of their own (ApexCharts ~960 kB, Highcharts Maps + topology ~550 kB,
    // both before gzip); the entry chunk stays ~240 kB. The default 500 kB warning would only flag those vendors.
    chunkSizeWarningLimit: 1000,
  },
})
