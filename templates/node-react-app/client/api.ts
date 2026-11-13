// The client's view of the server API. reactc compiles `fetch` to native
// HTTP for the origin set as httpOrigin in reactc.config.json: every method,
// request headers such as Authorization, text bodies, and response headers.
import { ORIGIN } from '../shared/tasks.ts';
import type { Task } from '../shared/tasks.ts';

async function request<T>(path: string, init?: { method: string; body?: unknown }): Promise<T> {
  const options = init?.body === undefined
    ? (init ? { method: init.method } : undefined)
    : { method: init.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) };
  const response = await fetch(ORIGIN + path, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error ?? 'Request failed (' + response.status + ')');
  return data as T;
}

export const api = {
  list: () => request<Task[]>('/tasks'),
  add: (title: string) => request<Task>('/tasks', { method: 'POST', body: { title } }),
  update: (id: number, changes: { title?: string; done?: boolean }) =>
    request<Task>('/tasks/' + id, { method: 'PATCH', body: changes }),
  remove: (id: number) => request<null>('/tasks/' + id, { method: 'DELETE' }),
};
