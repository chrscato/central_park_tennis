import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Relative base so the static build works from any host path.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { sourcemap: false },
  test: { environment: 'node' },
})
