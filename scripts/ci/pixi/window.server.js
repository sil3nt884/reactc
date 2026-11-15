import 'pixi.js/app';
import 'pixi.js/graphics';
import 'pixi.js/unsafe-eval';
import { Application, DOMAdapter, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import { CanvasRenderingContext2D, OffscreenCanvas } from 'reactc:canvas';

async function main() {
  globalThis.OffscreenCanvas = OffscreenCanvas;
  globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16);
  globalThis.cancelAnimationFrame = id => clearTimeout(id);
  const resizeListeners = new Set();
  globalThis.addEventListener = (type, callback) => {
    if (type === 'resize') resizeListeners.add(callback);
  };
  globalThis.removeEventListener = (type, callback) => {
    if (type === 'resize') resizeListeners.delete(callback);
  };
  const temporaryCanvases = [];
  DOMAdapter.set({
    createCanvas(width, height) {
      const canvas = new OffscreenCanvas(width, height);
      temporaryCanvases.push(canvas);
      return canvas;
    },
    createImage() { throw new Error('Image loading is unavailable in this probe'); },
    getCanvasRenderingContext2D: () => CanvasRenderingContext2D,
    getWebGLRenderingContext: () => null,
    getNavigator: () => ({ userAgent: '' }),
    getBaseUrl: () => 'file:///',
    getFontFaceSet: () => null,
    fetch: (...args) => globalThis.fetch(...args),
    parseXML() { throw new Error('XML is unavailable in this probe'); },
  });

  const smoke = process.argv.includes('--smoke');
  const canvas = new OffscreenCanvas(320, 200);
  const tile = new OffscreenCanvas(24, 24);
  const brush = tile.getContext('2d');
  brush.fillStyle = '#ffcc00';
  brush.fillRect(0, 0, 24, 24);
  const app = new Application();
  let initialized = false;
  try {
    await app.init({
      canvas, width: canvas.width, height: canvas.height,
      preference: 'canvas', autoStart: false, skipExtensionImports: true,
      backgroundColor: 0x111827,
    });
    initialized = true;
    const shape = new Graphics().rect(32, 32, 56, 40).fill(0x3366ff);
    const sprite = new Sprite(Texture.from(tile));
    sprite.position.set(110, 40);
    app.stage.addChild(shape, sprite);
    canvas.show();
    let frames = 0;
    while (true) {
      let event;
      let closed = false;
      while ((event = canvas.pollEvent())) {
        if (event.type === 'close') closed = true;
        if (event.type === 'resize') app.renderer.resize(event.width, event.height);
        if (event.type === 'pointerdown') sprite.position.set(event.x, event.y);
      }
      if (closed) break;
      shape.x = frames % 48;
      app.render();
      if (!canvas.present()) throw new Error('Could not present the window');
      frames++;
      if (smoke && frames === 3) {
        const canvasPixels = canvas.getContext('2d');
        const color = Array.from(canvasPixels.getImageData(120, 50, 1, 1).data).join(',');
        if (color !== '255,204,0,255') throw new Error('Unexpected sprite pixel: ' + color);
        const animated = Array.from(canvasPixels.getImageData(89, 48, 1, 1).data).join(',');
        if (animated !== '51,102,255,255') throw new Error('Unexpected animated pixel: ' + animated);
        console.log('Native PixiJS window, sprite and animation passed');
        break;
      }
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  } finally {
    if (initialized) app.destroy(false, { children: true });
    Ticker.system.stop();
    Ticker.shared.stop();
    for (const temporary of temporaryCanvases) temporary.dispose();
    tile.dispose();
    canvas.dispose();
  }
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
