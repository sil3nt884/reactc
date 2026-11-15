import assert from 'node:assert/strict';
import canvasBackend from '@napi-rs/canvas';
import 'pixi.js/graphics';
import 'pixi.js/unsafe-eval';
import { CanvasRenderer, Container, DOMAdapter, Graphics, Ticker } from 'pixi.js';

const { createCanvas, Image } = canvasBackend;
const canvas = createCanvas(32, 32);
const context = canvas.getContext('2d');

// Pixi's CanvasSource recognizes offscreen canvases by their constructor.
// The scheduler uses frame callbacks even when the probe renders by hand.
globalThis.OffscreenCanvas = canvas.constructor;
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16);
globalThis.cancelAnimationFrame = id => clearTimeout(id);

DOMAdapter.set({
  createCanvas,
  createImage: () => new Image(),
  getCanvasRenderingContext2D: () => context.constructor,
  getWebGLRenderingContext: () => null,
  getNavigator: () => ({ userAgent: '' }),
  getBaseUrl: () => import.meta.url,
  getFontFaceSet: () => null,
  fetch: (...args) => globalThis.fetch(...args),
  parseXML() { throw new Error('XML is unavailable in the canvas probe'); },
});

const renderer = new CanvasRenderer();
const stage = new Container();
const rectangle = new Graphics().rect(4, 4, 24, 24).fill(0xff0000);
stage.addChild(rectangle);

function expectPixel(x, y, expected) {
  assert.deepEqual(Array.from(context.getImageData(x, y, 1, 1).data), expected);
}

try {
  await renderer.init({
    canvas,
    width: 32,
    height: 32,
    backgroundColor: 0x0000ff,
    skipExtensionImports: true,
  });
  renderer.render(stage);
  expectPixel(16, 16, [255, 0, 0, 255]);
  expectPixel(0, 0, [0, 0, 255, 255]);

  renderer.resize(48, 40);
  assert.equal(canvas.width, 48);
  assert.equal(canvas.height, 40);
  rectangle.position.set(12, 8);
  renderer.render(stage);
  expectPixel(5, 5, [0, 0, 255, 255]);
  expectPixel(24, 20, [255, 0, 0, 255]);
  expectPixel(47, 39, [0, 0, 255, 255]);
} finally {
  // The renderer owns listeners on these process-wide tickers.
  Ticker.system.stop();
  Ticker.shared.stop();
  renderer.destroy();
  stage.destroy({ children: true });
}
console.log('PixiJS Canvas2D pixels and resize passed');
