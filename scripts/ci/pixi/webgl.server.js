import { OffscreenCanvas, WebGLRenderingContext, WebGL2RenderingContext } from 'reactc:canvas';
const legacyCanvas = new OffscreenCanvas(8, 8);
try {
  const legacy = legacyCanvas.getContext('webgl');
  if (!(legacy instanceof WebGLRenderingContext) || legacy instanceof WebGL2RenderingContext ||
      !legacy.getContextAttributes().stencil || legacyCanvas.getContext('webgl2') !== null) {
    throw new Error('Invalid native WebGL 1 context');
  }
  if (legacy.getShaderPrecisionFormat(legacy.FRAGMENT_SHADER, legacy.HIGH_FLOAT).precision <= 0) {
    throw new Error('WebGL 1 shader precision query failed');
  }
} finally {
  legacyCanvas.dispose();
}

const canvas = new OffscreenCanvas(32, 32);
try {
  const gl = canvas.getContext('webgl2');
  if (!(gl instanceof WebGL2RenderingContext)) throw new Error('ANGLE WebGL 2 not available');
  gl.clearColor(1,0,0,1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const pixel = new Uint8Array(4);
  gl.readPixels(4,4,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
  if (Array.from(pixel).join(',') !== '255,0,0,255') throw new Error('Incorrect WebGL pixel');
  canvas.resize(64,48);
  gl.clearColor(0,1,0,1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.readPixels(63,47,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
  if (Array.from(pixel).join(',') !== '0,255,0,255') throw new Error('Incorrect resized WebGL pixel');
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vertex, '#version 300 es\nlayout(location=0) in vec2 position; uniform mat2 transform; void main() { gl_Position = vec4(transform * position, 0., 1.); }');
  gl.compileShader(vertex);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fragment, '#version 300 es\nprecision mediump float; uniform sampler2D tile; layout(std140) uniform Tint { vec4 scale; }; out vec4 color; void main() { color = texture(tile, vec2(0.5)) * scale; }');
  gl.compileShader(fragment);
  if (!gl.getShaderParameter(vertex, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(vertex));
  if (!gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(fragment));
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const position = gl.getActiveAttrib(program, 0);
  if (gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) !== 1 ||
      position?.name !== 'position' || position.size !== 1 || gl.getAttribLocation(program, 'position') !== 0) {
    throw new Error('Unexpected ANGLE attribute reflection');
  }
  const uniforms = [];
  for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); index++) {
    uniforms.push(gl.getActiveUniform(program, index).name);
  }
  if (uniforms.length !== 3 ||
      !uniforms.includes('tile') || !uniforms.includes('transform') ||
      gl.getUniformLocation(program, 'tile') === null ||
      gl.getUniformLocation(program, 'missing') !== null) {
    throw new Error('Unexpected ANGLE uniform reflection');
  }
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(program);
  gl.uniformMatrix2fv(gl.getUniformLocation(program, 'transform'), false, [1, 0, 0, 1]);
  gl.uniform1i(gl.getUniformLocation(program, 'tile'), 1);
  const tintBlock = gl.getUniformBlockIndex(program, 'Tint');
  if (tintBlock === gl.INVALID_INDEX || gl.getActiveUniformBlockName(program, tintBlock) !== 'Tint' ||
      gl.getActiveUniformBlockParameter(program, tintBlock, gl.UNIFORM_BLOCK_DATA_SIZE) !== 16) {
    throw new Error('Unexpected ANGLE uniform block reflection');
  }
  const tint = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, tint);
  gl.bufferData(gl.UNIFORM_BUFFER, new Float32Array([1, 1, 0.25, 1]), gl.STATIC_DRAW);
  gl.bindBufferRange(gl.UNIFORM_BUFFER, 1, tint, 0, 16);
  gl.uniformBlockBinding(program, tintBlock, 1);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vertices = gl.createBuffer();
  const indices = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, 24, gl.DYNAMIC_DRAW);
  const positions = new Float32Array([99, -1, -1, 1, -1, 0, 1, 99]);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions.subarray(1, 7));
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2]), gl.STATIC_DRAW);
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + 1);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 255, 255]));
  gl.drawElementsInstanced(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0, 1);
  if (gl.getError() !== gl.NO_ERROR) throw new Error('ANGLE reported an error drawing indexed geometry');
  gl.readPixels(32, 24, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  if (pixel[0] !== 0 || pixel[1] !== 0 || (pixel[2] !== 63 && pixel[2] !== 64) || pixel[3] !== 255) {
    throw new Error('Incorrect uniform-block tint in triangle pixel');
  }
  gl.readPixels(63, 47, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  if (Array.from(pixel).join(',') !== '0,255,0,255') throw new Error('Triangle overwrote the background');
  gl.useProgram(null);
  gl.bindVertexArray(null);
  gl.deleteVertexArray(vao);
  gl.deleteBuffer(vertices);
  gl.deleteBuffer(indices);
  gl.deleteBuffer(tint);
  gl.deleteTexture(texture);
  gl.deleteProgram(program);
  const output = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, output);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 8, 8, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
  const depthStencil = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthStencil);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, 8, 8);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depthStencil);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('ANGLE offscreen framebuffer is incomplete');
  }
  gl.clearColor(1, 0, 1, 1);
  gl.clearStencil(0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.blitFramebuffer(0, 0, 8, 8, 0, 0, 8, 8, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (gl.getError() !== gl.NO_ERROR) throw new Error('ANGLE framebuffer blit failed');
  gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  if (Array.from(pixel).join(',') !== '255,0,255,255') throw new Error('Incorrect blitted pixel');
  const block = new Uint8Array(18).fill(7);
  gl.readPixels(2, 2, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, block, 1);
  if (Array.from(block).join(',') !== '7,255,0,255,255,255,0,255,255,255,0,255,255,255,0,255,255,7') {
    throw new Error('Incorrect rectangular WebGL readback');
  }
  gl.deleteRenderbuffer(depthStencil);
  gl.deleteFramebuffer(framebuffer);
  gl.deleteTexture(output);
  canvas.show();
  if (!canvas.present()) throw new Error('Could not present the native WebGL framebuffer');
  console.log('ANGLE WebGL indexed texture, framebuffer blit, resize, and presentation passed');
} finally {
  canvas.dispose();
}
