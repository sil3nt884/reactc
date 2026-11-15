import 'pixi.js/unsafe-eval';
import { Container, Graphics, WebGLRenderer } from 'pixi.js';

async function main() {
  const canvas = document.querySelector('canvas');
  const renderer = new WebGLRenderer();
  const stage = new Container();
  try {
    await renderer.init({
      canvas,
      width: 32,
      height: 32,
      backgroundColor: 0x0000ff,
      preserveDrawingBuffer: true,
      preferWebGLVersion: 2,
    });
    const rectangle = new Graphics().rect(4, 4, 24, 24).fill(0xff0000);
    stage.addChild(rectangle);
    renderer.render(stage);
    const gl = renderer.gl;
    function expectPixel(x, y, expected) {
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (pixel.join() !== expected) throw new Error(`Unexpected pixel at ${x},${y}: ${pixel.join()}`);
    }
    expectPixel(16, 16, '255,0,0,255');
    expectPixel(0, 0, '0,0,255,255');

    renderer.resize(48, 40);
    if (gl.drawingBufferWidth !== 48 || gl.drawingBufferHeight !== 40) {
      throw new Error('WebGL drawing buffer did not resize');
    }
    rectangle.position.set(12, 8);
    renderer.render(stage);
    expectPixel(24, 19, '255,0,0,255');
    expectPixel(47, 0, '0,0,255,255');
    document.body.dataset.result = 'pass ' + gl.getParameter(gl.VERSION);
  } catch (error) {
    document.body.dataset.result = 'error ' + error.message;
  } finally {
    if (renderer.gl) renderer.destroy();
    stage.destroy({ children: true });
  }
}

void main();
