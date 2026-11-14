# Converting a React app to reactc

reactc compiles a React UI into a native window. There is no browser inside
the result, so an app that was written for the browser (Create React App,
Vite, Next.js) builds only as far as its code and its packages stay within
what reactc's runtime provides. This guide covers the one-time setup, how to
tell whether an app is a good fit, and the conversion steps.

See [JavaScript and Node.js compatibility](LIMITS.md) for language and runtime
limits that also apply to your app's npm dependencies.

## 1. Set up reactc (once)

On Windows, download `reactc.exe` from the [releases page](../../releases)
and place it beside `reactc.config.json`. Run `.\reactc.exe build --target windows`
from that folder. The first build downloads and caches the build tools.
Use `reactc-offline.exe` to carry those tools inside the executable.

To build reactc from source:

On Windows, without WSL. Needs [Node.js](https://nodejs.org) 22.15 or newer,
[Rust](https://rustup.rs) and [Git for Windows](https://git-scm.com).

```sh
git clone https://github.com/sil3nt884/reactc
cd reactc
npm run setup -- --native    # MinGW-w64, Porffor's source and the Windows libraries, into tools/
npm run build:compiler       # builds reactc and packages it in dist/reactc
```

Add `dist\reactc\bin` to PATH. `reactc` then works from any folder: it finds
its runtime and toolchain from its own location. Check it with a new project:

```sh
reactc new my-app
cd my-app
reactc build
reactc start
```

For Linux targets, or to build on Linux, use `npm run setup` instead (see the
[README](../README.md#build-from-source)).

## 2. Check whether the app fits

Look at the app's `package.json` and its imports before changing anything.

| The app uses | In reactc |
| --- | --- |
| Function components, `useState`, `useEffect`, `useRef`, `useMemo`, `useCallback`, `useContext`/`createContext`, `useId`, `useSyncExternalStore`, `useTransition`, `useActionState`, `Fragment`, `Suspense` | Supported. Imports from `react` resolve to reactc's runtime. |
| `memo`, `forwardRef`, `useLayoutEffect`, `useReducer`, `Children`, `cloneElement`, `isValidElement`, `createPortal`, class components (`Component`) | Not provided. The build fails with `"X" is not exported by "src/page-runtime.js"`. Rewrite the code that uses them, or drop the package that does. |
| `react-dom` (`createRoot`, `render`) | Not used. The entry is a component, not a bootstrap file (step 3). |
| Component libraries built on the DOM and browser CSS: MUI, Emotion, styled-components, Ant Design, Bootstrap | Do not compile or look wrong. Replace with plain elements and CSS, or [`@reactc/ui`](../packages/reactc-ui/README.md). |
| Widgets that drive the DOM themselves: Monaco, CodeMirror, charts on canvas, maps | No equivalent. These parts of the app cannot be converted as they are. |
| React Router | Routing is not implemented. Keep the current screen in state and render it, or use a Next.js App Router layout, which reactc does read. |
| `fetch`, `localStorage` (`getItem`, `setItem`, `removeItem`, `clear`), `alert`, `confirm`, `window.open` for `http(s)` links, `keydown` listeners on `window` and `document` | Provided natively. |
| Other `window`, `document` and `navigator` APIs: DOM queries, `getElementById`, refs to DOM nodes, `sessionStorage`, timers on `window`, canvas | Absent. Code that touches the DOM directly has to go. |
| Tailwind | Not translated. Write CSS files. |
| Plain `.css` imports | Compiled to native styles: class, ID, element and attribute selectors, descendant and child selectors, variables, `min-width`/`max-width` media queries, `:hover`, `:focus`. The build lists every rule it cannot draw. |
| Firebase and other browser SDKs | Untested. Calling the service's HTTP API with `fetch` is the safer route. |
| A Node backend (Express, `node:http`, `fs`, `crypto`) | Compiles as the project's server. Packages with native addons do not. |

An app that is mostly forms, lists and `fetch` calls converts with modest
work. An app built around a DOM widget or a component library is closer to
a rewrite of its UI on top of the same logic.

## 3. Give the app a component entry

A browser app starts from a bootstrap file:

```js
// src/index.js (browser)
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
```

reactc starts from a component. Point it at the file that default-exports
the app's root component, and leave `index.js` and `public/index.html` out:

```js
// src/App.js
export default function App() { ... }
```

Providers that only exist for the browser (`BrowserRouter`, a theme provider
from a component library, `React.StrictMode`) come out of this component.

## 4. Add `reactc.config.json`

In the app's folder, next to `package.json`:

```json
{
  "outDir": "dist",
  "client": {
    "folders": ["src"],
    "entry": "src/App.js",
    "name": "MyApp",
    "title": "My app"
  }
}
```

- `name` is the executable's file name, `title` the window title.
- Do not add `"root"`. reactc finds its own files. (`"root"` selects another
  reactc folder; a value that is not one is reported and ignored.)
- If the app has a Node backend, add a `server` section and move code both
  sides import into a `shared` folder. The
  [template's configuration](../templates/node-react-app/reactc.config.json)
  shows both sides.
- If the UI calls an HTTP API, set `"httpOrigin": "http://127.0.0.1:5000"`
  (the API's origin) in `client`. Relative `fetch` URLs then resolve against
  it, and requests are restricted to it.

No build scripts are needed. Remove `react-scripts` or Vite commands from the
workflow for this target; they can stay for the browser build.

## 5. Build, read the errors, repeat

```sh
reactc build                    # for this system
reactc build --target windows   # or name the target: windows, linux
reactc start                    # run what was built
```

The build stops at the first stage that fails, in this order.

1. **Bundling.** Messages such as `"forwardRef" is not exported by
   "src/page-runtime.js"` mean a file or package uses a part of React that
   reactc lacks. `"default" is not exported by ...` means the entry is not a
   component (step 3). The message names the importing file; for a package,
   replace the package.
2. **CSS.** Lines starting `native CSS <file>: unsupported ...` are warnings.
   The build continues and those rules are not drawn. Remove or rewrite the
   ones the layout depends on.
3. **Porffor (JavaScript to C).** Fails on `eval`, `new Function`, and
   `require` with a computed path.
4. **C compile.** The slow step: a few minutes for a small app. A failure
   here is a reactc bug rather than something in the app.

Work from the entry outwards: get `App` compiling with its children stubbed
out, then bring screens back one at a time. Each one that fails names the
next thing to replace.

Bundling and CSS errors appear within seconds, before the slow steps start,
so this loop is quick until the app first gets past bundling.

## 6. Replace what the browser provided

| Browser app | reactc app |
| --- | --- |
| MUI `Button`, `TextField`, `Stack`, `Paper` | `<button>`, `<input>`, `<div>` with CSS, or `Button`, `TextField`, `Stack`, `Row`, `Panel` from `@reactc/ui` |
| Theme objects, `sx`, CSS-in-JS | A `.css` file with variables, imported from the component |
| Routes | A `useState` holding the current screen |
| `localStorage`, `alert`, `confirm` | Keep them; reactc provides native versions |
| Animations, shadows, transforms | Not drawn; design without them |
| Browser title bar | A default native title bar, or your own with `WindowTitleBar` from `@reactc/ui` |

Keep the app's logic (state, data fetching, validation, API calls) and
replace its presentation layer.

## 7. Check the result

Run the executable and compare it with the browser version screen by screen.
Layout is done by reactc's renderer, not a browser engine, so spacing can
differ: borders are painted inside the box, and absolutely positioned children
inside CSS-styled boxes stay in the flow. Keyboard behaviour also differs;
see [LIMITS.md](LIMITS.md#react-ui-native-renderer-not-a-browser).
