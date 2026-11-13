// Stylesheets are parsed by reactc. The page runtime applies the cascade to
// intrinsic elements before handing their styles to the native renderer.
const stylesheets = [];
export function registerStylesheet(rules) {
  stylesheets.push(...rules);
}

export function getStylesheetRules() {
  return stylesheets.map((rule, order) => ({ ...rule, order }))
    .sort((left, right) => left.specificity - right.specificity || left.order - right.order);
}

function matchesPart(part, element) {
  if (part.root && element.parent) return false;
  // The application root is the native equivalent of the document body.
  if (part.tag && part.tag !== element.tag && (element.parent || part.tag !== 'body')) return false;
  if (part.id && part.id !== element.props.id) return false;
  for (const name of part.classes) if (!element.classes.includes(name)) return false;
  for (const [name, value] of part.attributes) {
    if (element.props[name] === undefined || (value !== null && String(element.props[name]) !== value)) return false;
  }
  for (const state of part.states ?? []) {
    if (state === 'hover' ? !element.hovered : state === 'focus' ? !element.focused : true) return false;
  }
  return true;
}

// True when the cascade depends on pointer or focus state reported by the host.
export function hasInteractionRules(rules) {
  return rules.some(rule => rule.parts.some(part => part.states?.length));
}

function matches(parts, index, element) {
  if (!element || !matchesPart(parts[index], element)) return false;
  if (index === 0) return true;
  if (parts[index].direct) return matches(parts, index - 1, element.parent);
  for (let parent = element.parent; parent; parent = parent.parent) {
    if (matches(parts, index - 1, parent)) return true;
  }
  return false;
}

const colorNames = {
  black: '#000000', silver: '#c0c0c0', gray: '#808080', white: '#ffffff', maroon: '#800000',
  red: '#ff0000', purple: '#800080', fuchsia: '#ff00ff', green: '#008000', lime: '#00ff00',
  olive: '#808000', yellow: '#ffff00', navy: '#000080', blue: '#0000ff', teal: '#008080',
  aqua: '#00ffff', orange: '#ffa500', transparent: '#00000000',
};

function cssColor(value) {
  const input = value.toLowerCase();
  if (Object.hasOwn(colorNames, input)) return colorNames[input];
  if (/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/.test(input)) return input;
  if (/^#[0-9a-f]{3,4}$/.test(input)) return '#' + input.slice(1).split('').map(ch => ch + ch).join('');
  const rgb = input.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/);
  if (!rgb) return undefined;
  const channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  if (rgb[4] !== undefined) channels.push(Math.round(Number(rgb[4]) * 255));
  return '#' + channels.map(channel => Math.max(0, Math.min(channel, 255)).toString(16).padStart(2, '0')).join('');
}

function substitute(value, variables) {
  for (let depth = 0; depth < 16; depth++) {
    const match = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/.exec(value);
    if (!match) return value.includes('var(') ? undefined : value;
    const next = Object.hasOwn(variables, match[1]) ? variables[match[1]] : match[2];
    if (next === undefined) return undefined;
    value = value.slice(0, match.index) + next + value.slice(match.index + match[0].length);
  }
}

function length(value, font, viewport) {
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rem|em|vh|vw|%)?$/.exec(value);
  if (!match) return value === 'auto' ? 'auto' : undefined;
  const number = Number(match[1]);
  switch (match[2]) {
    case '%': return number + '%';
    case 'em': return number * font;
    case 'rem': return number * 16;
    case 'vh': return number * viewport.height / 100;
    case 'vw': return number * viewport.width / 100;
    default: return number;
  }
}

const inherited = ['color', 'fontSize', 'fontWeight', 'fontFamily', 'fontStyle', 'lineHeight', 'textAlign', 'cursor'];
const dimensions = new Set(['fontSize', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'left', 'right', 'top', 'bottom', 'gap', 'rowGap', 'columnGap', 'borderRadius', 'borderWidth',
  'borderBottomWidth', 'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'flexBasis', 'paddingTop', 'paddingRight', 'paddingBottom',
  'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft']);
const numbers = new Set(['lineHeight', 'fontWeight', 'flexGrow', 'flexShrink', 'zIndex']);

