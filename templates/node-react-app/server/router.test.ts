import assert from 'node:assert/strict';
import { test } from 'node:test';
import { route } from './router.ts';
import { TaskStore } from './store.ts';

test('creates, lists, updates and deletes tasks', () => {
  const store = new TaskStore(null);
  assert.deepEqual(route(store, 'GET', '/tasks', null), { status: 200, body: [] });
  const created = route(store, 'POST', '/tasks', { title: '  Ship it  ' });
  assert.deepEqual(created, { status: 201, body: { id: 1, title: 'Ship it', done: false } });
  assert.equal(route(store, 'PATCH', '/tasks/1', { done: true }).status, 200);
  assert.deepEqual(route(store, 'GET', '/tasks', null).body, [{ id: 1, title: 'Ship it', done: true }]);
  assert.equal(route(store, 'DELETE', '/tasks/1', null).status, 204);
  assert.equal(route(store, 'DELETE', '/tasks/1', null).status, 404);
});

test('rejects invalid input', () => {
  const store = new TaskStore(null);
  assert.equal(route(store, 'POST', '/tasks', { title: '' }).status, 400);
  assert.equal(route(store, 'POST', '/tasks', null).status, 400);
  route(store, 'POST', '/tasks', { title: 'A' });
  assert.equal(route(store, 'PATCH', '/tasks/1', { done: 'yes' }).status, 400);
  assert.equal(route(store, 'PUT', '/tasks', null).status, 405);
  assert.equal(route(store, 'GET', '/nope', null).status, 404);
});
