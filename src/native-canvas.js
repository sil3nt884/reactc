// Windows offscreen Canvas2D methods used by PixiJS's vector renderer.

function create(width, height) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_create(REACTC_CANVAS_NUM(width), REACTC_CANVAS_NUM(height));`;
  return result;
}

function resize(id, width, height) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_resize(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(width), REACTC_CANVAS_NUM(height));`;
  check(result);
}

function destroy(id) {
  Porffor.c`reactc_canvas_destroy(REACTC_CANVAS_NUM(id));`;
}

function matrix(id, append, a, b, c, d, e, f) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_transform(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(append), REACTC_CANVAS_NUM(a), REACTC_CANVAS_NUM(b), REACTC_CANVAS_NUM(c), REACTC_CANVAS_NUM(d), REACTC_CANVAS_NUM(e), REACTC_CANVAS_NUM(f));`;
  check(result);
}

function graphicsState(id, save) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_state(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(save));`;
  check(result);
}

function path(id, operation, a = 0, b = 0, c = 0, d = 0, e = 0, f = 0) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_path(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(operation), REACTC_CANVAS_NUM(a), REACTC_CANVAS_NUM(b), REACTC_CANVAS_NUM(c), REACTC_CANVAS_NUM(d), REACTC_CANVAS_NUM(e), REACTC_CANVAS_NUM(f));`;
  check(result);
}

function draw(id, operation, color = 0, x = 0, y = 0, width = 0, height = 0) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_draw(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(operation), REACTC_CANVAS_NUM(color), REACTC_CANVAS_NUM(x), REACTC_CANVAS_NUM(y), REACTC_CANVAS_NUM(width), REACTC_CANVAS_NUM(height));`;
  check(result);
}

function composite(id, copy) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_composite(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(copy));`;
  check(result);
}

function pixel(id, x, y) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_pixel(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(x), REACTC_CANVAS_NUM(y));`;
  return result;
}

function openWindow(id) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_open_window(REACTC_CANVAS_NUM(id));`;
  check(result);
}

function present(id) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_present(REACTC_CANVAS_NUM(id));`;
  return result;
}

function poll(id) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_poll(REACTC_CANVAS_NUM(id));`;
  return result;
}

function eventField(id, field) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_event_field(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(field));`;
  return result;
}

function image(id, source, sx, sy, sw, sh, dx, dy, dw, dh, alpha, smoothing) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_image(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(source), REACTC_CANVAS_NUM(sx), REACTC_CANVAS_NUM(sy), REACTC_CANVAS_NUM(sw), REACTC_CANVAS_NUM(sh), REACTC_CANVAS_NUM(dx), REACTC_CANVAS_NUM(dy), REACTC_CANVAS_NUM(dw), REACTC_CANVAS_NUM(dh), REACTC_CANVAS_NUM(alpha), REACTC_CANVAS_NUM(smoothing));`;
  check(result);
}

function filenameUnit(position, value) {
  Porffor.c`reactc_canvas_filename_unit(REACTC_CANVAS_NUM(position), REACTC_CANVAS_NUM(value));`;
}

function loadFile() {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_load_filename();`;
  return result;
}

function decodeImage(id, length) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_load_bytes(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(length));`;
  return result;
}

function size(id, height) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_size(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(height));`;
  return result;
}

function openGl(id, version) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_context(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(version));`;
  return result;
}

function glClearColor(id, red, green, blue, alpha) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_clear_color(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(red), REACTC_CANVAS_NUM(green), REACTC_CANVAS_NUM(blue), REACTC_CANVAS_NUM(alpha));`;
  check(result);
}

function glClear(id, mask) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_clear(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(mask));`;
  check(result);
}

function glPixel(id, x, y) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_pixel(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(x), REACTC_CANVAS_NUM(y));`;
  return result;
}

function glRead(id, x, y, width, height) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_read(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(x), REACTC_CANVAS_NUM(y), REACTC_CANVAS_NUM(width), REACTC_CANVAS_NUM(height));`;
  check(result);
}

function glReadByte(id, position) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_read_byte(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(position));`;
  return result;
}

function glCommand(id, operation, a = 0, b = 0, c = 0, d = 0) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_command(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(operation), REACTC_CANVAS_NUM(a), REACTC_CANVAS_NUM(b), REACTC_CANVAS_NUM(c), REACTC_CANVAS_NUM(d));`;
  return result;
}

function glQueryField(field, position = 0) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_query_field(REACTC_CANVAS_NUM(field), REACTC_CANVAS_NUM(position));`;
  return result;
}

function glQueryText(length) {
  let text = '';
  for (let position = 0; position < length; position++) text += String.fromCharCode(glQueryField(2, position));
  return text;
}

function glInput(text) {
  if (typeof text !== 'string') throw new TypeError('Expected a WebGL string');
  if (text.length > 32767) throw new RangeError('Text exceeds the native WebGL input buffer');
  for (let position = 0; position < text.length; position++) {
    const code = text.charCodeAt(position);
    if (code === 0 || code > 127) throw new TypeError('Native WebGL strings must be ASCII');
    filenameUnit(position, code);
  }
  filenameUnit(text.length, 0);
}

function activeVariable(id, operation, program, slot) {
  const length = glCommand(id, operation, program, slot);
  if (!length) return null;
  return { name: glQueryText(length), size: glQueryField(0), type: glQueryField(1) };
}

function prepareUpload(id, length) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_upload(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(length));`;
  check(result);
}

function uploadByte(id, position, value) {
  Porffor.c`reactc_canvas_gl_upload_byte(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(position), REACTC_CANVAS_NUM(value));`;
}

function glBuffer(id, target, replace, offset, length, usage) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_buffer(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(target), REACTC_CANVAS_NUM(replace), REACTC_CANVAS_NUM(offset), REACTC_CANVAS_NUM(length), REACTC_CANVAS_NUM(usage));`;
  check(result);
}

function glBufferRange(id, target, bindingPoint, buffer, offset, size) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_buffer_range(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(target), REACTC_CANVAS_NUM(bindingPoint), REACTC_CANVAS_NUM(buffer), REACTC_CANVAS_NUM(offset), REACTC_CANVAS_NUM(size));`;
  check(result);
}

function glCopyTexture(id, target, level, xoffset, yoffset, x, y, width, height) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_copy_texture(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(target), REACTC_CANVAS_NUM(level), REACTC_CANVAS_NUM(xoffset), REACTC_CANVAS_NUM(yoffset), REACTC_CANVAS_NUM(x), REACTC_CANVAS_NUM(y), REACTC_CANVAS_NUM(width), REACTC_CANVAS_NUM(height));`;
  check(result);
}

function glAttrib(id, slot, count, type, normalized, stride, offset) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_attrib(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(slot), REACTC_CANVAS_NUM(count), REACTC_CANVAS_NUM(type), REACTC_CANVAS_NUM(normalized), REACTC_CANVAS_NUM(stride), REACTC_CANVAS_NUM(offset));`;
  check(result);
}

function glTexture(id, replace, level, format, x, y, width, height) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_texture(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(replace), REACTC_CANVAS_NUM(level), REACTC_CANVAS_NUM(format), REACTC_CANVAS_NUM(x), REACTC_CANVAS_NUM(y), REACTC_CANVAS_NUM(width), REACTC_CANVAS_NUM(height));`;
  check(result);
}

