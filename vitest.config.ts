import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'benchmark/conversational-ja-en/**/*.test.ts',
      'benchmark/gpt-realtime-whisper-eval/**/*.test.ts'
    ],
    globals: true
  }
})
