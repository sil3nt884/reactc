import 'pixi.js/app';
import 'pixi.js/events';
import 'pixi.js/filters';
import 'pixi.js/graphics';
import 'pixi.js/text';
import 'pixi.js/unsafe-eval';
import {
  Application, Assets, ColorMatrixFilter, DOMAdapter, ExtensionType, FillGradient, Graphics, RenderTexture, Sprite, Text, Ticker, extensions,
} from 'pixi.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installCanvasEnvironment } from 'reactc:canvas';

const asset = 'tile.json';
const width = 96;
const height = 64;

function assertPixel(gl, x, y, expected) {
  const bytes = new Uint8Array(4);
  gl.readPixels(x, gl.drawingBufferHeight - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  const color = Array.from(bytes).join(',');
  if (color !== expected) throw new Error('Unexpected pixel at ' + x + ',' + y + ': ' + color);
}

function assertText(gl) {
  const bytes = new Uint8Array(40 * 16 * 4);
  gl.readPixels(6, gl.drawingBufferHeight - 59, 40, 16, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  let painted = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    if (bytes[offset] < 20 && bytes[offset + 1] > 128 && bytes[offset + 2] > 128) painted++;
  }
  if (painted < 15) throw new Error('The rendered PixiJS text is missing');
}

function assertGradient(gl, startX, startY, endX, endY) {
  const first = new Uint8Array(4);
  const last = new Uint8Array(4);
  gl.readPixels(startX, gl.drawingBufferHeight - 1 - startY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, first);
  gl.readPixels(endX, gl.drawingBufferHeight - 1 - endY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, last);
  if (first[0] <= first[2] || last[2] <= last[0] || first[3] !== 255 || last[3] !== 255) {
    throw new Error('Unexpected gradient pixels: ' + Array.from(first).join(',') + ' / ' + Array.from(last).join(','));
  }
}

async function main() {
  const smoke = process.argv.includes('--smoke');
  const environment = installCanvasEnvironment({
    baseUrl: pathToFileURL(process.cwd() + '/scripts/ci/pixi/').href,
    resolveImagePath: fileURLToPath,
    readFile,
    pixi: { DOMAdapter, ExtensionType, extensions },
  });
  const app = new Application();
  let initialized = false;
  let sheet;
  let renderTexture;
  let filter;
  let linear;
  let radial;
  try {
    const canvas = environment.adapter.createCanvas(width, height);
    await app.init({ canvas, width, height, autoStart: false, backgroundColor: 0x101010 });
    initialized = true;
    const gl = app.renderer.gl;
    if (!gl || app.renderer.context.webGLVersion !== 2) throw new Error('PixiJS did not select WebGL 2');

    sheet = await Assets.load(asset);
    const sprite = new Sprite(sheet.textures.tile);
    sprite.position.set(48, 24);
    const rectangle = new Graphics().rect(8, 8, 24, 24).fill(0xff0000);
    rectangle.eventMode = 'static';
    let frames = 0;
    let pointerFrame = -1;
    let rightDown = false;
    let wheelUp = false;
    rectangle.on('pointerdown', event => {
      if (event.button !== 0) return;
      pointerFrame = frames;
      sprite.x = 52;
    });
    rectangle.on('rightdown', event => { rightDown = event.button === 2 && event.buttons === 2; });
    rectangle.on('wheel', event => { wheelUp = event.deltaY === -120; });
    app.stage.addChild(rectangle, sprite);
    renderTexture = RenderTexture.create({ width: 8, height: 8 });
    const tile = new Graphics().rect(0, 0, 8, 8).fill(0x00ff00);
    try {
      app.renderer.render({ container: tile, target: renderTexture, clear: true });
    } finally {
      tile.destroy();
    }
    const renderedSprite = new Sprite(renderTexture);
    renderedSprite.position.set(80, 8);
    app.stage.addChild(renderedSprite);
    const label = new Text({ text: 'Café', style: { fontFamily: 'Arial', fontSize: 14, fill: 0x00ffff } });
    label.position.set(8, 44);
    app.stage.addChild(label);
    const masked = new Graphics().rect(38, 8, 16, 12).fill(0xff00ff);
    const mask = new Graphics().rect(38, 8, 8, 12).fill(0xffffff);
    masked.mask = mask;
    app.stage.addChild(mask, masked);
    const filtered = new Graphics().rect(76, 50, 12, 12).fill(0x0000ff);
    filter = new ColorMatrixFilter();
    filter.negative(false);
    filtered.filters = [filter];
    app.stage.addChild(filtered);
    const stops = [{ offset: 0, color: 0xff0000 }, { offset: 1, color: 0x0000ff }];
    linear = new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, colorStops: stops });
    radial = new FillGradient({ type: 'radial', colorStops: stops });
    app.stage.addChild(new Graphics().rect(58, 6, 16, 14).fill(linear));
    app.stage.addChild(new Graphics().rect(44, 48, 26, 14).fill(radial));

    app.render();
    assertPixel(gl, 16, 16, '255,0,0,255');
    assertPixel(gl, 50, 26, '255,204,0,255');
    assertPixel(gl, 82, 10, '0,255,0,255');
    assertText(gl);
    assertPixel(gl, 41, 13, '255,0,255,255');
    assertPixel(gl, 50, 13, '16,16,16,255');
    assertPixel(gl, 82, 55, '255,255,0,255');
    assertGradient(gl, 59, 12, 72, 12);
    assertGradient(gl, 57, 55, 46, 55);
    canvas.show();
    app.resizeTo = canvas;
    app.ticker.add(() => {
      frames++;
      rectangle.x = frames % 8;
    });
    app.start();

    const started = performance.now();
    while (true) {
      let event;
      while ((event = environment.pollEvent(canvas))) {
        if (event.type === 'close') {
          if (smoke) throw new Error('Window closed before the smoke test finished');
          return;
        }
      }
      if (!canvas.present()) throw new Error('Could not present the native window');
      const resized = canvas.clientWidth !== width && app.renderer.width === canvas.clientWidth &&
        gl.drawingBufferWidth === canvas.clientWidth;
      if (smoke && frames >= 3 && pointerFrame >= 0 && frames > pointerFrame && rightDown && wheelUp && resized) {
        assertPixel(gl, 56, 28, '255,204,0,255');
        console.log('PixiJS Application WebGL draw, gradients, spritesheet, ticker, resize and mouse input passed');
        return;
      }
      if (smoke && performance.now() - started > 5000) {
        throw new Error('Native event timeout. frames=' + frames + ' pointerFrame=' + pointerFrame +
          ' rightDown=' + rightDown + ' wheelUp=' + wheelUp +
          ' clientWidth=' + canvas.clientWidth + ' rendererWidth=' + app.renderer.width);
      }
      await new Promise(resolve => setTimeout(resolve, 16));
    }
  } finally {
    try {
      if (initialized) app.destroy(false, { children: true });
      if (renderTexture) renderTexture.destroy(true);
      if (filter) filter.destroy();
      if (linear) linear.destroy();
      if (radial) radial.destroy();
      if (sheet) await Assets.unload(asset);
    } finally {
      Ticker.shared.stop();
      Ticker.system.stop();
      environment.dispose();
    }
  }
}

main().catch(error => {
  console.error(String(error));
  process.exitCode = 1;
});
