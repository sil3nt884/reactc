import { applyStylesheet, getStylesheetRules, hasInteractionRules } from './native-css.js';
import { FormData, runFormAction, submitForm } from './native-forms.js';
export { FormData };

// React-compatible components, scoped providers, hooks and fragments.
// The native runtime renders one operation at a time.
let currentFrame = null;
let currentPage = null;
const contextProviders = new Map();
const tagTypes = { main:'Container', section:'Container', div:'Container', header:'Container', footer:'Container',
  nav:'Container', article:'Container', form:'Container', ul:'Container', dl:'Container', li:'Container',
  pre:'Text', h1:'Heading', h2:'Heading', h3:'Heading', h4:'Heading', h5:'Heading', h6:'Heading', small:'Text', p:'Text', span:'Text', strong:'Text', code:'Text',
  dt:'Text', dd:'Text', label:'Label', input:'Input', textarea:'TextArea', button:'Button', select:'Select',
  option:'Option', a:'Link', svg:'Svg', path:'SvgPath', circle:'SvgCircle', rect:'SvgRect',
  'native-chart':'Chart', 'native-modal':'Modal',
  details:'Container', summary:'Button', fieldset:'Container', legend:'Text' };

export function __jsx(type, props, ...children) {
  props=props||{};
  return { type, props, children:children.length?children:props.children===undefined?[]:[props.children] };
}

export function jsx(type, props, key) {
  return __jsx(type, key === undefined ? props : { ...props, key });
}

export { jsx as jsxs, jsx as jsxDEV };

export function useState(initial) {
  if (!currentFrame) throw new Error('useState must run inside a component');
  const frame = currentFrame;
  const index = frame.cursor++;
  if (index >= frame.values.length) {frame.values.push(typeof initial === 'function' ? initial() : initial);frame.kinds.push('state');}
  if(frame.kinds[index]!=='state')throw new Error('Hook kind changed');
  function setValue(next) {
    if (currentFrame) throw new Error('State changes during rendering are unsupported');
    if (!frame.alive) return;
    const value = typeof next === 'function' ? next(frame.values[index]) : next;
    if(!Object.is(value,frame.values[index])) {frame.values[index]=value;frame.dirty();}
  }
  return [frame.values[index], setValue];
}

function dependenciesChanged(previous, next) {
  return next === undefined || previous === null || next.length !== previous.length || next.some((value,index)=>!Object.is(value,previous[index]));
}
function hookSlot(kind, initial) {
  if(!currentFrame)throw new Error(kind+' must run inside a component');
  const frame=currentFrame,index=frame.cursor++;
  if(index>=frame.values.length){frame.values.push(initial());frame.kinds.push(kind);}
  if(frame.kinds[index]!==kind)throw new Error('Hook kind changed');
  return frame.values[index];
}
export function useRef(initial) {
  return hookSlot('ref',()=>({current:initial}));
}
export function useMemo(factory, dependencies) {
  if(typeof factory!=='function')throw new Error('useMemo requires a function');
  if(dependencies!==undefined&&!Array.isArray(dependencies))throw new Error('Memo dependencies must be an array');
  const slot=hookSlot('memo',()=>({deps:null,value:undefined}));
  if(dependenciesChanged(slot.deps,dependencies)){
    const value=factory();
    slot.value=value;slot.deps=dependencies===undefined?null:dependencies.slice();
  }
  return slot.value;
}
export function useCallback(callback, dependencies) {
  if(typeof callback!=='function')throw new Error('useCallback requires a function');
  return useMemo(()=>callback,dependencies);
}
// The cache the React Compiler's output keeps per component instance. Empty
// slots hold React's sentinel so compiled code can tell "never computed".
const memoCacheSentinel = Symbol.for('react.memo_cache_sentinel');
export function useMemoCache(size) {
  if (!Number.isInteger(size) || size < 0 || size > 65536) throw new Error('Invalid memo cache size');
  return hookSlot('memoCache', () => {
    const cache = new Array(size);
    for (let index = 0; index < size; index++) cache[index] = memoCacheSentinel;
    return cache;
  });
}
export function Fragment({children}){return children;}
// Native rendering waits for async children, so the fallback is never displayed.
export function Suspense({children}){return children;}

export const NotFoundBoundary = Symbol('not-found boundary');
export const RoutePageRevision = Symbol('route page revision');
const notFoundSignal = new Error('Page not found');

export function notFound() {
  throw notFoundSignal;
}
export {Fragment as __Fragment};

export function createContext(defaultValue) {
  const context = { defaultValue };
  function Provider({children}) { return children; }
  context.Provider = Provider;
  contextProviders.set(Provider, context);
  contextProviders.set(context, context);
  return context;
}

export function useContext(context) {
  if (!context || contextProviders.get(context) !== context) throw new Error('Invalid native context');
  hookSlot('context', () => null);
  for (let scope = currentFrame.context; scope; scope = scope.parent) {
    if (scope.context === context) return scope.value;
  }
  return context.defaultValue;
}

export function useId() {
  const frame = currentFrame;
  return hookSlot('id', () => 'native-' + frame.instance + '-' + (frame.cursor - 1));
}

export function useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
  if (typeof subscribe !== 'function' || typeof getSnapshot !== 'function' ||
      (getServerSnapshot !== undefined && typeof getServerSnapshot !== 'function')) {
    throw new Error('Invalid native store subscription');
  }
  const frame = currentFrame;
  const slot = hookSlot('store', () => ({value: undefined, read: null}));
  slot.read = getSnapshot;
  slot.value = getSnapshot();
  useEffect(() => {
    let subscribed = true;
    function notify() {
      if (!subscribed || !frame.alive) return;
      const value = slot.read();
      if (Object.is(value, slot.value)) return;
      slot.value = value;
      frame.dirty();
    }
    const unsubscribe = subscribe(notify);
    if (typeof unsubscribe !== 'function') throw new Error('Native store must return an unsubscribe function');
    notify();
    return () => {
      subscribed = false;
      unsubscribe();
    };
  }, [subscribe]);
  return slot.value;
}

export function useTransition() {
  const frame = currentFrame;
  const page = currentPage;
  if (!page?.asyncPage || !frame) throw new Error('useTransition requires async page mode');
  const slot = hookSlot('transition', () => {
    const state = { pending: 0, start: null };
    function finish() {
      state.pending--;
      if (frame.alive) frame.dirty();
    }
    state.start = action => {
      if (currentFrame || currentPage !== page || !frame.alive || typeof action !== 'function') {
        throw new Error('Transition requires an active event or effect');
      }
      state.pending++;
      frame.dirty();
      let result;
      try {
        result = action();
      } catch (error) {
        finish();
        throw error;
      }
      if (!isPromise(result)) {
        finish();
        return;
      }
      void Promise.resolve(result).then(finish, error => {
        finish();
        if (frame.alive) page.actionError = error instanceof Error ? error : new Error('Transition failed');
      });
    };
    return state;
  });
  return [slot.pending > 0, slot.start];
}

function cacheNode() {
  return { children: new Map(), settled: false, rejected: false, value: undefined };
}

