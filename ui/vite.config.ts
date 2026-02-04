import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:7890',
      '/ws': {
        target: 'http://localhost:7890',
        ws: true,
      },
      '/uploads': 'http://localhost:7890',
      '/health': 'http://localhost:7890',
    },
  },
  base: '/admin/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