function glDrawInstanced(id, mode, count, type, offset, instances) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_draw_instanced(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(mode), REACTC_CANVAS_NUM(count), REACTC_CANVAS_NUM(type), REACTC_CANVAS_NUM(offset), REACTC_CANVAS_NUM(instances));`;
  check(result);
}

function glPolygonOffset(id, factor, units) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_polygon_offset(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(factor), REACTC_CANVAS_NUM(units));`;
  check(result);
}

function glUniform(id, location, type, components, data) {
  if (location === null || data.length === 0) return;
  const values = type === 1 ? new Int32Array(data) :
    type === 2 ? new Uint32Array(data) : new Float32Array(data);
  upload(id, bufferBytes(values));
  glCommitUniform(id, location, type, components, values.length);
}

function glFramebufferTexture(id, target, attachment, textureTarget, texture, level) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_framebuffer_texture(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(target), REACTC_CANVAS_NUM(attachment), REACTC_CANVAS_NUM(textureTarget), REACTC_CANVAS_NUM(texture), REACTC_CANVAS_NUM(level));`;
  check(result);
}

function glSamples(id, target, samples, format, width, height) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_samples(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(target), REACTC_CANVAS_NUM(samples), REACTC_CANVAS_NUM(format), REACTC_CANVAS_NUM(width), REACTC_CANVAS_NUM(height));`;
  check(result);
}

function glSelectDrawBuffers(id, count) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_draw_buffers(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(count));`;
  check(result);
}

function glBlit(id, sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask, filter) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_blit(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(sx0), REACTC_CANVAS_NUM(sy0), REACTC_CANVAS_NUM(sx1), REACTC_CANVAS_NUM(sy1), REACTC_CANVAS_NUM(dx0), REACTC_CANVAS_NUM(dy0), REACTC_CANVAS_NUM(dx1), REACTC_CANVAS_NUM(dy1), REACTC_CANVAS_NUM(mask), REACTC_CANVAS_NUM(filter));`;
  check(result);
}

function glCommitUniform(id, location, type, components, length) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_gl_uniform(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(location), REACTC_CANVAS_NUM(type), REACTC_CANVAS_NUM(components), REACTC_CANVAS_NUM(length));`;
  check(result);
}

function check(result) {
  if (!result) throw new Error('Native canvas operation failed');
}

function dimension(value) {
  if (!Number.isInteger(value) || value < 1 || value > 4096) {
    throw new RangeError('Canvas dimensions must be integers from 1 to 4096');
  }
  return value;
}

function paintColor(style, alpha) {
  if (style === 'black') style = '#000000';
  if (style === 'white') style = '#ffffff';
  if (style === 'transparent') style = '#00000000';
  if (typeof style !== 'string' || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(style)) {
    throw new TypeError('Native Canvas2D paint requires a solid hexadecimal color');
  }
  const opacity = style.length === 9 ? Number.parseInt(style.slice(7), 16) : 255;
  return Math.round(alpha * opacity) * 0x1000000 + Number.parseInt(style.slice(1, 7), 16);
}

const defaultFont = { source: '10px sans-serif', size: 10, style: 0, families: ['sans-serif'] };
const baselines = ['alphabetic', 'top', 'hanging', 'middle', 'ideographic', 'bottom'];
const textAlignments = ['left', 'center', 'right', 'start', 'end'];

function parseFont(source) {
  if (typeof source !== 'string' || source.includes('\0')) return null;
  const match = /^\s*(.*?)\b(\d+(?:\.\d+)?)px(?:\s*\/\s*\S+)?\s+(.+)$/i.exec(source);
  if (!match) return null;
  const size = Number(match[2]);
  if (!(size > 0 && size <= 4096)) return null;
  const properties = match[1].toLowerCase().trim().split(/\s+/);
  const italic = properties.includes('italic') || properties.includes('oblique');
  const bold = properties.includes('bold') || properties.includes('bolder') ||
    properties.some(value => /^\d{3}$/.test(value) && Number(value) >= 600);
  const families = match[3].split(',').map(family => family.trim().replace(/^["']|["']$/g, ''));
  if (!families[0]) return null;
  return { source, size, style: (italic ? 2 : 0) | (bold ? 1 : 0), families };
}

function canvasText(id, text, font, baseline, align, operation, x, y, maxWidth, color, lineWidth) {
  const families = font.families.filter(name => name.length).join('\0') + '\0\0';
  const staged = families + text;
  if (staged.length > 32768) throw new RangeError('Native canvas text is too long');
  for (let position = 0; position < staged.length; position++) filenameUnit(position, staged.charCodeAt(position));
  commitText(id, families.length, text.length, font.size, font.style, baseline, align,
    operation, x, y, maxWidth, color, lineWidth);
}

function commitText(id, offset, length, size, style, baseline, align, operation, x, y, maxWidth, color, lineWidth) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_text(REACTC_CANVAS_NUM(id), REACTC_CANVAS_NUM(offset), REACTC_CANVAS_NUM(length), REACTC_CANVAS_NUM(size), REACTC_CANVAS_NUM(style), REACTC_CANVAS_NUM(baseline), REACTC_CANVAS_NUM(align), REACTC_CANVAS_NUM(operation), REACTC_CANVAS_NUM(x), REACTC_CANVAS_NUM(y), REACTC_CANVAS_NUM(maxWidth), REACTC_CANVAS_NUM(color), REACTC_CANVAS_NUM(lineWidth));`;
  check(result);
}

function textMetric(field) {
  let result = 0;
  Porffor.c`result = (f64)reactc_canvas_text_metric(REACTC_CANVAS_NUM(field));`;
  return result;
}

const caps = ['butt', 'round', 'square'];
const joins = ['miter', 'round', 'bevel'];

