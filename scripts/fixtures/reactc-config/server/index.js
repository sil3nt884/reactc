// A dependency-free HTTP server: GET /greeting?name=Ada -> {"text":"Hello, Ada!"}
import http from 'node:http';
import { PORT, greeting } from '../shared/greeting.js';

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/greeting') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    response.end(JSON.stringify({ text: greeting(url.searchParams.get('name')) }));
    return;
  }
  response.writeHead(404, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => console.log('Greeting server on http://127.0.0.1:' + PORT));
