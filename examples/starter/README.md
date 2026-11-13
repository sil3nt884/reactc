# Starter app

A small task list you can change and compile yourself into a native Windows
executable. React source goes in; reactc emits C and links one `.exe` with
the Skia renderer. No JavaScript engine runs in the app.

## Build and run

From PowerShell in the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File examples/starter/build.ps1
```

The script builds the compiler (`compiler/`, first run only), compiles
[`App.tsx`](App.tsx) to `dist/StarterApp/StarterApp.exe` and opens it.

- Your own app: `build.ps1 -Entry path\to\App.tsx -Name MyApp -Title "My app"`.
- A full project with a Node server: `npm run new-app -- C:\path\to\my-app`
  copies [`templates/node-react-app`](../../templates/node-react-app/README.md).
- An app with a server: describe its `server` and `client` folders in a
  `reactc.config.json` and run `build.ps1 -Config path\to\reactc.config.json`.
  You get a server `.exe` and a client `.exe`. See
  [project configuration](../../compiler/README.md#project-configuration) and the
  [greeting example](../../scripts/fixtures/reactc-config/reactc.config.json).
- Build without opening: add `-NoRun`.
- Check it in a terminal without a window:
  `dist/StarterApp/StarterApp.exe --smoke` writes `native-app-smoke.json` (the
  rendered tree) and `native-app-smoke.bmp` (the first frame) next to the exe.

A build takes about 1–2 minutes. It needs the toolchain this repository
already uses on this machine: Rust (`cargo`) on Windows, and WSL with the
repository's native toolchain for the C build. See the
[compiler README](../../compiler/README.md).

## Change it

Edit `App.tsx`, run the script again, and the new window opens. Things to try:

- Add a field to `Task` (for example a priority) and show it in the list.
- Change `colors`. A light `page` colour gives light default controls and
  window chrome; a dark one (`#16181c`) switches both to dark.
- Add `onKeyDown` to the list or a button. Keys with Ctrl/Alt, Enter, Escape,
  Tab and function keys reach it first; `event.preventDefault()` stops the
  Windows default.

## What you can use

- Function components, `useState`, `useEffect`, `useMemo`, `useRef`,
  context, and lists with `key`.
- Inline `style` objects with flex layout, sizes, padding, margins, colours,
  borders, radius, `opacity` and fonts. Controls without a border width get a
  1px default border.
- Forms: `onSubmit` with `event.preventDefault()`, controlled inputs, and
  Enter in a single-line field to submit.
- Events: `onClick`, `onChange`, `onKeyDown`.
- CSS files (`import './App.css'`) work with reactc, including `:hover`,
  `:focus` and width media queries. The compiler lists rules it cannot draw.
  This registered example keeps inline styles because the repository's
  verification also compiles it with the older JS compiler, which has no CSS
  imports.
- `window.addEventListener('keydown', …)`, `localStorage`, `alert`/`confirm`
  and `fetch` (with `--http-origin`) work in reactc builds.

The window gets a default title bar. Use `WindowTitleBar` from
[`@reactc/ui`](../../packages/reactc-ui/README.md) for your own.

Known gaps (shadows, transitions, `:active`, plain typing in `onKeyDown`,
nested-scroll focus, IME and screen readers) are listed in the
[limits](../../docs/LIMITS.md).

## Verification

`npm run verify:native` compiles this app and runs
[`scripts/check-starter.py`](../../scripts/check-starter.py), which adds,
filters, completes and removes tasks in the compiled core.
