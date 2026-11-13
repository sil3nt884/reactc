import React, { useState } from 'react';
import { greeting } from '../shared/greeting.js';

// Asks the compiled server for a greeting; shows the local one until it answers.
export default function Greeting() {
  const [name, setName] = useState('');
  const [reply, setReply] = useState(greeting(''));
  async function ask() {
    try {
      const response = await fetch('http://127.0.0.1:5055/greeting?name=' + encodeURIComponent(name));
      setReply((await response.json()).text);
    } catch {
      setReply('The server is not running');
    }
  }
  return (
    <main style={{ backgroundColor: '#ffffff', color: '#1f2328', flexDirection: 'column', gap: 12, padding: 16 }}>
      <input id="name" aria-label="Name" value={name} onChange={event => setName(event.target.value)} />
      <button id="ask" type="button" onClick={() => { void ask(); }}>Ask the server</button>
      <p id="reply" role="status">{reply}</p>
    </main>
  );
}
