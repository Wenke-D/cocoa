// electron-vite's `?asset` imports: the file is copied into `out/` at build
// time and the import resolves to its path at runtime.
//
// Declared here rather than by referencing `electron-vite/node`, which also
// marks `ELECTRON_RENDERER_URL` readonly on `ProcessEnv` — and `agent.test.ts`
// sets that variable to test the dev-run socket name.
declare module '*?asset' {
  const path: string
  export default path
}
