import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'benchmark/conversational-ja-en/**/*.test.ts'],
    globals: true
  }
})
