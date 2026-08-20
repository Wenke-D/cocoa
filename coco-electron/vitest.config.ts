import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // For `.svelte.ts` modules: the renderer's state is runes, and its bugs are
  // proxy bugs — they only appear when `$state` is really compiled.
  plugins: [svelte()],
  resolve: {
    alias: { '@shared': resolve('src/shared') }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Every engine test spawns real scripts into real temp folders; a few
    // deliberately wait on a launch that sleeps.
    testTimeout: 20_000,
    hookTimeout: 20_000
  }
})
