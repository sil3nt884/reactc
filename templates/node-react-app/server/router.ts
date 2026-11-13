import { titleProblem } from '../shared/tasks.ts';
import type { TaskStore } from './store.ts';

export interface Reply {
  status: number;
  body: unknown;
}

/**
 * The API, independent of HTTP so it can be tested directly.
 *
 *   GET    /tasks          -> Task[]
 *   POST   /tasks          {title}        -> Task (201)
 *   PATCH  /tasks/:id      {title?, done?} -> Task
 *   DELETE /tasks/:id      -> 204
 *   GET    /health         -> {ok: true}
 */
export function route(store: TaskStore, method: string, path: string, body: unknown): Reply {
  if (method === 'GET' && path === '/health') return { status: 200, body: { ok: true } };
  if (path === '/tasks') {
    if (method === 'GET') return { status: 200, body: store.list() };
    if (method === 'POST') {
      const title = (body as { title?: unknown } | null)?.title;
      const problem = titleProblem(title);
      if (problem) return { status: 400, body: { error: problem } };
      return { status: 201, body: store.add(title as string) };
    }
    return { status: 405, body: { error: 'Method not allowed' } };
  }
  const match = /^\/tasks\/(\d+)$/.exec(path);
  if (match) {
    const id = Number(match[1]);
    if (method === 'PATCH') {
      const changes = (body ?? {}) as { title?: unknown; done?: unknown };
      if (changes.title !== undefined) {
        const problem = titleProblem(changes.title);
        if (problem) return { status: 400, body: { error: problem } };
      }
      if (changes.done !== undefined && typeof changes.done !== 'boolean') {
        return { status: 400, body: { error: 'done must be true or false' } };
      }
      const task = store.update(id, { title: changes.title as string | undefined, done: changes.done as boolean | undefined });
      return task ? { status: 200, body: task } : { status: 404, body: { error: 'No such task' } };
    }
    if (method === 'DELETE') {
      return store.remove(id) ? { status: 204, body: null } : { status: 404, body: { error: 'No such task' } };
    }
    return { status: 405, body: { error: 'Method not allowed' } };
  }
  return { status: 404, body: { error: 'Not found' } };
}
