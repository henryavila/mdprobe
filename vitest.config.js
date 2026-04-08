import { defineConfig } from 'vitest/config'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{js,jsx}'],
    environmentMatchGlobs: [
      ['tests/**/*.test.jsx', 'happy-dom'],
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js', 'bin/**/*.js'],
      exclude: ['src/ui/**'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    testTimeout: 15000,
    hookTimeout: 15000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,
  },
})
