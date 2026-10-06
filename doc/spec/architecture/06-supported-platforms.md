# 6. Supported Platforms

## 6.1 Mandatory

The application must run and build using:

```bash
npm install
npm run dev            # electron-vite, hot reload in the renderer
npm run build          # type-check and bundle main, preload, renderer
npm run package        # electron-builder, an installable cocoa.app
```

on:

- macOS on the developer's native architecture.
- Linux on the developer's native architecture.

The implementation must not contain architecture-specific code that prevents
either Apple Silicon or Intel macOS builds.

The application is single-instance per machine: the engine is the store's and
the agent socket's single owner, so a second launch hands over to the running
cocoa — which brings its window to the front — and quits. The instance lock
follows `userData`, so a drive run's private profile runs alongside a real
cocoa rather than refusing to start.

## 6.2 macOS Requirements

On macOS:

- Use the normal operating-system window frame and title bar.
- Do not implement a custom frameless title bar.
- Respect Retina/HiDPI scaling.
- The application menu carries no workbench commands for now — it is the
  platform's minimum: the Edit roles, which are what wire up the clipboard on
  macOS, and Quit. Other platforms get no menu at all. If commands return, they
  declare platform-aware `CmdOrCtrl` accelerators, and a menu pick and a click
  must route through the same operation (§25).
- Closing the window quits the app — cocoa deliberately breaks with the macOS
  stay-in-the-dock convention. Cocoa is its window: a windowless engine would
  keep refreshing and answering the agent socket with nothing watching it.
- Do not assume `/home/...` paths.
- Do not depend on Bash-specific commands.
- Do not depend on Homebrew packages to run the application.
- The application must remain usable at 100%, 150%, and Retina scaling.

## 6.3 Linux Requirements

On Linux:

- The same source tree must build without UI forks.
- Do not hardcode macOS-specific paths or keyboard labels.
- Support normal window resizing.
- Preserve the application's main two-column structure at small sizes.
- Document any required distribution packages in the README.

## 6.4 No Browser Target

cocoa is a desktop application. The renderer is a web client, but it is not a web
page: it depends on the main process for every fact it shows and every operation
it performs, and that process spawns local scripts against local folders. There
is no hosted build and none is planned.
