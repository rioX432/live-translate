// Kept separate from the root config so the bench harness stays self-contained:
//   npx vitest run --config benchmark/e2e/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['benchmark/e2e/**/*.test.ts'],
    root: new URL('../..', import.meta.url).pathname
  }
})