export class CanvasRenderingContext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.resetState();
  }

  resetState() {
    this.state = {
      fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1,
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
      font: defaultFont, textBaseline: 'alphabetic', textAlign: 'start',
    };
    this.stack = [];
  }

  get fillStyle() { return this.state.fillStyle; }
  set fillStyle(value) { paintColor(value, 1); this.state.fillStyle = value; }
  get strokeStyle() { return this.state.strokeStyle; }
  set strokeStyle(value) { paintColor(value, 1); this.state.strokeStyle = value; }
  get globalAlpha() { return this.state.globalAlpha; }
  set globalAlpha(value) {
    if (Number.isFinite(value) && value >= 0 && value <= 1) this.state.globalAlpha = value;
  }
  get globalCompositeOperation() { return this.state.globalCompositeOperation; }
  set globalCompositeOperation(value) {
    if (value !== 'source-over' && value !== 'copy') {
      throw new Error('Unsupported native Canvas2D composite operation: ' + value);
    }
    composite(this.canvas.handle(), value === 'copy' ? 1 : 0);
    this.state.globalCompositeOperation = value;
  }
  get imageSmoothingEnabled() { return this.state.imageSmoothingEnabled; }
  set imageSmoothingEnabled(value) { this.state.imageSmoothingEnabled = !!value; }
  get lineWidth() { return this.state.lineWidth; }
  set lineWidth(value) { if (Number.isFinite(value) && value > 0) this.state.lineWidth = value; }
  get miterLimit() { return this.state.miterLimit; }
  set miterLimit(value) { if (Number.isFinite(value) && value > 0) this.state.miterLimit = value; }
  get lineCap() { return this.state.lineCap; }
  set lineCap(value) { if (caps.includes(value)) this.state.lineCap = value; }
  get lineJoin() { return this.state.lineJoin; }
  set lineJoin(value) { if (joins.includes(value)) this.state.lineJoin = value; }
  get font() { return this.state.font.source; }
  set font(value) {
    const font = parseFont(value);
    if (font) this.state.font = font;
  }
  get textBaseline() { return this.state.textBaseline; }
  set textBaseline(value) { if (baselines.includes(value)) this.state.textBaseline = value; }
  get textAlign() { return this.state.textAlign; }
  set textAlign(value) { if (textAlignments.includes(value)) this.state.textAlign = value; }

  renderText(operation, text, x, y, maxWidth, color) {
    const align = this.textAlign === 'center' ? 1 : (this.textAlign === 'right' || this.textAlign === 'end' ? 2 : 0);
    canvasText(this.canvas.handle(), String(text), this.state.font, baselines.indexOf(this.textBaseline),
      align, operation, x, y, maxWidth, color, this.lineWidth);
  }
  measureText(text) {
    this.renderText(0, text, 0, 0, 0, 0);
    return {
      width: textMetric(0), actualBoundingBoxLeft: textMetric(1), actualBoundingBoxRight: textMetric(2),
      actualBoundingBoxAscent: textMetric(3), actualBoundingBoxDescent: textMetric(4),
      fontBoundingBoxAscent: textMetric(5), fontBoundingBoxDescent: textMetric(6),
    };
  }
  fillText(text, x, y, maxWidth) {
    if (!Number.isFinite(x) || !Number.isFinite(y) ||
        (maxWidth !== undefined && (!Number.isFinite(maxWidth) || maxWidth <= 0))) return;
    this.renderText(1, text, x, y, maxWidth ?? 0, paintColor(this.fillStyle, this.globalAlpha));
  }
  strokeText(text, x, y, maxWidth) {
    if (!Number.isFinite(x) || !Number.isFinite(y) ||
        (maxWidth !== undefined && (!Number.isFinite(maxWidth) || maxWidth <= 0))) return;
    this.renderText(2, text, x, y, maxWidth ?? 0, paintColor(this.strokeStyle, this.globalAlpha));
  }

  save() {
    graphicsState(this.canvas.handle(), 1);
    this.stack.push({ ...this.state });
  }
  restore() {
    if (!this.stack.length) return;
    graphicsState(this.canvas.handle(), 0);
    this.state = this.stack.pop();
  }
  setTransform(a, b, c, d, e, f) { matrix(this.canvas.handle(), 0, a, b, c, d, e, f); }
  resetTransform() { this.setTransform(1, 0, 0, 1, 0, 0); }
  transform(a, b, c, d, e, f) { matrix(this.canvas.handle(), 1, a, b, c, d, e, f); }
  translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
  scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
  rotate(angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.transform(cos, sin, -sin, cos, 0, 0);
  }

  beginPath() { path(this.canvas.handle(), 0); }
  moveTo(x, y) { path(this.canvas.handle(), 1, x, y); }
  lineTo(x, y) { path(this.canvas.handle(), 2, x, y); }
  closePath() { path(this.canvas.handle(), 3); }
  rect(x, y, width, height) { path(this.canvas.handle(), 4, x, y, width, height); }
  bezierCurveTo(x1, y1, x2, y2, x, y) { path(this.canvas.handle(), 5, x1, y1, x2, y2, x, y); }
  quadraticCurveTo(x1, y1, x, y) { path(this.canvas.handle(), 6, x1, y1, x, y); }
  clearRect(x, y, width, height) { draw(this.canvas.handle(), 0, 0, x, y, width, height); }
  fillRect(x, y, width, height) {
    draw(this.canvas.handle(), 1, paintColor(this.fillStyle, this.globalAlpha), x, y, width, height);
  }
  fill(rule = 'nonzero') {
    draw(this.canvas.handle(), rule === 'evenodd' ? 3 : 2, paintColor(this.fillStyle, this.globalAlpha));
  }
  stroke() {
    draw(this.canvas.handle(), 4, paintColor(this.strokeStyle, this.globalAlpha),
      caps.indexOf(this.lineCap), joins.indexOf(this.lineJoin), this.lineWidth, this.miterLimit);
  }
  clip(rule = 'nonzero') { draw(this.canvas.handle(), rule === 'evenodd' ? 6 : 5); }
  drawImage(source, ...args) {
    if (!(source instanceof OffscreenCanvas)) throw new TypeError('Expected a native canvas image source');
    let sx = 0, sy = 0, sw = source.width, sh = source.height;
    let dx, dy, dw = sw, dh = sh;
    if (args.length === 2) [dx, dy] = args;
    else if (args.length === 4) [dx, dy, dw, dh] = args;
    else if (args.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    else throw new TypeError('Invalid drawImage argument count');
    image(this.canvas.handle(), source.handle(), sx, sy, sw, sh, dx, dy, dw, dh,
      this.globalAlpha, this.imageSmoothingEnabled ? 1 : 0);
  }
  getImageData(x, y, width, height) {
    const id = this.canvas.handle();
    width = dimension(width);
    height = dimension(height);
    x = Math.trunc(x);
    y = Math.trunc(y);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const rgba = pixel(id, x + column, y + row);
        const at = (row * width + column) * 4;
        data[at] = (rgba >>> 16) & 255;
        data[at + 1] = (rgba >>> 8) & 255;
        data[at + 2] = rgba & 255;
        data[at + 3] = rgba >>> 24;
      }
    }
    return { data, width, height };
  }
}

const loadedCanvas = {};

function bufferBytes(data) {
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new TypeError('Expected an ArrayBuffer or view');
}

function upload(id, data) {
  const length = typeof data === 'number' ? data : data.byteLength;
  if (!Number.isInteger(length) || length < 0 || length > 64 * 1024 * 1024) {
    throw new RangeError('WebGL buffer upload size is out of range');
  }
  prepareUpload(id, length);
  if (typeof data !== 'number') {
    for (let position = 0; position < length; position++) uploadByte(id, position, data[position]);
  }
  return length;
}

class NativeWebGLContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.COLOR_BUFFER_BIT = 0x4000;
    this.DEPTH_BUFFER_BIT = 0x0100;
    this.STENCIL_BUFFER_BIT = 0x0400;
    this.RGBA = 0x1908;
    this.UNSIGNED_BYTE = 0x1401;
    this.VERTEX_SHADER = 0x8b31;
    this.FRAGMENT_SHADER = 0x8b30;
    this.COMPILE_STATUS = 0x8b81;
    this.LINK_STATUS = 0x8b82;
    this.ACTIVE_ATTRIBUTES = 0x8b89;
    this.ACTIVE_UNIFORMS = 0x8b86;
    this.ACTIVE_UNIFORM_BLOCKS = 0x8a36;
    this.UNIFORM_BUFFER = 0x8a11;
    this.UNIFORM_BLOCK_BINDING = 0x8a3f;
    this.UNIFORM_BLOCK_DATA_SIZE = 0x8a40;
    this.UNIFORM_BLOCK_ACTIVE_UNIFORMS = 0x8a42;
    this.UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER = 0x8a44;
    this.UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER = 0x8a46;
    this.INVALID_INDEX = 0xffffffff;
    this.TRIANGLES = 0x0004;
    this.FLOAT = 0x1406;
    this.UNSIGNED_SHORT = 0x1403;
    this.UNSIGNED_INT = 0x1405;
    this.ARRAY_BUFFER = 0x8892;
    this.ELEMENT_ARRAY_BUFFER = 0x8893;
    this.STATIC_DRAW = 0x88e4;
    this.DYNAMIC_DRAW = 0x88e8;
    this.MAX_TEXTURE_IMAGE_UNITS = 0x8872;
    this.MAX_UNIFORM_BUFFER_BINDINGS = 0x8a2f;
    this.NO_ERROR = 0;
    this.ZERO = 0;
    this.ONE = 1;
    this.SRC_ALPHA = 0x0302;
    this.ONE_MINUS_SRC_ALPHA = 0x0303;
    this.DST_COLOR = 0x0306;
    this.ONE_MINUS_SRC_COLOR = 0x0301;
    this.FUNC_ADD = 0x8006;
    this.MIN = 0x8007;
    this.MAX = 0x8008;
    this.CW = 0x0900;
    this.CCW = 0x0901;
    this.BLEND = 0x0be2;
    this.DEPTH_TEST = 0x0b71;
    this.STENCIL_TEST = 0x0b90;
    this.CULL_FACE = 0x0b44;
    this.POLYGON_OFFSET_FILL = 0x8037;
    this.FRAMEBUFFER = 0x8d40;
    this.DRAW_FRAMEBUFFER = 0x8ca9;
    this.READ_FRAMEBUFFER = 0x8ca8;
    this.TEXTURE0 = 0x84c0;
    this.TEXTURE_2D = 0x0de1;
    this.TEXTURE_3D = 0x806f;
    this.TEXTURE_CUBE_MAP = 0x8513;
    this.TEXTURE_2D_ARRAY = 0x8c1a;
    this.TEXTURE_MIN_FILTER = 0x2801;
    this.TEXTURE_MAG_FILTER = 0x2800;
    this.TEXTURE_WRAP_S = 0x2802;
    this.TEXTURE_WRAP_T = 0x2803;
    this.TEXTURE_BASE_LEVEL = 0x813c;
    this.TEXTURE_MAX_LEVEL = 0x813d;
    this.TEXTURE_COMPARE_MODE = 0x884c;
    this.TEXTURE_COMPARE_FUNC = 0x884d;
    this.NEAREST = 0x2600;
    this.LINEAR = 0x2601;
    this.RGBA8 = 0x8058;
    this.UNPACK_ALIGNMENT = 0x0cf5;
    this.UNPACK_FLIP_Y_WEBGL = 0x9240;
    this.UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241;
    this.HIGH_FLOAT = 0x8df2;
    this.MEDIUM_FLOAT = 0x8df1;
    this.LOW_FLOAT = 0x8df0;
    this.HIGH_INT = 0x8df5;
    this.MEDIUM_INT = 0x8df4;
    this.LOW_INT = 0x8df3;
    this.POINTS = 0x0000;
    this.LINES = 0x0001;
    this.LINE_LOOP = 0x0002;
    this.LINE_STRIP = 0x0003;
    this.TRIANGLE_STRIP = 0x0005;
    this.TRIANGLE_FAN = 0x0006;
    this.BYTE = 0x1400;
    this.SHORT = 0x1402;
    this.INT = 0x1404;
    this.HALF_FLOAT = 0x140b;
    this.FLOAT_VEC2 = 0x8b50;
    this.FLOAT_VEC3 = 0x8b51;
    this.FLOAT_VEC4 = 0x8b52;
    this.INT_VEC2 = 0x8b53;
    this.INT_VEC3 = 0x8b54;
    this.INT_VEC4 = 0x8b55;
    this.BOOL = 0x8b56;
    this.BOOL_VEC2 = 0x8b57;
    this.BOOL_VEC3 = 0x8b58;
    this.BOOL_VEC4 = 0x8b59;
    this.FLOAT_MAT2 = 0x8b5a;
    this.FLOAT_MAT3 = 0x8b5b;
    this.FLOAT_MAT4 = 0x8b5c;
    this.SAMPLER_2D = 0x8b5e;
    this.SAMPLER_CUBE = 0x8b60;
    this.UNSIGNED_INT_VEC2 = 0x8dc6;
    this.UNSIGNED_INT_VEC3 = 0x8dc7;
    this.UNSIGNED_INT_VEC4 = 0x8dc8;
    this.SCISSOR_TEST = 0x0c11;
    this.STREAM_DRAW = 0x88e0;
    this.REPEAT = 0x2901;
    this.CLAMP_TO_EDGE = 0x812f;
    this.MIRRORED_REPEAT = 0x8370;
    this.NEAREST_MIPMAP_NEAREST = 0x2700;
    this.LINEAR_MIPMAP_NEAREST = 0x2701;
    this.NEAREST_MIPMAP_LINEAR = 0x2702;
    this.LINEAR_MIPMAP_LINEAR = 0x2703;
    this.NONE = 0x0000;
    this.COLOR_ATTACHMENT0 = 0x8ce0;
    this.DEPTH_ATTACHMENT = 0x8d00;
    this.STENCIL_ATTACHMENT = 0x8d20;
    this.DEPTH_STENCIL_ATTACHMENT = 0x821a;
    this.RENDERBUFFER = 0x8d41;
    this.FRAMEBUFFER_COMPLETE = 0x8cd5;
    this.DEPTH24_STENCIL8 = 0x88f0;
    this.DEPTH_STENCIL = 0x84f9;
    this.BACK = 0x0405;
    this.KEEP = 0x1e00;
    this.REPLACE = 0x1e01;
    this.INCR = 0x1e02;
    this.DECR = 0x1e03;
    this.INVERT = 0x150a;
    this.INCR_WRAP = 0x8507;
    this.DECR_WRAP = 0x8508;
    this.NEVER = 0x0200;
    this.LESS = 0x0201;
    this.EQUAL = 0x0202;
    this.LEQUAL = 0x0203;
    this.GREATER = 0x0204;
    this.NOTEQUAL = 0x0205;
    this.GEQUAL = 0x0206;
    this.ALWAYS = 0x0207;
    this.unpackFlipY = false;
    this.unpackPremultiplyAlpha = false;
  }
  get drawingBufferWidth() { return this.canvas.width; }
  get drawingBufferHeight() { return this.canvas.height; }
  clearColor(red, green, blue, alpha) { glClearColor(this.canvas.handle(), red, green, blue, alpha); }
  clear(mask) { glClear(this.canvas.handle(), mask); }
  viewport(x, y, width, height) { check(glCommand(this.canvas.handle(), 0, x, y, width, height)); }
  createShader(type) { return glCommand(this.canvas.handle(), 1, type) || null; }
  shaderSource(shader, source) {
    glInput(source);
    check(glCommand(this.canvas.handle(), 2, shader));
  }
  compileShader(shader) { check(glCommand(this.canvas.handle(), 3, shader)); }
  getShaderParameter(shader, parameter) { return glCommand(this.canvas.handle(), 4, shader, parameter) !== 0; }
  getShaderInfoLog(shader) { return glQueryText(glCommand(this.canvas.handle(), 21, shader)); }
  deleteShader(shader) { check(glCommand(this.canvas.handle(), 5, shader)); }
  createProgram() { return glCommand(this.canvas.handle(), 6) || null; }
  attachShader(program, shader) { check(glCommand(this.canvas.handle(), 7, program, shader)); }
  linkProgram(program) { check(glCommand(this.canvas.handle(), 8, program)); }
  getProgramParameter(program, parameter) {
    const value = glCommand(this.canvas.handle(), 9, program, parameter);
    return parameter === this.LINK_STATUS ? value !== 0 : value;
  }
  getProgramInfoLog(program) { return glQueryText(glCommand(this.canvas.handle(), 22, program)); }
  getActiveAttrib(program, slot) { return activeVariable(this.canvas.handle(), 23, program, slot); }
  getActiveUniform(program, slot) { return activeVariable(this.canvas.handle(), 24, program, slot); }
  getActiveUniformBlockName(program, index) {
    const length = glCommand(this.canvas.handle(), 66, program, index);
    return length ? glQueryText(length) : null;
  }
  getUniformBlockIndex(program, name) {
    glInput(name);
    return glCommand(this.canvas.handle(), 67, program) >>> 0;
  }
  getActiveUniformBlockParameter(program, index, parameter) {
    const value = glCommand(this.canvas.handle(), 68, program, index, parameter);
    return parameter === this.UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER ||
      parameter === this.UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER ? value !== 0 : value;
  }
  uniformBlockBinding(program, index, binding) {
    check(glCommand(this.canvas.handle(), 69, program, index, binding));
  }
  getAttribLocation(program, name) {
    glInput(name);
    return glCommand(this.canvas.handle(), 25, program);
  }
  getUniformLocation(program, name) {
    glInput(name);
    const location = glCommand(this.canvas.handle(), 26, program);
    return location < 0 ? null : location;
  }
  bindAttribLocation(program, slot, name) {
    glInput(name);
    check(glCommand(this.canvas.handle(), 27, program, slot));
  }
  useProgram(program) { check(glCommand(this.canvas.handle(), 10, program ?? 0)); }
  deleteProgram(program) { check(glCommand(this.canvas.handle(), 11, program)); }
  drawArrays(mode, first, count) { check(glCommand(this.canvas.handle(), 12, mode, first, count)); }
  createBuffer() { return glCommand(this.canvas.handle(), 13) || null; }
  deleteBuffer(buffer) { if (buffer !== null) check(glCommand(this.canvas.handle(), 14, buffer)); }
  bindBuffer(target, buffer) {
    // Native uploads and readback use CPU memory, so do not expose pixel buffers yet.
    if (target === 0x88eb || target === 0x88ec) throw new Error('Native WebGL pixel buffers are unavailable');
    check(glCommand(this.canvas.handle(), 15, target, buffer ?? 0));
  }
  bindBufferBase(target, index, buffer) {
    check(glCommand(this.canvas.handle(), 70, target, index, buffer ?? 0));
  }
  bindBufferRange(target, index, buffer, offset, size) {
    glBufferRange(this.canvas.handle(), target, index, buffer ?? 0, offset, size);
  }
  bufferData(target, data, usage) {
    const id = this.canvas.handle();
    const bytes = typeof data === 'number' ? data : bufferBytes(data);
    glBuffer(id, target, 1, 0, upload(id, bytes), usage);
  }
  bufferSubData(target, offset, data) {
    const id = this.canvas.handle();
    glBuffer(id, target, 0, offset, upload(id, bufferBytes(data)), 0);
  }
  enableVertexAttribArray(slot) { check(glCommand(this.canvas.handle(), 16, slot)); }
  disableVertexAttribArray(slot) { check(glCommand(this.canvas.handle(), 17, slot)); }
  vertexAttribPointer(slot, size, type, normalized, stride, offset) {
    glAttrib(this.canvas.handle(), slot, size, type, normalized ? 1 : 0, stride, offset);
  }
  vertexAttribIPointer(slot, size, type, stride, offset) {
    glAttrib(this.canvas.handle(), slot, size, type, -1, stride, offset);
  }
  drawElements(mode, count, type, offset) {
    check(glCommand(this.canvas.handle(), 18, mode, count, type, offset));
  }

  createVertexArray() { return glCommand(this.canvas.handle(), 45) || null; }
  deleteVertexArray(vao) { if (vao !== null) check(glCommand(this.canvas.handle(), 46, vao)); }
  bindVertexArray(vao) { check(glCommand(this.canvas.handle(), 47, vao ?? 0)); }
  vertexAttribDivisor(index, divisor) { check(glCommand(this.canvas.handle(), 48, index, divisor)); }
  drawArraysInstanced(mode, first, count, instances) {
    check(glCommand(this.canvas.handle(), 49, mode, first, count, instances));
  }
  drawElementsInstanced(mode, count, type, offset, instances) {
    glDrawInstanced(this.canvas.handle(), mode, count, type, offset, instances);
  }
  getShaderPrecisionFormat(shaderType, precisionType) {
    check(glCommand(this.canvas.handle(), 50, shaderType, precisionType));
    return { rangeMin: glQueryField(0), rangeMax: glQueryField(1), precision: glQueryField(3) };
  }
  scissor(x, y, width, height) { check(glCommand(this.canvas.handle(), 51, x, y, width, height)); }
  polygonOffset(factor, units) { glPolygonOffset(this.canvas.handle(), factor, units); }
  uniform1f(location, x) { this.uniform1fv(location, [x]); }
  uniform2f(location, x, y) { this.uniform2fv(location, [x, y]); }
  uniform3f(location, x, y, z) { this.uniform3fv(location, [x, y, z]); }
  uniform4f(location, x, y, z, w) { this.uniform4fv(location, [x, y, z, w]); }
  uniform1fv(location, data) { glUniform(this.canvas.handle(), location, 0, 1, data); }
  uniform2fv(location, data) { glUniform(this.canvas.handle(), location, 0, 2, data); }
  uniform3fv(location, data) { glUniform(this.canvas.handle(), location, 0, 3, data); }
  uniform4fv(location, data) { glUniform(this.canvas.handle(), location, 0, 4, data); }
  uniform1i(location, x) { this.uniform1iv(location, [x]); }
  uniform2i(location, x, y) { this.uniform2iv(location, [x, y]); }
  uniform3i(location, x, y, z) { this.uniform3iv(location, [x, y, z]); }
  uniform4i(location, x, y, z, w) { this.uniform4iv(location, [x, y, z, w]); }
  uniform1iv(location, data) { glUniform(this.canvas.handle(), location, 1, 1, data); }
  uniform2iv(location, data) { glUniform(this.canvas.handle(), location, 1, 2, data); }
  uniform3iv(location, data) { glUniform(this.canvas.handle(), location, 1, 3, data); }
  uniform4iv(location, data) { glUniform(this.canvas.handle(), location, 1, 4, data); }
  uniform1ui(location, x) { this.uniform1uiv(location, [x]); }
  uniform2ui(location, x, y) { this.uniform2uiv(location, [x, y]); }
  uniform3ui(location, x, y, z) { this.uniform3uiv(location, [x, y, z]); }
  uniform4ui(location, x, y, z, w) { this.uniform4uiv(location, [x, y, z, w]); }
  uniform1uiv(location, data) { glUniform(this.canvas.handle(), location, 2, 1, data); }
  uniform2uiv(location, data) { glUniform(this.canvas.handle(), location, 2, 2, data); }
  uniform3uiv(location, data) { glUniform(this.canvas.handle(), location, 2, 3, data); }
  uniform4uiv(location, data) { glUniform(this.canvas.handle(), location, 2, 4, data); }
  uniformMatrix2fv(location, transpose, data) {
    if (transpose) throw new TypeError('WebGL matrix uploads require transpose to be false');
    glUniform(this.canvas.handle(), location, 3, 4, data);
  }
  uniformMatrix3fv(location, transpose, data) {
    if (transpose) throw new TypeError('WebGL matrix uploads require transpose to be false');
    glUniform(this.canvas.handle(), location, 3, 9, data);
  }
  uniformMatrix4fv(location, transpose, data) {
    if (transpose) throw new TypeError('WebGL matrix uploads require transpose to be false');
    glUniform(this.canvas.handle(), location, 3, 16, data);
  }
  getError() { return glCommand(this.canvas.handle(), 19); }
  getParameter(parameter) {
    if (parameter === this.MAX_TEXTURE_IMAGE_UNITS || parameter === this.MAX_UNIFORM_BUFFER_BINDINGS) {
      return glCommand(this.canvas.handle(), 20, parameter);
    }
    throw new Error('Unsupported native WebGL parameter: ' + parameter);
  }
  getContextAttributes() {
    return {
      alpha: true, depth: true, stencil: true, antialias: false,
      premultipliedAlpha: false, preserveDrawingBuffer: true,
    };
  }
  getExtension() { return null; }
  isContextLost() { return !this.canvas.id || glCommand(this.canvas.handle(), 44) === 0; }
  enable(capability) { check(glCommand(this.canvas.handle(), 28, capability)); }
  disable(capability) { check(glCommand(this.canvas.handle(), 29, capability)); }
  depthMask(enabled) { check(glCommand(this.canvas.handle(), 30, enabled ? 1 : 0)); }
  colorMask(red, green, blue, alpha) {
    check(glCommand(this.canvas.handle(), 31, red ? 1 : 0, green ? 1 : 0, blue ? 1 : 0, alpha ? 1 : 0));
  }
  frontFace(mode) { check(glCommand(this.canvas.handle(), 32, mode)); }
  blendFunc(source, destination) { check(glCommand(this.canvas.handle(), 33, source, destination)); }
  blendFuncSeparate(sourceRGB, destinationRGB, sourceAlpha, destinationAlpha) {
    check(glCommand(this.canvas.handle(), 34, sourceRGB, destinationRGB, sourceAlpha, destinationAlpha));
  }
  blendEquationSeparate(rgb, alpha) { check(glCommand(this.canvas.handle(), 35, rgb, alpha)); }
  bindFramebuffer(target, framebuffer) { check(glCommand(this.canvas.handle(), 36, target, framebuffer ?? 0)); }
  createFramebuffer() { return glCommand(this.canvas.handle(), 52) || null; }
  createRenderbuffer() { return glCommand(this.canvas.handle(), 53) || null; }
  deleteFramebuffer(framebuffer) { if (framebuffer !== null) check(glCommand(this.canvas.handle(), 54, framebuffer)); }
  deleteRenderbuffer(renderbuffer) { if (renderbuffer !== null) check(glCommand(this.canvas.handle(), 55, renderbuffer)); }
  checkFramebufferStatus(target) { return glCommand(this.canvas.handle(), 56, target); }
  bindRenderbuffer(target, buffer) { check(glCommand(this.canvas.handle(), 57, target, buffer ?? 0)); }
  renderbufferStorage(target, format, width, height) {
    check(glCommand(this.canvas.handle(), 58, target, format, width, height));
  }
  renderbufferStorageMultisample(target, samples, format, width, height) {
    glSamples(this.canvas.handle(), target, samples, format, width, height);
  }
  framebufferRenderbuffer(target, attachment, renderbufferTarget, buffer) {
    check(glCommand(this.canvas.handle(), 59, target, attachment, renderbufferTarget, buffer ?? 0));
  }
  framebufferTexture2D(target, attachment, textureTarget, texture, level) {
    glFramebufferTexture(this.canvas.handle(), target, attachment, textureTarget, texture ?? 0, level);
  }
  drawBuffers(attachments) {
    const id = this.canvas.handle();
    const values = new Uint32Array(attachments);
    upload(id, bufferBytes(values));
    glSelectDrawBuffers(id, values.length);
  }
  readBuffer(attachment) { check(glCommand(this.canvas.handle(), 60, attachment)); }
  blitFramebuffer(sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask, filter) {
    glBlit(this.canvas.handle(), sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask, filter);
  }
  stencilFunc(func, reference, mask) { check(glCommand(this.canvas.handle(), 61, func, reference, mask)); }
  stencilOp(fail, depthFail, pass) { check(glCommand(this.canvas.handle(), 62, fail, depthFail, pass)); }
  stencilMask(mask) { check(glCommand(this.canvas.handle(), 63, mask)); }
  clearStencil(value) { check(glCommand(this.canvas.handle(), 64, value)); }
  depthFunc(func) { check(glCommand(this.canvas.handle(), 65, func)); }
  createTexture() { return glCommand(this.canvas.handle(), 37) || null; }
  deleteTexture(texture) { if (texture !== null) check(glCommand(this.canvas.handle(), 38, texture)); }
  bindTexture(target, texture) { check(glCommand(this.canvas.handle(), 39, target, texture ?? 0)); }
  activeTexture(unit) { check(glCommand(this.canvas.handle(), 40, unit)); }
  texParameteri(target, parameter, value) { check(glCommand(this.canvas.handle(), 41, target, parameter, value)); }
  generateMipmap(target) { check(glCommand(this.canvas.handle(), 42, target)); }
  pixelStorei(parameter, value) {
    if (parameter === this.UNPACK_FLIP_Y_WEBGL) this.unpackFlipY = !!value;
    else if (parameter === this.UNPACK_PREMULTIPLY_ALPHA_WEBGL) this.unpackPremultiplyAlpha = !!value;
    else if (parameter === this.UNPACK_ALIGNMENT) check(glCommand(this.canvas.handle(), 43, parameter, value));
    else throw new Error('Unsupported native WebGL pixel store parameter: ' + parameter);
  }
  uploadTexture(target, replace, level, internalFormat, x, y, width, height, format, type, source) {
    if (target !== this.TEXTURE_2D || format !== this.RGBA || type !== this.UNSIGNED_BYTE ||
        (internalFormat !== this.RGBA && internalFormat !== this.RGBA8)) {
      throw new Error('Native WebGL texture upload currently requires 2D RGBA8');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) ||
        width < 0 || height < 0 || width > 4096 || height > 4096) {
      throw new RangeError('Native WebGL texture dimensions are out of range');
    }
    const id = this.canvas.handle();
    const length = width * height * 4;
    if (source instanceof OffscreenCanvas || source instanceof CanvasImage) {
      const image = source instanceof CanvasImage
        ? source.imageData
        : source.getContext('2d').getImageData(0, 0, width, height);
      if (!image || width > image.width || height > image.height) {
        throw new RangeError('Native WebGL texture source is too small');
      }
      const bytes = image.data;
      prepareUpload(id, length);
      for (let row = 0; row < height; row++) {
        const from = (this.unpackFlipY ? height - row - 1 : row) * image.width * 4;
        for (let column = 0; column < width * 4; column += 4) {
          const alpha = bytes[from + column + 3];
          const opacity = this.unpackPremultiplyAlpha ? alpha / 255 : 1;
          const to = row * width * 4 + column;
          uploadByte(id, to, Math.round(bytes[from + column] * opacity));
          uploadByte(id, to + 1, Math.round(bytes[from + column + 1] * opacity));
          uploadByte(id, to + 2, Math.round(bytes[from + column + 2] * opacity));
          uploadByte(id, to + 3, alpha);
        }
      }
    } else if (source == null && replace) {
      prepareUpload(id, length);
    } else {
      const bytes = bufferBytes(source);
      if (bytes.byteLength < length) throw new RangeError('Native WebGL texture source is too short');
      upload(id, bytes.subarray(0, length));
    }
    glTexture(id, replace, level, internalFormat, x, y, width, height);
  }
  texImage2D(target, level, internalFormat, ...args) {
    if (args.length === 3) {
      const [format, type, source] = args;
      this.uploadTexture(target, 1, level, internalFormat, 0, 0, source.width, source.height, format, type, source);
      return;
    }
    const [width, height, border, format, type, source] = args;
    if (args.length !== 6 || border !== 0) throw new TypeError('Invalid native texImage2D arguments');
    this.uploadTexture(target, 1, level, internalFormat, 0, 0, width, height, format, type, source);
  }
  texSubImage2D(target, level, x, y, ...args) {
    if (args.length === 3) {
      const [format, type, source] = args;
      this.uploadTexture(target, 0, level, format, x, y, source.width, source.height, format, type, source);
      return;
    }
    if (args.length !== 5) throw new TypeError('Invalid native texSubImage2D arguments');
    const [width, height, format, type, source] = args;
    this.uploadTexture(target, 0, level, format, x, y, width, height, format, type, source);
  }
  copyTexSubImage2D(target, level, xoffset, yoffset, x, y, width, height) {
    glCopyTexture(this.canvas.handle(), target, level, xoffset, yoffset, x, y, width, height);
  }
  readPixels(x, y, width, height, format, type, pixels, offset = 0) {
    if (format !== this.RGBA || type !== this.UNSIGNED_BYTE || !(pixels instanceof Uint8Array)) {
      throw new TypeError('Native WebGL readback requires an RGBA8 byte array');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) ||
        width < 0 || height < 0 || width > 4096 || height > 4096 ||
        !Number.isInteger(offset) || offset < 0 || offset + width * height * 4 > pixels.length) {
      throw new RangeError('Native WebGL readback is out of range');
    }
    if (!width || !height) return;
    const id = this.canvas.handle();
    if (width === 1 && height === 1) {
      const rgba = glPixel(id, x, y);
      pixels[offset] = (rgba >>> 16) & 255;
      pixels[offset + 1] = (rgba >>> 8) & 255;
      pixels[offset + 2] = rgba & 255;
      pixels[offset + 3] = rgba >>> 24;
      return;
    }
    const length = width * height * 4;
    prepareUpload(id, length);
    glRead(id, x, y, width, height);
    for (let position = 0; position < length; position++) {
      pixels[offset + position] = glReadByte(id, position);
    }
  }
}