export function cache(fn) {
  if (typeof fn !== 'function') throw new Error('cache requires a function');
  function cached(...args) {
    const entries = currentPage?.rendering ? currentPage.renderCache : null;
    if (!entries) return fn(...args);
    if (!entries.has(cached)) entries.set(cached, cacheNode());
    let entry = entries.get(cached);
    for (const arg of args) {
      if (!entry.children.has(arg)) entry.children.set(arg, cacheNode());
      entry = entry.children.get(arg);
    }
    if (!entry.settled) {
      try {
        entry.value = fn(...args);
      } catch (error) {
        entry.value = error;
        entry.rejected = true;
      }
      entry.settled = true;
    }
    if (entry.rejected) throw entry.value;
    return entry.value;
  }
  return cached;
}

export function useActionState(action, initial) {
  if (!currentPage?.asyncPage || !currentFrame || typeof action !== 'function') {
    throw new Error('useActionState requires an action in async page mode');
  }
  const frame = currentFrame;
  const page = currentPage;
  const slot = hookSlot('action', () => {
    const state = { value: initial, pending: false, data: null, action, dispatch: null };
    function dispatch(data, onComplete) {
      if (currentFrame || !frame.alive || currentPage !== page) throw new Error('Form action requires an active event');
      const perform = state.action;
      runFormAction(state, data, () => perform(state.value, data), value => {
        if (!frame.alive) return;
        state.value = value;
        if (onComplete) onComplete();
        frame.dirty();
      }, error => {
        if (!frame.alive) return;
        page.actionError = error instanceof Error ? error : new Error('Form action failed');
        frame.dirty();
      });
      frame.dirty();
    }
    dispatch.state = state;
    state.dispatch = dispatch;
    return state;
  });
  slot.action = action;
  return [slot.value, slot.dispatch, slot.pending];
}

export function useFormStatus() {
  if (!currentFrame) throw new Error('useFormStatus must run inside a component');
  const form = currentFrame.form;
  const pending = !!form?.status.pending;
  return { pending, data: pending ? form.status.data : null, method: pending ? 'post' : null, action: pending ? form.action : null };
}

export function useEffect(effect, dependencies) {
  if(!currentFrame)throw new Error('useEffect must run inside a component');
  if(dependencies!==undefined && !Array.isArray(dependencies))throw new Error('Effect dependencies must be an array');
  const frame=currentFrame,index=frame.cursor++;
  if(index>=frame.values.length){frame.values.push({deps:null,cleanup:null});frame.kinds.push('effect');}
  if(frame.kinds[index]!=='effect')throw new Error('Hook kind changed');
  const slot=frame.values[index];
  const changed=dependencies===undefined || slot.deps===null || dependencies.length!==slot.deps.length || dependencies.some((value,i)=>!Object.is(value,slot.deps[i]));
  if(changed){slot.deps=dependencies===undefined?null:dependencies.slice();frame.effects.push(()=>{if(slot.cleanup)slot.cleanup();const cleanup=effect();if(cleanup!==undefined&&typeof cleanup!=='function')throw new Error('Effect must return a cleanup function or undefined');slot.cleanup=cleanup||null;});}
}

// Match default React imports and React.use* calls to the same native hooks.
export default {
  createElement: __jsx, Fragment, Suspense, createContext, useContext, useState,
  useEffect, useRef, useMemo, useCallback, useId, useSyncExternalStore,
  useTransition, useActionState, cache,
};

export function registerNavigator(navigate, location, canGoBack = false, retainRevision) {
  if(!currentPage || !currentFrame)throw new Error('Navigator must be registered during rendering');
  currentPage.navigate=navigate;
  // With a revision, every async (server) component keeps its resolved output
  // until navigation or refresh, as a server-rendered tree does in a browser.
  currentPage.retainRevision=retainRevision;
  currentPage.location=location;
  currentPage.canGoBack=canGoBack;
}

export function canNavigateBack() {
  if (!currentPage?.location) throw new Error('This command requires a native route');
  return currentPage.canGoBack;
}

export function getPageNavigation() {
  if (!currentPage?.location || !currentFrame) throw new Error('This component requires a native route');
  return currentPage;
}

export function callServer(action, args, callback) {
  if (!currentPage || currentFrame) throw new Error('callServer must run inside an event callback');
  return currentPage.request(action, args, callback);
}

// The native driver gives Promise jobs a turn before it reads another command.
export function flushPromiseJobs() {
  return new Promise(resolve => globalThis.setTimeout(resolve, 0));
}

function pageTimers() {
  if (!currentPage?.asyncPage || currentFrame) throw new Error('Native timers require an active async page outside component rendering');
  return currentPage.timers;
}

function scheduleNativeTimeout(callback, delay, ...args) {
  return pageTimers().schedule(callback, delay, args, false);
}

function scheduleNativeInterval(callback, delay, ...args) {
  return pageTimers().schedule(callback, delay, args, true);
}

function cancelNativeTimer(id) {
  pageTimers().cancel(id);
}

export {
  scheduleNativeTimeout as setTimeout, scheduleNativeInterval as setInterval,
  cancelNativeTimer as clearTimeout, cancelNativeTimer as clearInterval,
};

export function callServerAsync(action, args) {
  if (!currentPage?.asyncPage || currentFrame) throw new Error('Async actions require an active event or effect');
  return new Promise(resolve => currentPage.request(action, args, resolve, currentPage.awaitingHandler));
}

export function readServerAsync(action, args) {
  if (!currentPage?.asyncPage) throw new Error('Async reads require an active async page');
  return new Promise(resolve => currentPage.request(action, args, resolve, true));
}

export function setPageAppearance(appearance) {
  if (!currentPage?.rendering) throw new Error('Document appearance requires an active native render');
  currentPage.appearance = appearance;
}

export function callGatewayAsync(action, args) {
  if (currentPage?.rendering) return readServerAsync(action, args);
  return callServerAsync(action, args);
}

function synchronousBrowserRequest(action, args) {
  if (!currentPage?.synchronousHost || currentFrame || currentPage.rendering) {
    throw new Error('This browser API requires an active native host event or effect');
  }
  return currentPage.synchronousHost({ version: 1, id: currentPage.nextRequestId(), action, args });
}

export function nativeAlert(message = '') {
  const result = synchronousBrowserRequest('native.browser.dialog', { kind: 'alert', message: String(message) });
  if (!result?.ok) throw new Error('The native alert could not be displayed');
}

export function nativeConfirm(message = '') {
  const result = synchronousBrowserRequest('native.browser.dialog', { kind: 'confirm', message: String(message) });
  return result?.ok === true && result.accepted === true;
}

function storage(operation, args = {}) {
  const result = synchronousBrowserRequest('native.browser.storage', { operation, ...args });
  if (!result?.ok) throw new Error('Native local storage could not complete ' + operation);
  return result.value;
}

export const nativeStorage = {
  getItem(key) { return storage('get', { key: String(key) }); },
  setItem(key, value) { storage('set', { key: String(key), value: String(value) }); },
  removeItem(key) { storage('remove', { key: String(key) }); },
  clear() { storage('clear'); },
};

