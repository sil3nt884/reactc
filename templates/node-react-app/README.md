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
package.json         dependencies, and npm scripts that call reactc
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
```

## Commands

The project has no build scripts of its own: `reactc` reads
`reactc.config.json` and does the rest. Run these from this folder, with
reactc's `bin` folder on PATH.

| Command | What it does |
| --- | --- |
| `reactc build` | Compiles the server and the client for this system: Windows executables on Windows, Linux executables on Linux (a few minutes). The first build runs `npm install` for the libraries. |
| `reactc build --target windows` / `--target linux` | Compiles for that system, from either system, into `dist/windows` or `dist/linux`. |
| `reactc build --only server` / `--only client` | Compiles one side. |
| `reactc start` | On Windows: starts `TasksServer.exe` in this folder, waits for it to accept connections, opens `Tasks.exe`, and stops the server when the window closes. On Linux: runs the API server. Tasks are saved in `tasks.json`. |
| `npm run dev:server` | Runs the API under Node 23+ (TypeScript runs directly), for quick changes. |
| `npm test` | Unit tests for the router and shared validation (Node's test runner). |
| `npm run typecheck` | TypeScript checking (after `npm install`). |

`npm run build`, `build:windows`, `build:linux`, `build:server`,
`build:client` and `npm start` call the same commands.

Create a project from this template with `reactc new C:\path\to\my-app`, or
with `npm run new-app -- C:\path\to\my-app` in the reactc checkout. reactc
finds its own files (runtime, toolchain, libraries) from its executable, or
from `REACTC_HOME`. A `"root"` in `reactc.config.json` selects another reactc
folder; when it does not name one, reactc says so and uses its own.

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
- Client `fetch` accepts relative URLs and follows redirects within the
  `httpOrigin` in `reactc.config.json`. The template uses HTTP/1.1 on
  loopback. HTTPS origins negotiate HTTP/2 when the server advertises it.
- React support: function components and hooks, forms (`onSubmit`, Enter
  submits), `onClick`, `onChange`, `onKeyDown`, `localStorage`, `alert` and
  `confirm`. The window gets a default title bar. Known gaps are listed in the
  reactc repository's `docs/LIMITS.md`.
- Server support depends on the Node APIs the pinned Porffor compiler covers.
  This template uses `node:http`, `node:fs` and `process.env`. An Express app
  (the original Notes server) also compiles, but large servers take much
  longer to build.
