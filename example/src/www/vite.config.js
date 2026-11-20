import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In production CloudFront serves this app and the API from one origin. In development, Vite forwards
// /api to a deployed stack: API_URL=$(pulumi stack output apiUrl) npm run dev
const apiUrl = process.env.API_URL?.replace(/\/$/, '')

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'build' },
  server: apiUrl ? { proxy: { '/api': { target: apiUrl, changeOrigin: true } } } : {},
})