export const nativeWindow = {
  alert: nativeAlert,
  confirm: nativeConfirm,
  localStorage: nativeStorage,
  open(url, target = '_blank') {
    if (!currentPage?.openExternal || currentFrame || currentPage.rendering || (target !== '' && target !== '_blank')) return null;
    if (typeof url === 'string' && url.length <= 2048 && /^https?:\/\//i.test(url) &&
        !/[\x00-\x20\x7f"\\]/.test(url)) {
      currentPage.request('native.window.open', { url }, () => {});
    }
    return null;
  },
  addEventListener(type, listener) {
    if (typeof listener !== 'function') throw new TypeError('Native window listeners must be functions');
    if (type === 'keydown') return keyPage().keyListeners.add(listener);
    if (type !== 'online' && type !== 'offline') throw new Error('Unsupported native window event: ' + type);
    eventPage().networkListeners[type].add(listener);
  },
  removeEventListener(type, listener) {
    if (type === 'keydown') return currentPage?.keyListeners.delete(listener);
    if (type === 'online' || type === 'offline') eventPage().networkListeners[type].delete(listener);
  },
};

// Keyboard listeners may be added from any effect, sync or async page.
function keyPage() {
  if (!currentPage || currentFrame) throw new Error('Native key listeners require an active event or effect');
  return currentPage;
}

export const nativeDocument = {
  addEventListener(type, listener) {
    if (type !== 'keydown') throw new Error('Unsupported native document event: ' + type);
    if (typeof listener !== 'function') throw new TypeError('Native document listeners must be functions');
    keyPage().keyListeners.add(listener);
  },
  removeEventListener(type, listener) {
    if (type === 'keydown') currentPage?.keyListeners.delete(listener);
  },
  documentElement: {
    getAttribute(name) {
      const attributes = currentPage?.documentAttributes;
      const key = String(name).toLowerCase();
      return attributes && Object.hasOwn(attributes, key) ? attributes[key] : null;
    },
    setAttribute(name, value) {
      if (!currentPage || currentFrame) throw new Error('Document attributes require an active event or effect');
      currentPage.setDocumentAttribute(String(name).toLowerCase(), String(value));
    },
  },
  createElement(tag) {
    if (String(tag).toLowerCase() !== 'a') throw new Error('Native document.createElement supports download anchors');
    return {
      href: '', download: '',
      setAttribute(name, value) {
        if (name === 'href' || name === 'download') this[name] = String(value);
      },
      click() {
        const match = /^data:(application\/json|text\/plain)(?:;charset=utf-8)?,/i.exec(this.href);
        if (!match || !this.download || this.href.length > 200000) {
          throw new Error('Native downloads require a UTF-8 JSON or text data URL and a file name');
        }
        const content = decodeURIComponent(this.href.slice(match[0].length));
        const result = synchronousBrowserRequest('native.browser.download', { name: this.download, content });
        if (!result?.ok) throw new Error('The native download could not be saved');
      },
    };
  },
};

export function updateNativeNetworkStatus(online) {
  const page = currentPage;
  if (!page || page.online === online) return;
  page.online = online;
  const type = online ? 'online' : 'offline';
  for (const listener of Array.from(page.networkListeners[type])) listener({ type, target: nativeWindow });
}

function eventPage() {
  if (!currentPage?.asyncPage || currentFrame) throw new Error('Native events require an active async page effect');
  return currentPage;
}

export function nativeVisibilityState() {
  return eventPage().visible ? 'visible' : 'hidden';
}

export function addNativeVisibilityListener(listener) {
  eventPage().visibilityListeners.add(listener);
}

export function removeNativeVisibilityListener(listener) {
  eventPage().visibilityListeners.delete(listener);
}

export function openNativeEventStream(dispatch) {
  const page = eventPage();
  if (page.eventStream) throw new Error('The native host supports one event stream per page');
  const stream = { id: ++page.nextEventStream, dispatch };
  page.eventStream = stream;
  return () => {
    if (page.eventStream === stream) page.eventStream = null;
  };
}

export function applyGatewayRedirect(path) {
  if (!currentPage?.location || currentPage.rendering) throw new Error('This route cannot follow the action redirect');
  currentPage.navigate(path, 'replace');
}

// Re-reads the current route, as a browser reload or router.refresh() would.
export function requestPageRefresh() {
  if (!currentPage?.navigate || currentPage.rendering) throw new Error('Refresh requires an active native route');
  currentPage.navigate(null, 'refresh');
}

// After an action that revalidated server data. Ignored where no route is mounted.
export function requestActionRefresh() {
  if (currentPage?.navigate && !currentPage.rendering) currentPage.navigate(null, 'refresh');
}

// A host operation started by a synchronous browser API. Its failure is
// reported on the next frame instead of being dropped.
export function callHostEffect(action, args, accepted, message) {
  const page = eventPage();
  void callGatewayAsync(action, args).then(reply => {
    if (!accepted(reply)) page.actionError = new Error(message);
  });
}

function isPromise(value) {
  return value != null && typeof value.then === 'function';
}

export function createPage(Component, options = {}) {
  const frames = {};
  const forms = {};
  const asyncPage = options.asyncPage === true;
  const stylesheet = getStylesheetRules();
  const interactionStyles = hasInteractionRules(stylesheet);
  let viewport = { width: 454, height: 800 };
  // Tree IDs under the host pointer (the target and its ancestors) and the
  // focused control, as last reported by an interaction command.
  let hoveredPaths = new Set();
  let focusedPath = null;
  let revision = 0;
  let handlers = {};
  let keyEvent;
  let contextMenuEvent;
  let portals = [];
  let activeModalPath;
  let callbacks = {};
  let nextRequest = 0;
  let requests = [];
  let blockingRequests = [];
  let dirty = false;
  let nextInstance = 0;
  let seen = {};
  let seenForms = {};
  const disclosures = {};
  let seenDisclosures = {};
  const checkboxes = {};
  let seenCheckboxes = {};
  let seenScrollRefs;
  const mountedScrollRefs = new Map();
  let seenFileRefs;
  const mountedFileRefs = new Map();
  const scrollRequests = new Set();
  let lastTree;
  const timers = new Map();
  let nextTimer = 0;
  function nextScheduledTimer() {
    let first;
    for (const timer of timers.values()) {
      if (!first || timer.due < first.due) first = timer;
    }
    return first;
  }

  function nextWakeAt() {
    return nextScheduledTimer()?.due;
  }

  function fireTimer() {
    const timer = nextScheduledTimer();
    const now = Date.now();
    if (!timer || timer.due > now) return;
    timers.delete(timer.id);
    if (timer.repeating) {
      timer.due = now + timer.delay;
      timers.set(timer.id, timer);
    }
    const { callback, args } = timer;
    const result = callback(...args);
    if (isPromise(result)) {
      void Promise.resolve(result).then(undefined, error => {
        page.actionError = error instanceof Error ? error : new Error('Native timer callback failed');
      });
    }
  }

  const page = {
    synchronousHost: null,
    nextRequestId() { return 'request-' + (++nextRequest); },
    openExternal: options.openExternal === true,
    online: true,
    networkListeners: { online: new Set(), offline: new Set() },
    keyListeners: new Set(),
    documentAttributes: Object.create(null),
    setDocumentAttribute(name, value) {
      if (page.documentAttributes[name] === value) return;
      page.documentAttributes[name] = value;
      dirty = true;
    },
    asyncPage,
    awaitingHandler: false,
    actionError: null,
    visible: true,
    visibilityListeners: new Set(),
    nextEventStream: 0,
    eventStream: null,
    timers: {
      schedule(callback, delay, args, repeating) {
        if (typeof callback !== 'function') throw new TypeError('Native timers require a callback');
        const value = Number(delay);
        const milliseconds = Number.isFinite(value) ? Math.max(1, Math.min(2147483647, Math.trunc(value))) : 1;
        const id = ++nextTimer;
        timers.set(id, { id, callback, args, delay: milliseconds, due: Date.now() + milliseconds, repeating });
        return id;
      },
      cancel(id) { timers.delete(Number(id)); },
    },
    request(action, args, callback, blocking = false) {
      if (typeof action !== 'string' || typeof callback !== 'function') throw new Error('Invalid server call');
      const id = 'request-' + (++nextRequest);
      callbacks[id] = callback;
      const queue = blocking ? blockingRequests : requests;
      queue.push({ id, version: 1, action, args });
      return () => { delete callbacks[id]; };
    },
  };

  function takeRequests() {
    const outgoing = requests.concat(takeBlockingRequests());
    requests = [];
    return outgoing;
  }

  function takeBlockingRequests() {
    const outgoing = blockingRequests;
    blockingRequests = [];
    return outgoing;
  }

  function completeRequest(command) {
    const callback = typeof command.id === 'string' && /^request-[0-9]+$/.test(command.id) ? callbacks[command.id] : null;
    if (!callback) throw new Error('Unknown or completed request');
    delete callbacks[command.id];
    return callback(command.result);
  }

  function cleanupFrame(frame) {
    frame.alive = false;
    for (let i = 0; i < frame.values.length; i++) {
      if (frame.kinds[i] === 'effect' && frame.values[i].cleanup) {
        frame.values[i].cleanup();
        frame.values[i].cleanup = null;
      }
    }
  }

  function queueChildren(queue, node, path) {
    if (!Array.isArray(node)) {
      queue.push({ node, path });
      return;
    }
    const keys = {};
    for (let i = 0; i < node.length; i++) {
      const item = node[i];
      const key = item && typeof item === 'object' && item.props ? item.props.key : undefined;
      const identity = key === undefined || key === null ? 'i' + i : 'k' + JSON.stringify(key);
      if (keys[identity]) throw new Error('Duplicate child key');
      keys[identity] = true;
      queueChildren(queue, item, path + '.' + identity);
    }
  }

  function renderChildren(queue, output, finish, form, context) {
    function append(value) {
      if (Array.isArray(value)) output.push(...value);
      else if (value) output.push(value);
    }
    function next(index) {
      for (; index < queue.length; index++) {
        const item = queue[index];
        const rendered = render(item.node, item.path, form, context);
        if (asyncPage && isPromise(rendered)) {
          const nextIndex = index + 1;
          return rendered.then(value => {
            append(value);
            return next(nextIndex);
          });
        }
        append(rendered);
      }
      return finish();
    }
    return next(0);
  }

  function render(node, path, form, context) {
    if (node === null || node === undefined || typeof node === 'boolean') return null;
    if (typeof node === 'string' || typeof node === 'number') {
      return { id: path, type: 'Text', props: { text: String(node) }, children: [] };
    }
    if (Array.isArray(node)) {
      const children = [];
      const queue = [];
      queueChildren(queue, node, path + '.fragment');
      return renderChildren(queue, children, () => children, form, context);
    }
    if (node.type === Fragment) {
      const keyPath = node.props.key === undefined ? path : path + '@' + JSON.stringify(node.props.key);
      return render(node.children, keyPath, form, context);
    }
    if (node.type === NotFoundBoundary) {
      const contentPath = path + '.content';
      function fallback(error) {
        if (error !== notFoundSignal) throw error;
        const eventPrefix = revision + ':' + contentPath;
        const abandoned = key => key === contentPath || key.startsWith(contentPath + '.') || key.startsWith(contentPath + '@');
        for (const key of Object.keys(seen)) {
          if (abandoned(key)) delete seen[key];
        }
        for (const key of Object.keys(seenForms)) {
          if (abandoned(key)) delete seenForms[key];
        }
        for (const [ref, key] of seenScrollRefs) {
          if (abandoned(key)) seenScrollRefs.delete(ref);
        }
        for (const [ref, target] of seenFileRefs) {
          if (abandoned(target.path)) seenFileRefs.delete(ref);
        }
        portals = portals.filter(portal => !abandoned(portal.id));
        for (const token of Object.keys(handlers)) {
          if (token.startsWith(eventPrefix + ':') || token.startsWith(eventPrefix + '.') ||
              token.startsWith(eventPrefix + '@')) delete handlers[token];
        }
        return render(node.props.fallback, path + '.fallback', form, context);
      }
      try {
        const rendered = render(node.children[0], contentPath, form, context);
        return isPromise(rendered) ? rendered.then(undefined, fallback) : rendered;
      } catch (error) {
        return fallback(error);
      }
    }
    const provider = (typeof node.type === 'function' || typeof node.type === 'object') &&
      contextProviders.get(node.type);
    if (typeof node.type === 'function' || provider) {
      const component = provider ? provider.Provider : node.type;
      if (node.props.key !== undefined) path += '@' + JSON.stringify(node.props.key);
      let frame = frames[path];
      if (!frame || frame.component !== component) {
        if (frame) cleanupFrame(frame);
        frame = {
          component, values: [], kinds: [], effects: [], cursor: 0,
          expected: -1, alive: true, instance: ++nextInstance,
          dirty() { dirty = true; },
        };
        frames[path] = frame;
      }
      seen[path] = true;
      const componentPath = path + '.component' + frame.instance;
      const scope = provider ? { context: provider, value: node.props.value, parent: context,
        stylesheet: context?.stylesheet, click: context?.click } : context;
      const routeRevision = node[RoutePageRevision] !== undefined ? node[RoutePageRevision] : page.retainRevision;
      if (routeRevision !== undefined && frame.routeRevision === routeRevision) {
        return render(frame.routeResult, componentPath, form, scope);
      }
      frame.cursor = 0;
      const previous = currentFrame;
      currentFrame = frame;
      frame.form = form;
      frame.context = context;
      let result;
      try {
        const children = options.standardChildren && node.children.length < 2 ? node.children[0] : node.children;
        result = component({ ...node.props, children });
      } finally {
        currentFrame = previous;
      }
      if (frame.expected >= 0 && frame.expected !== frame.cursor) throw new Error('Hook order changed');
      frame.expected = frame.cursor;
      if (isPromise(result)) {
        if (!asyncPage) throw new Error('Async components require async page mode');
        if (frame.cursor !== 0) throw new Error('Async components cannot use client hooks');
        return result.then(value => {
          if (routeRevision !== undefined) {
            frame.routeRevision = routeRevision;
            frame.routeResult = value;
          }
          return render(value, componentPath, form, scope);
        });
      }
      return render(result, componentPath, form, scope);
    }
    // Script is the native runtime here, so the original no-script fallback never applies.
    if (node.type === 'noscript' && asyncPage) return null;
    const type = tagTypes[node.type];
    if (!type) throw new Error('Unsupported element: ' + node.type);
    let nodeProps = node.props;
    let disclosure;
    let implicitSubmit;  // Enter-key form submission for a single-line field
    if (node.type === 'details') {
      if (!asyncPage) throw new Error('Native disclosure requires async page mode');
      const { open, ...layout } = nodeProps;
      disclosure = disclosures[path] || (disclosures[path] = { open: !!open });
      seenDisclosures[path] = true;
      nodeProps = layout;
    } else if (node.type === 'summary') {
      const owner = disclosures[path.slice(0, path.lastIndexOf('.'))] ||
        disclosures[path.slice(0, path.lastIndexOf('.', path.lastIndexOf('.') - 1))];
      if (!owner || nodeProps.onClick) throw new Error('Native summary must be a direct child of details');
      nodeProps = {
        ...nodeProps, 'aria-expanded': owner.open,
        onClick() { owner.open = !owner.open; dirty = true; },
      };
    }
    if (node.type === 'input' && nodeProps.type === 'file' && asyncPage) {
      const {__nativeFileRef: ref, accept = '', hidden, disabled, onChange, ...attributes} = nodeProps;
      if (typeof accept !== 'string' || accept.length > 256 || typeof onChange !== 'function' || attributes.multiple) {
        throw new Error('Native file inputs require a single file and an onChange handler');
      }
      async function choose() {
        if (disabled) return;
        const result = await callGatewayAsync('native.file.pick', {accept});
        if (result?.cancelled === true) return;
        if (result?.ok !== true || !Number.isSafeInteger(result.token) || result.token <= 0) {
          throw new Error('Could not open the selected file');
        }
        try {
          if (typeof result.name !== 'string' || !result.name || typeof result.type !== 'string' ||
              !Number.isSafeInteger(result.size) || result.size < 0) throw new Error('Invalid native file metadata');
          await onChange({target: {
            value: result.name,
            files: [{name: result.name, type: result.type, size: result.size, nativeFileToken: result.token}],
          }});
        } finally {
          await callGatewayAsync('native.file.release', {token: result.token});
        }
      }
      if (ref !== undefined) {
        if (!ref || typeof ref !== 'object' || !Object.hasOwn(ref, 'current') || seenFileRefs.has(ref)) {
          throw new Error('Invalid native file input ref');
        }
        seenFileRefs.set(ref, {path, choose});
      }
      if (hidden) return null;
      const {type, name, ...button} = attributes;
      return render(__jsx('button', {...button, disabled, type: 'button', onClick: choose}, 'Choose file'), path, form, context);
    }
    if (node.type === 'input' && nodeProps.type === 'checkbox' && asyncPage) {
      // A checkbox is a pressable native control that reports `target.checked`.
      const { checked, defaultChecked, onChange, name, value = 'on', required, type: _type, className, ...attributes } = nodeProps;
      if (onChange != null && typeof onChange !== 'function') throw new Error('Invalid checkbox change handler');
      const controlled = checked !== undefined && checked !== null;
      const values = form ? form.storage.values : checkboxes;
      if (!controlled && !Object.prototype.hasOwnProperty.call(values, path)) values[path] = defaultChecked ? 'on' : '';
      const on = controlled ? !!checked : values[path] === 'on';
      seenCheckboxes[path] = true;
      if (form && name && !attributes.disabled && on) form.fields.push([String(name), String(value)]);
      if (form && !form.noValidate && required && !attributes.disabled) {
        form.validatedFields.push({ path, type: 'checkbox', required, value: on ? 'on' : '' });
      }
      const owner = form;
      return render(__jsx('button', {
        ...attributes, type: 'button', role: 'checkbox', 'aria-checked': on,
        ...(owner?.storage.invalid?.path === path ? { 'aria-invalid': true } : {}),
        className: 'border flex items-center justify-center text-xs ' + (className ?? ''),
        onClick() {
          if (!controlled) { values[path] = on ? '' : 'on'; dirty = true; }
          if (owner?.storage.invalid?.path === path) owner.storage.invalid = null;
          return onChange?.({ target: { checked: !on, value: String(value), name } });
        },
      }, on ? String.fromCharCode(10003) : ''), path, null, context);
    }
    if (node.type === 'input' && ['date', 'datetime-local', 'time'].includes(nodeProps.type) && nodeProps.placeholder === undefined) {
      nodeProps = { ...nodeProps, placeholder: { date: 'YYYY-MM-DD', time: 'HH:MM', 'datetime-local': 'YYYY-MM-DDTHH:MM' }[nodeProps.type] };
    }
    if (Object.hasOwn(nodeProps, '__nativeScrollRef')) {
      const { __nativeScrollRef: ref, ...attributes } = nodeProps;
      if (!asyncPage || node.type !== 'div' || !ref || typeof ref !== 'object' ||
          !Object.hasOwn(ref, 'current') || seenScrollRefs.has(ref)) throw new Error('Invalid native scroll ref');
      seenScrollRefs.set(ref, path);
      nodeProps = attributes;
    }
    if (node.type === 'a') {
      const { href, onClick, target, rel, ...attributes } = nodeProps;
      if (!page.location || typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//') ||
          /[\\\x00-\x1f\x7f]/.test(href)) throw new Error('Native links require a local route');
      if (onClick != null && typeof onClick !== 'function') throw new Error('Invalid link click handler');
      const externalPolicy = asyncPage && target === '_blank' && rel === 'noopener' &&
        ['/terms', '/privacy', '/trainer-terms'].includes(href);
      if ((target !== undefined || rel !== undefined) && !externalPolicy) throw new Error('Unsupported native link target');
      nodeProps = {
        ...attributes, href,
        onClick() {
          const event = {
            defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; },
          };
          const result = onClick?.(event);
          if (!event.defaultPrevented) {
            if (externalPolicy) return callServerAsync('native.policy.open', {path: href});
            page.navigate(href);
          }
          return result;
        },
      };
    } else if (node.type === 'form') {
      if (!asyncPage || form) throw new Error('Native forms require async page mode and cannot be nested');
      const { action, onSubmit, onSubmitCapture, noValidate, ...layout } = nodeProps;
      if (action !== undefined && typeof action !== 'function') throw new Error('Native form actions require a function');
      if (onSubmit !== undefined && typeof onSubmit !== 'function') throw new Error('Invalid form submit handler');
      if (onSubmitCapture !== undefined && typeof onSubmitCapture !== 'function') throw new Error('Invalid form capture handler');
      if (!action && !onSubmit && !onSubmitCapture) throw new Error('Native forms require a submit handler or action');
      const storage = forms[path] || (forms[path] = { values: {}, status: { pending: false, data: null }, invalid: null });
      seenForms[path] = true;
      form = {
        action, onSubmit, onSubmitCapture, noValidate, storage,
        status: action?.state || storage.status, fields: [], validatedFields: [],
        changed() {
          if (forms[path] === storage) dirty = true;
        },
        reportError(error) {
          if (forms[path] !== storage) return;
          page.actionError = error instanceof Error ? error : new Error('Form submission failed');
          dirty = true;
        },
      };
      nodeProps = layout;
    } else if (form && ['input', 'textarea', 'select'].includes(node.type)) {
      const { defaultValue, ...field } = nodeProps;
      if (field.type === 'hidden') {
        if (field.name && !field.disabled) form.fields.push([String(field.name), String(field.value ?? defaultValue ?? '')]);
        return null;
      }
      const controlled = field.value !== undefined && field.value !== null;
      const values = form.storage.values;
      if (!controlled && !Object.prototype.hasOwnProperty.call(values, path)) values[path] = String(defaultValue ?? '');
      if (!controlled) field.value = values[path];
      if (field.ref !== undefined && field.ref !== null) {
        const { ref, ...rest } = field;
        if (controlled || typeof ref !== 'object' || !Object.hasOwn(ref, 'current')) {
          throw new Error('Native field refs require an uncontrolled field and a ref object');
        }
        const owner = form;
        ref.current = {
          get value() { return owner.storage.values[path]; },
          set value(next) { owner.storage.values[path] = String(next); owner.changed(); },
        };
        for (const key of Object.keys(field)) delete field[key];
        Object.assign(field, rest);
      }
      if (field.name && !field.disabled) form.fields.push([String(field.name), String(field.value ?? '')]);
      if (!form.noValidate && !field.disabled && !field.readOnly) {
        const { type, required, min, max, step } = field;
        form.validatedFields.push({ path, type, required, min, max, step, value: String(field.value ?? '') });
      }
      if (form.storage.invalid?.path === path) field['aria-invalid'] = true;
      // Enter in a single-line field submits its form, as in a browser: with
      // the first submit button, or directly when it is the only text field.
      if (node.type === 'input' && !['checkbox', 'radio', 'file', 'submit', 'button'].includes(field.type)) {
        const owner = form;
        owner.implicitFields = (owner.implicitFields ?? 0) + 1;
        implicitSubmit = () => {
          if (owner.status.pending) return;
          if (owner.defaultSubmitter || owner.implicitFields === 1) return submitForm(owner, owner.defaultSubmitter ?? {});
        };
      }
      const onChange = field.onChange;
      field.onChange = event => {
        if (!controlled) form.storage.values[path] = event.target.value;
        if (form.storage.invalid?.path === path) form.storage.invalid = null;
        if (onChange) return onChange(event);
      };
      nodeProps = field;
    } else if (form && node.type === 'button' && (!nodeProps.type || nodeProps.type === 'submit')) {
      if (nodeProps.onClick) throw new Error('Native submit buttons use the form submit handler');
      const submitter = nodeProps;
      if (!nodeProps.disabled) form.defaultSubmitter ??= submitter;
      nodeProps = {
        ...nodeProps,
        disabled: !!nodeProps.disabled || form.status.pending,
        onClick: () => submitForm(form, submitter),
      };
    }
    const parentStyle = context?.stylesheet;
    const styled = stylesheet.length ? applyStylesheet(stylesheet, viewport, parentStyle, node.type,
      parentStyle ? nodeProps : { ...page.documentAttributes, ...nodeProps },
      { hovered: hoveredPaths.has(path), focused: focusedPath === path }) : null;
    if (styled) {
      const { className, ...rest } = nodeProps;
      nodeProps = { ...rest, style: styled.style };
    }
    const props = options.normalizeProps ? options.normalizeProps(nodeProps, node.type, page.appearance) : nodeProps;
    const output = { id: path, type, props: {}, children: [] };
    if (styled?.style.position === 'fixed') output.props.nativeCssViewport = true;
    let click = context?.click;
    if (type === 'Modal') portals.push(output);
    for (const key of Object.keys(props)) {
      if (key === 'children' || key === 'key') continue;
      if (key === 'onClick' || key === 'onChange' || key === 'onContextMenu' || (type === 'Modal' && key === 'onDismiss') ||
          key === 'onKeyDown') {
        if (props[key] === null || props[key] === undefined) continue;
        if (typeof props[key] !== 'function') throw new Error('Event handler must be a function');
        const token = revision + ':' + path + ':' + key;
        handlers[token] = {
          fn: props[key], event: key, path,
          disabled: !!props.disabled || (key !== 'onClick' && key !== 'onContextMenu' && !!props.readOnly),
        };
        if (options.standardChildren && key === 'onClick') {
          handlers[token].parent = click;
          click = handlers[token];
        }
        output.props[key === 'onClick' ? 'press' : key === 'onChange' ? 'change' :
          key === 'onDismiss' ? 'dismiss' : key === 'onContextMenu' ? 'contextMenu' : 'keyDown'] = token;
      } else if (key.startsWith('on')) {
        throw new Error('Unsupported event: ' + key);
      } else {
        output.props[key] = props[key];
      }
    }
    // Registered after prop normalisation: it is host behaviour, not a prop.
    if (implicitSubmit) {
      const token = revision + ':' + path + ':submit';
      handlers[token] = { fn: implicitSubmit, event: 'onNativeSubmit', path, disabled: !!props.disabled || !!props.readOnly };
      output.props.submit = token;
    }
    const queue = [];
    for (let i = 0; i < node.children.length; i++) {
      queueChildren(queue, node.children[i], path + '.' + i);
    }
    return renderChildren(queue, output.children, () => {
      if (node.type === 'form' && form.storage.invalid) {
        output.children.push({
          id: path + '.validation',
          type: 'Text',
          props: { role: 'alert', text: form.storage.invalid.message },
          children: [],
        });
      }
      if (disclosure) {
        // Closed content stays registered with its form, as in a browser, but is not shown.
        const summary = output.children.find(child => child.props['aria-expanded'] !== undefined);
        if (!summary) throw new Error('Native details requires a summary');
        if (!disclosure.open) output.children = [summary];
      }
      if (node.type === 'fieldset') output.props.role ??= 'group';
      if (node.type === 'ul') output.props.role ??= 'list';
      if (node.type === 'dt') output.props.role ??= 'term';
      if (node.type === 'dd') output.props.role ??= 'definition';
      if (node.type === 'li') {
        output.props.role ??= 'listitem';
        if (output.children.every(child => ['Text','Link'].includes(child.type)) &&
            !['flex','grid'].includes(props.style?.display)) output.type = 'Text';
      }
      if (node.type === 'strong' || node.type === 'code') {
        output.props.style ??= {};
        if (node.type === 'strong') output.props.style.fontWeight ??= 700;
        else output.props.style.fontFamily ??= 'monospace';
      }
      if (node.type === 'p' && props.style?.display === 'flex' && props.style.flexWrap) {
        output.type = 'Container';
      }
      if (node.type === 'label' && ['flex','grid'].includes(props.style?.display)) output.type = 'Container';
      if (type === 'Link' && (['block','flex','grid'].includes(props.style?.display) ||
          output.children.some(child => child.type === 'Container' || child.type === 'Svg'))) {
        output.type = 'LinkBlock';
      }
      if (node.type === 'div' && props.style?.truncate &&
          output.children.every(child => child.type === 'Text')) output.type = 'Text';
      if (node.type === 'span' && props.style?.display === 'flex' &&
          output.children.some(child => child.type === 'Svg')) output.type = 'Container';
      if (node.type === 'footer' && output.children.every(child => ['Text','Link'].includes(child.type))) {
        output.type = 'Text';
      }
      if (type === 'Svg' && output.children.some(child => !['SvgPath','SvgCircle','SvgRect'].includes(child.type))) {
        throw new Error('Native SVG requires path, circle or rect children');
      }
      // display:none and the empty:hidden variant remove the node from the native tree.
      if (props.style?.display === 'none' ||
          (props.nativeVariants?.empty?.display === 'none' && !output.children.length)) return null;
      return type === 'Modal' ? null : output;
    }, type === 'Modal' ? null : form, styled || click !== context?.click
      ? { parent: context, stylesheet: styled || context?.stylesheet, click }
      : context);
  }

  function startRender() {
    dirty = false;
    revision++;
    handlers = {};
    portals = [];
    seen = {};
    seenForms = {};
    seenDisclosures = {};
    seenCheckboxes = {};
    seenScrollRefs = new Map();
    seenFileRefs = new Map();
    return render(__jsx(Component, options.initialProps || {}), 'root');
  }

  function finishRender() {
    for (const [ref, mounted] of mountedFileRefs) {
      const target = seenFileRefs.get(ref);
      if (target?.path === mounted.path) {
        mounted.choose = target.choose;
        continue;
      }
      if (ref.current === mounted.handle) ref.current = null;
      mountedFileRefs.delete(ref);
    }
    for (const [ref, target] of seenFileRefs) {
      if (mountedFileRefs.has(ref)) continue;
      const mounted = {...target, handle: {
        click() {
          if (mountedFileRefs.get(ref) === mounted && ref.current === mounted.handle) return mounted.choose();
        },
      }};
      ref.current = mounted.handle;
      mountedFileRefs.set(ref, mounted);
    }
    for (const [ref, mounted] of mountedScrollRefs) {
      if (seenScrollRefs.get(ref) === mounted.path) continue;
      if (ref.current === mounted.handle) ref.current = null;
      scrollRequests.delete(mounted.path);
      mountedScrollRefs.delete(ref);
    }
    for (const [ref, path] of seenScrollRefs) {
      if (mountedScrollRefs.has(ref)) continue;
      const handle = {
        scrollIntoView({ behavior = 'auto' } = {}) {
          if (ref.current !== handle || mountedScrollRefs.get(ref)?.handle !== handle) return;
          if (behavior !== 'auto' && behavior !== 'smooth') throw new Error('Unsupported native scroll behavior');
          scrollRequests.add(path);
        },
      };
      ref.current = handle;
      mountedScrollRefs.set(ref, { path, handle });
    }
    for (const path of Object.keys(forms)) if (!seenForms[path]) delete forms[path];
    for (const path of Object.keys(disclosures)) if (!seenDisclosures[path]) delete disclosures[path];
    for (const path of Object.keys(checkboxes)) if (!seenCheckboxes[path]) delete checkboxes[path];
    for (const path of Object.keys(frames)) {
      if (!seen[path]) {
        cleanupFrame(frames[path]);
        delete frames[path];
      }
    }
    for (const path of Object.keys(frames)) {
      const effects = frames[path].effects;
      frames[path].effects = [];
      for (const effect of effects) effect();
    }
  }

  function frame(tree, reuse = false) {
    if (Array.isArray(tree)) {
      tree = { id: 'root.fragment', type: 'Container', props: { style: { padding: 0, gap: 0, flexDirection: 'column' } }, children: tree };
    }
    if (!reuse) {
      activeModalPath = portals[portals.length - 1]?.id;
      if (portals.length) {
        tree = tree?.type === 'Container'
          ? {...tree, children: [...tree.children, ...portals]}
          : {id: 'root.portals', type: 'Container', props: {style: {gap: 0}}, children: tree ? [tree, ...portals] : portals};
      }
    }
    tree = withWindowFrame(tree);
    lastTree = tree;
    const scrollIntoView = [...scrollRequests];
    scrollRequests.clear();
    const wakeAt = asyncPage ? nextWakeAt() : undefined;
    return { version: 1, type: 'snapshot', revision, tree, requests: takeRequests(),
      ...(scrollIntoView.length ? { scrollIntoView } : {}),
      ...(keyEvent ? { keyDefaultPrevented: keyEvent.defaultPrevented } : {}),
      ...(contextMenuEvent ? { contextMenuDefaultPrevented: contextMenuEvent.defaultPrevented } : {}),
      ...(page.location ? { route: page.location.pathname } : {}),
      ...(page.eventStream ? { eventStream: page.eventStream.id } : {}),
      ...(wakeAt === undefined ? {} : { wakeAt }),
      ...(stylesheet.length ? { viewportStyles: true } : {}),
      ...(interactionStyles ? { interactionStyles: true } : {}),
      ...(page.keyListeners.size || Object.values(handlers).some(handler => handler.event === 'onKeyDown')
        ? { keyListeners: true } : {}) };
  }

  // A host `key` command reports a shortcut-class key press. It bubbles from
  // the focused tree node through ancestor onKeyDown handlers to window and
  // document listeners. preventDefault() cancels the host's default action.
  function dispatchKey(command) {
    const { key, shiftKey, ctrlKey, altKey, metaKey, repeat, target } = command;
    if (typeof key !== 'string' || !key.length || key.length > 32 ||
        [shiftKey, ctrlKey, altKey, metaKey, repeat].some(flag => typeof flag !== 'boolean') ||
        (target !== null && (typeof target !== 'string' || target.length > 4096))) {
      throw new Error('Invalid native key event');
    }
    keyEvent = {
      type: 'keydown', key, shiftKey, ctrlKey, altKey, metaKey, repeat,
      target: target === null ? null : { id: target }, defaultPrevented: false, propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
    };
    const keyHandlers = new Map();
    for (const handler of Object.values(handlers)) if (handler.event === 'onKeyDown') keyHandlers.set(handler.path, handler);
    const chain = target === null ? [] : treeChain(lastTree, target) ?? [];
    const pending = [];
    for (let index = chain.length - 1; index >= 0 && !keyEvent.propagationStopped; index--) {
      const handler = keyHandlers.get(chain[index]);
      if (!handler || handler.disabled) continue;
      if (activeModalPath && handler.path !== activeModalPath && !handler.path.startsWith(activeModalPath + '.')) continue;
      const result = handler.fn(keyEvent);
      if (isPromise(result)) pending.push(result);
    }
    if (!keyEvent.propagationStopped) {
      for (const listener of Array.from(page.keyListeners)) {
        const result = listener(keyEvent);
        if (isPromise(result)) pending.push(result);
      }
    }
    if (pending.length) return Promise.all(pending);
  }

  // Windows apps without a WindowTitleBar get a default one: the app's tree is
  // wrapped with a title strip and window buttons, themed from its root
  // background. The nodes match those @reactc/ui WindowTitleBar emits.
  function withWindowFrame(tree) {
    const title = options.windowFrame?.title;
    if (typeof title !== 'string' || !tree || typeof tree !== 'object') return tree;
    if (tree.children?.some(child => child.props?.['data-native-window-titlebar'])) return tree;
    const style = tree.props?.style ?? {};
    const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(ff)?$/i.exec(String(style.backgroundColor ?? ''));
    const light = rgb ? (2126 * parseInt(rgb[1], 16) + 7152 * parseInt(rgb[2], 16) + 722 * parseInt(rgb[3], 16)) / 10000 > 150
      : tree.props?.['data-native-theme'] === 'light';
    const ink = light ? '#1f2328' : '#f3f5f8';
    const button = (command, label, caption) => ({
      id: 'root.window-frame.' + command, type: 'Button',
      props: { type: 'button', 'aria-label': label, 'data-native-window-command': command,
        style: { width: 46, height: 36, padding: 4, backgroundColor: '#00000000', color: ink } },
      children: [{ id: 'root.window-frame.' + command + '.text', type: 'Text', props: { text: caption }, children: [] }],
    });
    const titlebar = {
      id: 'root.window-frame', type: 'Container',
      props: { 'data-native-window-titlebar': true, style: {
        position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0, height: 36,
        paddingLeft: 12, backgroundColor: light ? '#e9ebee' : '#16181c', color: ink,
        borderBottomWidth: 1, borderColor: light ? '#d0d4da' : '#2a2d33',
      } },
      children: [
        { id: 'root.window-frame.title', type: 'Text', props: { style: { flexGrow: 1, fontSize: 12, color: ink }, text: title }, children: [] },
        button('minimize', 'Minimize', '−'), button('maximize', 'Maximize or restore', '□'), button('close', 'Close', '×'),
      ],
    };
    // Document-level settings stay on the root that the host reads them from.
    const documentProps = {};
    for (const [key, value] of Object.entries(tree.props ?? {})) if (key.startsWith('data-native-')) documentProps[key] = value;
    const rootStyle = { flexDirection: 'column', gap: 0, padding: 0 };
    if (style.backgroundColor !== undefined) rootStyle.backgroundColor = style.backgroundColor;
    if (style.color !== undefined) rootStyle.color = style.color;
    return { id: 'root.window', type: 'Container', props: { ...documentProps, style: rootStyle }, children: [titlebar, tree] };
  }

  function treeChain(tree, id, chain = []) {
    if (!tree || typeof tree !== 'object') return null;
    chain.push(tree.id);
    if (tree.id === id) return chain;
    for (const child of tree.children ?? []) if (treeChain(child, id, chain)) return chain;
    chain.pop();
    return null;
  }

  function snapshot() {
    const priorPage = currentPage;
    currentPage = page;
    try {
      for (let attempt = 0; attempt < 25; attempt++) {
        const tree = startRender();
        finishRender();
        if (!dirty) return frame(tree);
      }
      throw new Error('Effect update loop');
    } finally {
      currentPage = priorPage;
    }
  }

  function dispatch(command) {
    if (!command || typeof command !== 'object') throw new Error('Invalid command');
    if (command.type === 'viewport' && stylesheet.length) {
      const { width, height } = command;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
          width > 32768 || height > 32768) throw new Error('Invalid native viewport');
      viewport = { width, height };
      return;
    }
    if (command.type === 'key') return dispatchKey(command);
    if (command.type === 'interaction' && interactionStyles) {
      const { hover, focus } = command;
      for (const value of [hover, focus]) {
        if (value !== null && (typeof value !== 'string' || value.length > 4096)) throw new Error('Invalid native interaction');
      }
      // Hover applies to the reported target and every ancestor in the
      // committed tree. Unknown IDs (from an older frame) clear the state.
      hoveredPaths = new Set(hover === null ? [] : treeChain(lastTree, hover) ?? []);
      focusedPath = focus;
      return;
    }
    if (command.type === 'event') {
      const handler = typeof command.handler === 'string' && command.handler.startsWith(revision + ':') ? handlers[command.handler] : null;
      if (!handler || command.revision !== revision) throw new Error('Stale or unknown event');
      if (activeModalPath && handler.path !== activeModalPath && !handler.path.startsWith(activeModalPath + '.')) {
        throw new Error('Control is outside the active dialog');
      }
      if (handler.disabled) throw new Error('Control is disabled');
      if (handler.event === 'onChange') {
        if (typeof command.value !== 'string' || command.value.length > 16384) throw new Error('Invalid input value');
        return handler.fn({ target: { value: command.value } });
      }
      if (handler.event === 'onContextMenu') {
        const { clientX, clientY } = command;
        if (!Number.isSafeInteger(clientX) || !Number.isSafeInteger(clientY)) throw new Error('Invalid native context menu position');
        contextMenuEvent = {
          clientX, clientY, defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; },
        };
        return handler.fn(contextMenuEvent);
      }
      if (handler.event === 'onKeyDown') {
        const { key, shiftKey, ctrlKey, altKey, metaKey, repeat } = command;
        if (key !== 'Enter' || [shiftKey, ctrlKey, altKey, metaKey, repeat].some(flag => typeof flag !== 'boolean')) {
          throw new Error('Invalid native textarea key event');
        }
        keyEvent = {
          key, shiftKey, ctrlKey, altKey, metaKey, repeat, defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; },
        };
        return handler.fn(keyEvent);
      }
      if (options.standardChildren && handler.event === 'onClick') {
        let stopped = false;
        const event = {
          type: 'click', defaultPrevented: false,
          stopPropagation() { stopped = true; },
          preventDefault() { this.defaultPrevented = true; },
        };
        const pending = [];
        for (let target = handler; target && !stopped; target = target.parent) {
          if (activeModalPath && target.path !== activeModalPath && !target.path.startsWith(activeModalPath + '.')) break;
          if (target.disabled) continue;
          const result = target.fn(event);
          if (isPromise(result)) pending.push(result);
        }
        if (pending.length) return Promise.all(pending);
        return;
      }
      return handler.fn();
    }
    if (command.type === 'navigate') {
      if (typeof command.path !== 'string' || !command.path.startsWith('/') || command.path.length > 2048 || !page.navigate) {
        throw new Error('Invalid navigation');
      }
      return page.navigate(command.path);
    }
    if (command.type === 'result') return completeRequest(command);
    if (asyncPage && command.type === 'tick') return fireTimer();
    if (asyncPage && command.type === 'host-visibility') {
      if (typeof command.visible !== 'boolean') throw new Error('Invalid native visibility state');
      if (page.visible !== command.visible) {
        page.visible = command.visible;
        for (const listener of page.visibilityListeners) listener();
      }
      return;
    }
    if (asyncPage && command.type === 'gateway-event') {
      const stream = page.eventStream;
      if (!stream || command.subscription !== stream.id) return;
      if (typeof command.name !== 'string' || !/^[\w.-]{1,128}$/.test(command.name) ||
          typeof command.data !== 'string' || command.data.length > 16384) {
        throw new Error('Invalid native gateway event');
      }
      return stream.dispatch(command.name, command.data);
    }
    throw new Error('Unknown command type');
  }

  async function runAsync(command, starting) {
    if (currentPage) throw new Error('Concurrent page commands are unsupported');
    currentPage = page;
    page.renderCache = new Map();
    try {
      if (!starting) {
        page.awaitingHandler = true;
        try {
          const result = dispatch(command);
          if (isPromise(result)) await result;
          else requests.push(...takeBlockingRequests());
        } finally {
          page.awaitingHandler = false;
        }
        await flushPromiseJobs();
      }
      if (page.actionError) {
        const error = page.actionError;
        page.actionError = null;
        throw error;
      }
      if (!starting && (command.type === 'gateway-event' || command.type === 'host-visibility') &&
          !dirty && lastTree !== undefined) return frame(lastTree, true);
      for (let attempt = 0; attempt < 25; attempt++) {
        let tree;
        page.rendering = true;
        try {
          tree = await startRender();
        } finally {
          page.rendering = false;
        }
        finishRender();
        await flushPromiseJobs();
        if (!dirty) return frame(tree);
      }
      throw new Error('Effect update loop');
    } finally {
      keyEvent = undefined;
      contextMenuEvent = undefined;
      page.renderCache = null;
      currentPage = null;
    }
  }

  if (asyncPage) {
    return {
      setSynchronousHost(exchange) { page.synchronousHost = exchange; },
      start() { return runAsync(null, true); },
      handle(command) { return runAsync(command, false); },
      takeBlockingRequests,
      completeRequest,
      nextWakeAt,
      fireTimer,
      activeEventStream() { return page.eventStream?.id; },
      flushPromiseJobs,
    };
  }

  return {
    setSynchronousHost(exchange) { page.synchronousHost = exchange; },
    start() { return snapshot(); },
    handle(command) {
      currentPage = page;
      try {
        dispatch(command);
        return snapshot();
      } finally {
        keyEvent = undefined;
        contextMenuEvent = undefined;
        currentPage = null;
      }
    },
  };
}
