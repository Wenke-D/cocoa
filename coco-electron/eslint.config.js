// The gate the Rust tree had as clippy, and this one did not have at all.
//
// Type-aware rules are on: the point of the strict ones below is the class of
// bug `npm run check` cannot see — a floating promise in the main process, an
// `any` that quietly turns a typed boundary back into JSON. Formatting is
// Prettier's job, so `eslint-config-prettier` turns off everything stylistic
// rather than have the two argue.

import js from '@eslint/js'
import ts from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default ts.config(
  {
    ignores: [
      'node_modules/',
      'out/',
      'dist/',
      'release/',
      '.drive/',
      'coverage/',
      '*.config.js',
      'svelte.config.mjs'
    ]
  },

  js.configs.recommended,
  ...ts.configs.recommendedTypeChecked,
  ...svelte.configs['flat/recommended'],
  prettier,
  ...svelte.configs['flat/prettier'],

  {
    languageOptions: {
      parserOptions: {
        // Both, explicitly. There is no root `tsconfig.json` to discover —
        // main/preload/tests are one config and the renderer is another,
        // because only one of them lives in a window.
        project: ['./tsconfig.node.json', './tsconfig.web.json'],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte']
      }
    },
    rules: {
      // An unawaited engine call is the bug `serial.ts` exists to prevent:
      // it leaves the queue and races the refresh tick.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // `_event` in an IPC handler is the shape Electron hands us.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      // Off deliberately. Here `async` is usually the *contract* rather than
      // an implementation detail — `ipcMain.handle` answers a promise, a
      // `Turn` takes one — and a body that happens not to await yet is not a
      // defect. The rule would be asking us to change signatures to match
      // today's implementation.
      '@typescript-eslint/require-await': 'off'
    }
  },

  // svelte-eslint-parser handles the markup, but the type-aware rules run on
  // the <script> blocks, so it has to be told which parser to hand those to.
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.web.json'],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser
      }
    }
  },

  // The renderer is a browser; main, preload and the harness are Node.
  {
    files: ['src/renderer/**/*.{ts,svelte}'],
    languageOptions: { globals: globals.browser }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node }
  },

  // The drive scenarios are Node, but the callbacks they hand to
  // `page.evaluate` are serialized and run inside the window — so `document`
  // and `window` are in scope in the same file that imports `node:path`.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },

  // The Playwright scenarios are plain ESM driven by node, outside any
  // tsconfig, so the type-aware rules have nothing to read.
  {
    files: ['**/*.mjs'],
    ...ts.configs.disableTypeChecked
  }
)
