// Native bindings for the Next.js App Router APIs used by desktop pages.
import {
  __jsx, getPageNavigation, registerNavigator, requestActionRefresh,
  getPageCookies, setTimeout, clearTimeout, useMemo, useState,
} from './page-runtime.js';
import { Request, Response } from 'reactc:fetch-tcp';

export { setTimeout, clearTimeout };
export default Link;
export { Response as NextResponse };

let routeHandlers = [];

export function withRouteHandlers(fetch) {
  return async (input, init) => {
    if (typeof input === 'string' && input.startsWith('/') && !input.startsWith('//')) {
      const url = new URL(input, 'http://reactc.local');
      for (const [pattern, methods] of routeHandlers) {
        const params = match(pattern, url.pathname);
        if (params === null) continue;
        const request = new Request(url, init);
        const handler = methods[request.method];
        if (typeof handler !== 'function') return new Response(null, { status: 405 });
        return handler(request, { params: Promise.resolve(params) });
      }
    }
    return fetch(input, init);
  };
}

export function Link({ href, prefetch, replace, scroll, children, ...props }) {
  return __jsx('a', { ...props, href, children });
}

export function usePathname() {
  return getPageNavigation().location.pathname;
}

export function useSearchParams() {
  const query = getPageNavigation().location.search;
  return useMemo(() => new URLSearchParams(query), [query]);
}

export function useRouter() {
  const page = getPageNavigation();
  return {
    push: href => page.navigate(href),
    replace: href => page.navigate(href, 'replace'),
    refresh: () => page.navigate(null, 'refresh'),
    back: () => page.navigate(null, 'back'),
  };
}

export function redirect(href) {
  const error = new Error('Page redirected');
  error.nativeRedirect = String(href);
  throw error;
}

export function revalidatePath() {
  requestActionRefresh();
}

export async function cookies() {
  const store = getPageCookies();
  return {
    get(name) {
      const entry = store.get(name);
      if (!entry) return undefined;
      if (entry.expires <= Date.now()) { store.delete(name); return undefined; }
      return { name, value: entry.value };
    },
    set(name, value, options = {}) {
      const expires = options.maxAge === undefined ? Infinity : Date.now() + options.maxAge * 1000;
      store.set(name, { value: String(value), expires });
    },
    delete(name) { store.delete(name); },
  };
}

function match(pattern, path) {
  const parts = path.split('/');
  const expected = pattern.split('/');
  if (parts.length !== expected.length) return null;
  const params = {};
  for (let i = 0; i < parts.length; i++) {
    const part = expected[i];
    if (part.startsWith('[') && part.endsWith(']')) {
      if (!parts[i]) return null;
      params[part.slice(1, -1)] = decodeURIComponent(parts[i]);
    } else if (part !== parts[i]) return null;
  }
  return params;
}

export function createApp(routes, Layout, handlers) {
  routeHandlers = handlers;
  routes.sort((a, b) => a[0].split('[').length - b[0].split('[').length);
  return function NativeApp() {
    const [state, setState] = useState({ history: ['/'], revision: 0 });
    const href = state.history[state.history.length - 1];
    const location = new URL(href, 'http://reactc.local');
    registerNavigator((path, mode) => {
      if (path !== null && (typeof path !== 'string' || !path.startsWith('/') ||
          path.startsWith('//') || /[\\\x00-\x1f\x7f]/.test(path))) {
        throw new TypeError('Native navigation requires a local path');
      }
      setState(current => {
        let history = current.history;
        if (mode === 'back') history = history.length > 1 ? history.slice(0, -1) : history;
        else if (mode === 'replace') history = [...history.slice(0, -1), path];
        else if (mode !== 'refresh') history = [...history, path];
        return { history, revision: current.revision + 1 };
      });
    }, location, state.history.length > 1, state.revision);

    const searchParams = Object.create(null);
    for (const [key, value] of location.searchParams) {
      if (Object.hasOwn(searchParams, key)) searchParams[key] = [].concat(searchParams[key], value);
      else searchParams[key] = value;
    }
    let content = __jsx('p', { children: 'Page not found' });
    for (const [pattern, Page] of routes) {
      const params = match(pattern, location.pathname);
      if (params !== null) {
        content = __jsx(Page, { key: location.pathname, params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) });
        break;
      }
    }
    return Layout ? __jsx(Layout, { children: content }) : content;
  };
}
