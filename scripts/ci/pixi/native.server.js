import 'pixi.js/graphics';
import 'pixi.js/unsafe-eval';
import { CanvasRenderer, Container, DOMAdapter, Graphics, Ticker } from 'pixi.js';
import { CanvasRenderingContext2D, OffscreenCanvas } from 'reactc:canvas';

async function main() {
  globalThis.OffscreenCanvas = OffscreenCanvas;
  globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16);
  globalThis.cancelAnimationFrame = id => clearTimeout(id);
  DOMAdapter.set({
    createCanvas: (width, height) => new OffscreenCanvas(width, height),
    createImage() { throw new Error('Image loading is unavailable in this probe'); },
    getCanvasRenderingContext2D: () => CanvasRenderingContext2D,
    getWebGLRenderingContext: () => null,
    getNavigator: () => ({ userAgent: '' }),
    getBaseUrl: () => 'file:///',
    getFontFaceSet: () => null,
    fetch: (...args) => globalThis.fetch(...args),
    parseXML() { throw new Error('XML is unavailable in this probe'); },
  });

  const canvas = new OffscreenCanvas(32, 32);
  const context = canvas.getContext('2d');
  const renderer = new CanvasRenderer();
  const stage = new Container();
  const rectangle = new Graphics().rect(4, 4, 24, 24).fill(0xff0000);
  stage.addChild(rectangle);

  function expectPixel(x, y, expected) {
    const actual = Array.from(context.getImageData(x, y, 1, 1).data).join(',');
    if (actual !== expected) throw new Error('Unexpected pixel at ' + x + ',' + y + ': ' + actual);
  }

  try {
    await renderer.init({
      canvas, width: 32, height: 32, backgroundColor: 0x0000ff,
      skipExtensionImports: true,
    });
    renderer.render(stage);
    expectPixel(16, 16, '255,0,0,255');
    expectPixel(0, 0, '0,0,255,255');

    renderer.resize(48, 40);
    if (canvas.width !== 48 || canvas.height !== 40) throw new Error('Canvas did not resize');
    rectangle.position.set(12, 8);
    renderer.render(stage);
    expectPixel(5, 5, '0,0,255,255');
    expectPixel(24, 20, '255,0,0,255');
    expectPixel(47, 39, '0,0,255,255');
    console.log('Native PixiJS Canvas2D pixels and resize passed');
  } finally {
    Ticker.system.stop();
    Ticker.shared.stop();
    canvas.dispose();
  }
}

main().catch(error => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