export class WebGLRenderingContext extends NativeWebGLContext {}
export class WebGL2RenderingContext extends NativeWebGLContext {}

export class CanvasImage {
  constructor(resolvePath, fetchResource) {
    this.resolvePath = resolvePath;
    this.fetchResource = fetchResource;
    this.filename = '';
    this.imageData = null;
    this.request = 0;
  }

  get src() { return this.filename; }
  set src(source) {
    this.filename = source;
    this.imageData = null;
    const request = ++this.request;
    if (/^(?:https?:|data:)/i.test(source)) {
      this.loadRemote(source, request);
      return;
    }
    this.store(OffscreenCanvas.fromFile(this.resolvePath(source)));
    this.onload?.();
  }
  async loadRemote(source, request) {
    try {
      const response = await this.fetchResource(source);
      if (!response.ok) throw new Error('Could not load image (' + response.status + ')');
      const bytes = await response.arrayBuffer();
      if (request !== this.request) return;
      this.store(OffscreenCanvas.fromBytes(bytes));
    } catch (error) {
      if (request === this.request) this.onerror?.(error);
      return;
    }
    this.onload?.();
  }
  store(canvas) {
    try {
      this.imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    } finally {
      canvas.dispose();
    }
  }
  get complete() { return this.imageData !== null; }
  get width() { return this.imageData?.width ?? 0; }
  get height() { return this.imageData?.height ?? 0; }
  get naturalWidth() { return this.width; }
  get naturalHeight() { return this.height; }
}