function convert(name, value, font, viewport) {
  const key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  if (name === 'padding' || name === 'margin' || name === 'gap') {
    const values = value.trim().split(/\s+/).map(item => length(item, font, viewport));
    if (values.includes(undefined) || values.length > (name === 'gap' ? 2 : 4)) return {};
    const [top, right = top, bottom = top, left = right] = values;
    return name === 'gap' ? { rowGap: top, columnGap: right } :
      { [key + 'Top']: top, [key + 'Right']: right, [key + 'Bottom']: bottom, [key + 'Left']: left };
  }
  if (name === 'background' || name.endsWith('color')) {
    const color = cssColor(value);
    return color ? { [name === 'background' ? 'backgroundColor' : key]: color } : {};
  }
  if (name === 'opacity') {
    const number = Number(value);
    return Number.isFinite(number) ? { opacity: Math.max(0, Math.min(number, 1)) } : {};
  }
  if (name === 'cursor') return value === 'pointer' ? { cursor: 'pointer' } : {};
  if (name === 'box-sizing') return {};
  if (['border', 'border-top', 'border-bottom', 'border-left', 'border-right'].includes(name)) {
    if (value === 'none') return { [key + 'Width']: 0 };
    const border = /^(?:(\S+)\s+)?solid(?:\s+(.*))?$/.exec(value);
    if (!border) return {};
    const width = border[1] ? length(border[1], font, viewport) : 3;
    const color = border[2] && cssColor(border[2]);
    return { [key + 'Width']: width, ...(color ? { borderColor: color } : {}) };
  }
  if (name === 'flex') {
    if (value === 'none') return { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' };
    if (value === 'auto') return { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' };
    const [grow, shrink = '1', basis = '0'] = value.split(/\s+/);
    if (Number.isFinite(Number(grow)) && Number.isFinite(Number(shrink))) {
      const size = length(basis, font, viewport);
      return { flexGrow: Number(grow), flexShrink: Number(shrink), flexBasis: size === '0%' ? 0 : size };
    }
    return {};
  }
  if (dimensions.has(key)) {
    const size = length(value, font, viewport);
    return size === undefined ? {} : { [key]: size };
  }
  if (numbers.has(key)) {
    const number = key === 'fontWeight' && value === 'bold' ? 700 : Number(value);
    return Number.isFinite(number) ? { [key]: number } : {};
  }
  if (name === 'font-family') return { fontFamily: value.includes('monospace') ? 'monospace' : 'sans-serif' };
  if (name === 'flex-wrap') return { flexWrap: value === 'wrap' };
  if (name === 'overflow') return { overflowY: value };
  return { [key]: value };
}

export function applyStylesheet(rules, viewport, parent, tag, props, state = {}) {
  const scope = { tag, props, parent, classes: String(props.className ?? '').split(/\s+/),
    hovered: !!state.hovered, focused: !!state.focused };
  const active = rules.filter(rule => viewport.width >= rule.min && viewport.width <= rule.max &&
    matches(rule.parts, rule.parts.length - 1, scope));
  const variables = { ...parent?.variables };
  const style = {};
  for (const property of inherited) {
    if (parent?.style[property] !== undefined) style[property] = parent.style[property];
  }
  const font = parent?.style.fontSize || 16;
  for (const priority of [false, true]) {
    for (const rule of active) {
      for (const [name, value, important] of rule.declarations) {
        if (important === priority && name.startsWith('--')) variables[name] = value;
      }
    }
  }
  for (const priority of [false, true]) {
    if (priority) Object.assign(style, props.style);
    for (const rule of active) {
      for (const [name, value, important] of rule.declarations) {
        if (important !== priority || name.startsWith('--')) continue;
        const resolved = substitute(value, variables);
        if (resolved !== undefined) Object.assign(style, convert(name, resolved, font, viewport));
      }
    }
  }
  if (style.display === 'flex' && style.flexDirection === undefined) style.flexDirection = 'row';
  if (typeof style.borderRadius === 'string' && style.borderRadius.endsWith('%') &&
      typeof style.width === 'number' && typeof style.height === 'number') {
    style.borderRadius = Number(style.borderRadius.slice(0, -1)) * Math.min(style.width, style.height) / 100;
  }
  scope.variables = variables;
  scope.style = style;
  return scope;
}
