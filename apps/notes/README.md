# Markdown Notes native port

The React editor and Express routes are adapted from [chetx27/notes-app](https://github.com/chetx27/notes-app/tree/5f665682fd488ddae8fda34a5d2f0385225632c4). The upstream MIT license is included.

The port keeps the editor, live preview, tags, search, note selection, save-as-new and delete. Inline native styles replace browser CSS. The preview renders headings and bullets, with other Markdown shown as text. The server persists notes in a local JSON file. Browser offline storage, theme switching and downloads are unavailable in the port.

From the repository root, install the backend dependencies with `npm ci --prefix apps/notes`, then build both programs with `reactc`.

```sh
reactc build apps/notes/notes.server.js --target host --name NotesServer --outdir dist/notes-native/server
reactc build apps/notes/notes.client.tsx --target windows --async-page --name MarkdownNotes --title 'Markdown Notes' --outdir dist/notes-native/windows
```

Start `NotesServer` on Linux or WSL, then launch `MarkdownNotes.exe` on Windows. The client expects the API on `127.0.0.1:43767`. The server uses `notes.json` in its working directory by default. Set `NOTES_FILE` to choose a different path. The native HTTP response limit bounds the saved list to 32 KiB.

## Original source benchmark

The upstream `server.js` compiles directly with `reactc build server.js --server --target host` from a checkout with dependencies installed and the compiler's repository passed as `--root`. The upstream server listens on port 5000 and keeps its notes in memory.

The untouched UI entry is `src/App.js`. Build it with `--target windows --http-origin http://127.0.0.1:5000`. The compiler maps the upstream `localhost` URL to the configured IPv4 origin. It lowers JSX in `.js` modules, supplies React's automatic JSX runtime, resolves packages that publish a `main` entry, and compiles the imported stylesheets into native styles. The Windows executable loaded an upstream server note and rendered the original stylesheet and `react-markdown`. The native host test also switched the stylesheet theme. The compiler reports CSS outside the supported subset. Windows provides persistent storage, dialogs, and a native download picker. See the [goal handover](../../docs/REACTC_GOAL_HANDOVER.md) for the verified online and offline workflows and the upstream acceptance test.
