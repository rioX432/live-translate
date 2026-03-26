import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    ignores: ['dist/', 'out/', 'node_modules/', 'chrome-extension/', 'benchmark/', 'src/renderer/public/vad/**']
  },
  // Preload scripts are compiled to CommonJS — allow exports/require globals
  {
    files: ['src/preload/**/*.js'],
    languageOptions: {
      globals: {
        exports: 'writable',
        require: 'readonly',
        module: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly'
      }
    }
  },
  {
    rules: {
      // Allow unused vars prefixed with _
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      // Allow explicit any for flexibility during migration
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow require() for Node.js/Electron native modules
      '@typescript-eslint/no-require-imports': 'off',
      // Disable preserve-caught-error — too strict for existing codebase
      'preserve-caught-error': 'off'
    }
  }
)
