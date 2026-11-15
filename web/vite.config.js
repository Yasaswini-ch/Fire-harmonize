import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Lists every built file; the "Save offline" button reads it to know what to cache.
  build: { manifest: 'asset-manifest.json' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
    // The default worker pool crashes on this machine ("Cannot read properties of undefined (reading 'config')").
    // vmThreads works. Known gap: Analytics.test.jsx cannot load recharts under it (ESM-only dependencies).
    pool: 'vmThreads',
  },
})
