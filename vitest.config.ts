import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts', 'next.config.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
    // Loads .env.local into each worker (Vitest, unlike Next.js, does not).
    setupFiles: ['./vitest.setup.ts'],
    // Migrates the test database once, before any test file runs.
    globalSetup: ['./vitest.global-setup.ts'],
    // The tests share one Postgres, so they must not run concurrently: files
    // insert, read and delete the same rows, and Vitest parallelises across
    // files by default. Serial execution is the cheap, honest fix.
    fileParallelism: false,
  },
})
