import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// Served from https://imshaikot.github.io/browsentic/ — every asset URL needs that prefix.
// Override with BASE_PATH=/ when serving from a custom domain at the apex.
const base = process.env.BASE_PATH ?? '/browsentic/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
})
