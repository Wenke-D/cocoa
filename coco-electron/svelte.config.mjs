import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

export default {
  preprocess: vitePreprocess(),
  // Not SvelteKit. `kit.alias` is here only because the shadcn-svelte CLI
  // reads it to find where `$lib` lives; the aliases that compile anything
  // are in electron.vite.config.ts and the tsconfigs.
  kit: {
    alias: { $lib: 'src/renderer/src/lib' }
  }
}