class CanvasEventTarget {
  constructor() {
    this.eventListeners = new Map();
  }
  addEventListener(type, listener) {
    let listeners = this.eventListeners.get(type);
    if (!listeners) {
      listeners = [];
      this.eventListeners.set(type, listeners);
    }
    if (listener && !listeners.includes(listener)) listeners.push(listener);
  }
  removeEventListener(type, listener) {
    const listeners = this.eventListeners.get(type);
    if (!listeners) return;
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }
  dispatchEvent(event) {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      for (const listener of listeners.slice()) {
        if (listeners.includes(listener)) listener.call(this, event);
      }
    }
    return !event.defaultPrevented;
  }
}

export class OffscreenCanvas extends CanvasEventTarget {
  constructor(width = 300, height = 150, source, handle) {
    super();
    this.pixelWidth = dimension(width);
    this.pixelHeight = dimension(height);
    this.windowWidth = null;
    this.windowHeight = null;
    this.id = source === loadedCanvas ? handle : create(width, height);
    check(this.id);
    this.context = new CanvasRenderingContext2D(this);
  }

  static fromFile(filename) {
    if (typeof filename !== 'string' || !filename.length || filename.length > 32767 || filename.includes('\0')) {
      throw new TypeError('Expected a Windows image path');
    }
    for (let index = 0; index < filename.length; index++) filenameUnit(index, filename.charCodeAt(index));
    filenameUnit(filename.length, 0);
    return OffscreenCanvas.fromHandle(loadFile());
  }

