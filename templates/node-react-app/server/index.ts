// HTTP entry. Runs under Node (`npm run dev:server`) and compiled by reactc
// into dist/server/TasksServer.exe (`npm run build:server`).
import http from 'node:http';
import { PORT } from '../shared/tasks.ts';
import { route } from './router.ts';
import { TaskStore } from './store.ts';
import { SummaryThread } from './summary.ts';

// Saved next to where the server is started. Set TASKS_FILE to move it, or
// TASKS_FILE=memory to keep tasks in memory only.
const file = process.env.TASKS_FILE === 'memory' ? null : process.env.TASKS_FILE || 'tasks.json';
const store = new TaskStore(file);

const server = http.createServer((request, response) => {
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { raw += chunk; });
  request.on('end', () => {
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        send(response, { status: 400, body: { error: 'Body must be JSON' } });
        return;
      }
    }
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    // GET /summary runs on its own thread; the server keeps serving meanwhile.
    if (request.method === 'GET' && path === '/summary') {
      new SummaryThread(store.list()).then(
        summary => send(response, { status: 200, body: summary }),
        error => { console.error(error); send(response, { status: 500, body: { error: 'Server error' } }); });
      return;
    }
    try {
      send(response, route(store, request.method ?? 'GET', path, body));
    } catch (error) {
      console.error(error);
      send(response, { status: 500, body: { error: 'Server error' } });
    }
  });
});

function send(response: http.ServerResponse, reply: { status: number; body: unknown }) {
  const text = reply.body === null ? '' : JSON.stringify(reply.body);
  response.writeHead(reply.status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(text);
}

server.listen(PORT, '127.0.0.1', () => {
  console.log('Tasks server on http://127.0.0.1:' + PORT + (file ? ' (saving to ' + file + ')' : ' (in memory)'));
});
