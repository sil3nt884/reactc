# PixiJS compatibility probes

These probes use PixiJS 8.22.0 directly with a plain offscreen canvas. They
have no React dependency.

From the repository root, install the pinned dependencies and run the pixel
test under Node.js.

```sh
npm ci --prefix scripts/ci/pixi
npm test --prefix scripts/ci/pixi
```

The adapter uses the Skia-backed `@napi-rs/canvas` package to supply a
`CanvasRenderingContext2D`. The probe checks the rectangle and background
pixels after the first draw and again after a resize. PixiJS identifies the
canvas using `OffscreenCanvas` and uses animation-frame callbacks to run its
scheduler. The probe registers the graphics extension explicitly and loads
`pixi.js/unsafe-eval`, PixiJS's entry point for environments that restrict
runtime code generation.

The browser probe exercises the same scene through WebGL 2. Bundle it and
open `scripts/ci/pixi/webgl.html` in a WebGL 2 browser. The page's
`data-result` attribute reports the result after checking several pixels
and resizing the drawing buffer.

```sh
npx --yes esbuild@0.25.12 scripts/ci/pixi/webgl.mjs --bundle --outfile=scripts/ci/pixi/webgl.bundle.js
```

To probe PixiJS scene construction through the ReactC compiler, run the
following on Windows with the current compiler and its native toolchain.
This probe constructs a scene and computes its bounds. The expected output
is `4 4 24 24`.

```powershell
reactc.exe build scripts/ci/pixi/scene.server.js --target windows --outdir dist/pixi --name PixiProbe
.\dist\pixi\PixiProbe.exe
```

The Windows native pixel test uses `reactc:canvas`, which backs
`OffscreenCanvas` with GDI+ in the generated executable. It runs the real
PixiJS Canvas2D renderer and checks the output before and after resizing.

```powershell
reactc.exe build scripts/ci/pixi/native.server.js --target windows --outdir dist/pixi --name PixiCanvas
.\dist\pixi\PixiCanvas.exe
```

The native canvas supports solid fills and strokes for rectangles and paths
with straight or Bézier segments, plus transforms, clipping, resizing, and
RGBA readback. `OffscreenCanvas.fromFile(path)` loads a local image into a
canvas that can be drawn with `drawImage` or used as a PixiJS sprite texture.
Canvas2D supports text and linear and radial gradients. Use `dispose()`
to release each canvas.

The window probe uses PixiJS's `Application` with its Canvas2D renderer.
Click the window to move the sprite and resize the window to change the
drawing buffer. `--smoke` presents three frames, verifies sprite and animation
pixels, and exits.

```powershell
reactc.exe build scripts/ci/pixi/window.server.js --target windows --no-console --outdir dist/pixi --name PixiWindow
.\dist\pixi\PixiWindow.exe --smoke
```

The native EGL probe uses ANGLE to compile and link shaders, upload a texture,
and render instanced, indexed geometry with uniforms and a vertex array.
It attaches a texture and a depth-stencil renderbuffer to an offscreen
framebuffer, blits the result, and checks rectangular pixel readback. It also
checks pixels after resizing and presents the result in a Win32 window.
Windows native setup installs ANGLE, and the compiler stages its DLLs beside
the executable.

```powershell
reactc.exe build scripts/ci/pixi/webgl.server.js --target windows --outdir dist/pixi --name WebGLProbe
.\dist\pixi\WebGLProbe.exe
```

The native WebGL application uses PixiJS's standard `Application`,
`Assets.load()`, ticker, resize plugin and federated pointer events.
`installCanvasEnvironment()` supplies PixiJS's DOM adapter and browser
event bindings. Pass `pixi: { DOMAdapter, ExtensionType, extensions }` when
installing the adapter so `Application.init()` selects the native PixiJS
environment. Import the PixiJS features you use, as shown in
[`application.server.js`](application.server.js). The application owns the event loop and calls
`pollEvent(canvas)` before presenting the frame.
Give the adapter a base file URL and a path resolver to load relative
images. The optional `readFile` callback also routes asset metadata
requests for local files through the filesystem. Image bytes from files,
data URLs and HTTP can be decoded through GDI+.

```powershell
reactc.exe build scripts/ci/pixi/application.server.js --target windows --no-console --outdir dist/pixi --name PixiApplication
.\dist\pixi\PixiApplication.exe
```

Use `--no-console` or set `"console": false` in `reactc.config.json` to
launch the canvas executable in the Windows GUI subsystem.

Run the Windows smoke test from the repository root. It checks pixels from
the spritesheet, render texture, text, mask, filter, and linear and radial
gradient fills. It also resizes
the window and verifies clicks, right-button input, scrolling and ticker
animation.

```powershell
.\scripts\ci\pixi\test-window.ps1 -Executable .\dist\pixi\PixiApplication.exe
```

```js
import { OffscreenCanvas } from 'reactc:canvas';

const canvas = new OffscreenCanvas(32, 32);
try {
  const context = canvas.getContext('2d');
  context.fillStyle = '#ff0000';
  context.fillRect(0, 0, 32, 32);
  console.log(context.getImageData(16, 16, 1, 1).data);
} finally {
  canvas.dispose();
}
```