  static fromBytes(data) {
    const staging = new OffscreenCanvas(1, 1);
    try {
      const id = staging.handle();
      const length = upload(id, bufferBytes(data));
      return OffscreenCanvas.fromHandle(decodeImage(id, length));
    } finally {
      staging.dispose();
    }
  }

  static fromHandle(handle) {
    check(handle);
    try {
      return new OffscreenCanvas(size(handle, 0), size(handle, 1), loadedCanvas, handle);
    } catch (error) {
      destroy(handle);
      throw error;
    }
  }

  handle() { check(this.id); return this.id; }
  get width() { return this.pixelWidth; }
  set width(value) { this.resize(value, this.pixelHeight); }
  get height() { return this.pixelHeight; }
  set height(value) { this.resize(this.pixelWidth, value); }
  get clientWidth() { return this.windowWidth ?? this.width; }
  get clientHeight() { return this.windowHeight ?? this.height; }
  get isConnected() { return this.windowWidth !== null; }
  getBoundingClientRect() {
    const width = this.clientWidth;
    const height = this.clientHeight;
    return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height };
  }
  resize(width, height) {
    width = dimension(width);
    height = dimension(height);
    resize(this.handle(), width, height);
    this.pixelWidth = width;
    this.pixelHeight = height;
    this.context.resetState();
  }
  getContext(kind) {
    const id = this.handle();
    if (this.contextType && this.contextType !== kind) return null;
    if (kind === '2d') {
      this.contextType = kind;
      return this.context;
    }
    if (kind === 'webgl' || kind === 'webgl2') {
      if (this.gl) return this.gl;
      if (!openGl(id, kind === 'webgl2' ? 3 : 2)) return null;
      this.gl = kind === 'webgl2' ? new WebGL2RenderingContext(this) : new WebGLRenderingContext(this);
      this.contextType = kind;
      return this.gl;
    }
    return null;
  }
  show() {
    openWindow(this.handle());
    this.windowWidth ??= this.width;
    this.windowHeight ??= this.height;
  }
  present() { return present(this.handle()) !== 0; }
  pollEvent() {
    const id = this.handle();
    const kind = poll(id);
    if (kind === 0) return null;
    let event;
    if (kind === 1) {
      this.windowWidth = eventField(id, 0);
      this.windowHeight = eventField(id, 1);
      event = { type: 'resize', width: this.windowWidth, height: this.windowHeight };
    } else if (kind === 2) {
      this.windowWidth = this.windowHeight = null;
      event = { type: 'close' };
    } else {
      const types = ['pointermove', 'pointerdown', 'pointerup', 'pointerleave'];
      const keys = eventField(id, 2);
      const x = eventField(id, 0);
      const y = eventField(id, 1);
      event = {
        type: types[kind - 3], x, y, clientX: x, clientY: y, offsetX: x, offsetY: y,
        button: kind === 4 || kind === 5 ? 0 : -1,
        buttons: keys & 1, shiftKey: !!(keys & 4), ctrlKey: !!(keys & 8),
        altKey: false, metaKey: false, pointerType: 'mouse', pointerId: 1, isPrimary: true,
        pressure: keys & 1 ? 0.5 : 0, width: 1, height: 1, tiltX: 0, tiltY: 0,
        twist: 0, tangentialPressure: 0,
      };
    }
    event.target = this;
    event.cancelable = false;
    event.defaultPrevented = false;
    event.preventDefault = () => {};
    this.dispatchEvent(event);
    return event;
  }
  dispose() {
    if (!this.id) return;
    destroy(this.id);
    this.id = 0;
    this.windowWidth = this.windowHeight = null;
    this.eventListeners.clear();
  }
}

