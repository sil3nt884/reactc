# Node + React app for reactc

A task list with a Node HTTP API and a React client. reactc compiles each
side into a native executable, for Windows (`dist/windows/server/TasksServer.exe`,
`dist/windows/client/Tasks.exe`) or Linux (`dist/linux/server/TasksServer`).
No JavaScript engine runs in either program.

It uses the reactc libraries from the start:
- [`@reactc/threads`](https://github.com/sil3nt884/reactc/tree/main/packages/reactc-threads#readme):
  `GET /summary` computes task statistics on its own thread
  (`server/summary.ts`), awaited like a promise while the server keeps serving.
- `@reactc/ui` (React layout, controls and window chrome) is installed and
  ready to import in `client/`.

Both are `file:` dependencies on the reactc that created the project.

```
reactc.config.json   which folders are server, client and shared; build options
package.json         npm scripts
server/              Node HTTP API (TypeScript)
  index.ts           HTTP entry: reads JSON bodies, calls the router
  router.ts          the API as a plain function, so it can be unit-tested
  store.ts           tasks in memory, saved to tasks.json
  summary.ts         task statistics on a thread (@reactc/threads)
client/              React UI (TypeScript + CSS)
  App.tsx            the app
  api.ts             fetch calls to the server
  TaskRow.tsx  App.css
shared/              code both sides import (types, port, validation)
scripts/reactc.mjs   finds reactc, builds, and runs the executables
```

## Commands

Run these from this folder: in PowerShell on Windows, or a shell on Linux.
`build.ps1` needs only PowerShell. The npm scripts need Node, and the first
build runs `npm install` for the libraries.

| Command | What it does |
| --- | --- |
| `powershell -ExecutionPolicy Bypass -File build.ps1` | Compiles the server and the client. `-Only server` or `-Only client` compiles one side. |
| `powershell -ExecutionPolicy Bypass -File build.ps1 -Start` | Compiles, then runs both executables (add `-NoBuild` to run the last build). |
| `npm run dev:server` | Runs the API under Node 23+ (TypeScript runs directly), for quick changes. |
| `npm test` | Unit tests for the router and shared validation (Node's test runner). |
| `npm run build` | Compiles the server and the client for this system: Windows executables on Windows, Linux executables on Linux (a few minutes). |
| `npm run build:windows` / `npm run build:linux` | Compiles for that system, from either system (into `dist/windows` or `dist/linux`). |
| `npm run build:server` / `build:client` | Compiles one side. |
| `npm start` | On Windows: starts `TasksServer.exe`, waits for it, opens `Tasks.exe`, and stops the server when the window closes. On Linux: runs the API server. Tasks are saved in `data/tasks.json`. |
| `npm install`, then `npm run typecheck` | Optional: TypeScript checking and editor types. Building needs no install. |

Create a project from this template with `reactc new C:\path\to\my-app`, or
with `npm run new-app -- C:\path\to\my-app` in the reactc checkout. The new
project's `reactc.config.json` `"root"` points at the reactc that created it.
That is either a packaged compiler (`npm run build:compiler` in the checkout
makes `dist/reactc`), whose `bin/reactc.exe` is used directly, or the
checkout, where the first build also builds reactc. Without `root`, the
scripts use `REACTC_HOME` or `reactc` on PATH.

## Build something

- **Add a field:** extend `Task` in `shared/tasks.ts`, accept it in
  `server/router.ts` and show it in `client/TaskRow.tsx`.
- **Add an endpoint:** add a branch to `route()` and a test in
  `server/router.test.ts`, then a function in `client/api.ts`.
- **Change the look:** edit `client/App.css`. It is a CSS file compiled by
  reactc, with variables, descendant selectors, `:hover`, `:focus` and width
  media queries. The build lists rules it cannot draw.
- **Add screens:** split components into more files under `client/`.

## Rules that keep the native build working

- The client may not import from `server/`, and the server may not import
  from `client/`. reactc stops the build and names the file. Shared code goes
  in `shared/`.
- Use explicit `.ts`/`.tsx` extensions in imports and erasable TypeScript
  only (no `enum`, `namespace` or constructor parameter properties). Node runs
  the sources directly, and reactc bundles them the same way.
- Client `fetch` goes to the `httpOrigin` in `reactc.config.json`. It supports
  every method (GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS), request
  headers such as `Authorization: Bearer …` (given as an object, pairs or
  `Headers`), string and `URLSearchParams` bodies up to 64 KiB, and responses
  with `status`, `statusText`, `headers.get()`, `text()` and `json()` (text
  bodies up to 64 KiB). The host sets `Host`, `Content-Length`, `Origin` and
  similar headers itself, and does not follow redirects or keep cookies.
- React support: function components and hooks, forms (`onSubmit`, Enter
  submits), `onClick`, `onChange`, `onKeyDown`, `localStorage`, `alert` and
  `confirm`. The window gets a default title bar. Known gaps are listed in the
  reactc repository's `docs/LIMITS.md`.
- Server support depends on the Node APIs the pinned Porffor compiler covers.
  This template uses `node:http`, `node:fs` and `process.env`. An Express app
  (the original Notes server) also compiles, but large servers take much
  longer to build.