// Install the browser APIs used by renderers that accept an offscreen canvas.
// Call dispose after destroying the renderer, so it can remove its listeners.
export function installCanvasEnvironment({ baseUrl, resolveImagePath = source => source, readFile } = {}) {
  const windowEvents = new CanvasEventTarget();
  const documentEvents = new CanvasEventTarget();
  const canvases = [];
  const frames = [];
  let disposed = false;

  function createCanvas(width, height) {
    if (disposed) throw new Error('Native canvas environment is disposed');
    const canvas = new OffscreenCanvas(width, height);
    canvases.push(canvas);
    return canvas;
  }

  async function fetchResource(source, options) {
    if (typeof source === 'string' && source.startsWith('data:')) {
      const comma = source.indexOf(',');
      if (comma < 0) throw new TypeError('Invalid data URL');
      const metadata = source.slice(5, comma);
      const encoded = decodeURIComponent(source.slice(comma + 1));
      const base64 = metadata.endsWith(';base64');
      const body = base64 ? Uint8Array.fromBase64(encoded) : new TextEncoder().encode(encoded);
      const type = (base64 ? metadata.slice(0, -7) : metadata) || 'text/plain;charset=US-ASCII';
      return new Response(body, { headers: { 'Content-Type': type } });
    }
    if (readFile && typeof source === 'string' && source.startsWith('file:')) {
      return new Response(await readFile(resolveImagePath(source)));
    }
    return fetch(source, options);
  }

  function createImage() {
    return new CanvasImage(resolveImagePath, fetchResource);
  }

  documentEvents.createElement = tag => {
    switch (tag.toLowerCase()) {
      case 'canvas': return createCanvas();
      case 'img': return createImage();
      case 'video': return { canPlayType: () => '' };
      default: throw new TypeError('Unsupported native canvas element ' + tag);
    }
  };

  function requestFrame(callback) {
    if (disposed) throw new Error('Native canvas environment is disposed');
    const frame = { id: 0 };
    frame.id = setTimeout(() => {
      frames.splice(frames.indexOf(frame), 1);
      if (!disposed) callback(performance.now());
    }, 16);
    frames.push(frame);
    return frame.id;
  }

  function cancelFrame(id) {
    const index = frames.findIndex(frame => frame.id === id);
    if (index >= 0) {
      clearTimeout(frames[index].id);
      frames.splice(index, 1);
    }
  }

  const bindings = {
    OffscreenCanvas,
    PointerEvent: class PointerEvent {},
    document: documentEvents,
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    requestAnimationFrame: requestFrame,
    cancelAnimationFrame: cancelFrame,
  };
  const previous = [];
  for (const name of Object.keys(bindings)) {
    previous.push({ name, value: globalThis[name], own: Object.hasOwn(globalThis, name) });
    globalThis[name] = bindings[name];
  }

  return {
    adapter: {
      createCanvas,
      createImage,
      getCanvasRenderingContext2D: () => CanvasRenderingContext2D,
      getWebGLRenderingContext: () => WebGLRenderingContext,
      getNavigator: () => ({ userAgent: 'ReactC' }),
      getBaseUrl: () => baseUrl ?? 'file:///',
      getFontFaceSet: () => null,
      fetch: fetchResource,
    },
    pollEvent(canvas) {
      const event = canvas.pollEvent();
      if (!event) return null;
      if (event.type === 'pointermove') documentEvents.dispatchEvent(event);
      if (event.type === 'pointerup' || event.type === 'resize') windowEvents.dispatchEvent(event);
      return event;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const frame of frames) clearTimeout(frame.id);
      for (const canvas of canvases) canvas.dispose();
      documentEvents.eventListeners.clear();
      windowEvents.eventListeners.clear();
      for (const { name, value, own } of previous) {
        if (globalThis[name] !== bindings[name]) continue;
        if (own) globalThis[name] = value;
        else delete globalThis[name];
      }
    },
  };
}
