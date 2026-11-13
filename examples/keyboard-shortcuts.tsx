import { useState } from 'react';

// Keyboard behaviour: element onKeyDown, Enter submits a form from a
// single-line field, and Tab, Enter and Space reach buttons natively.
export default function KeyboardShortcuts() {
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState('none');
  const [presses, setPresses] = useState(0);
  const [last, setLast] = useState('none');

  return <main style={{ backgroundColor: '#ffffff', color: '#1f2328', flexDirection: 'column', gap: 12, padding: 16 }}>
    <h1>Keyboard shortcuts</h1>
    <form id="profile" style={{ flexDirection: 'column', gap: 8 }}
      onSubmit={event => { event.preventDefault(); setSubmitted(name || 'empty'); }}>
      <input id="name" aria-label="Name" value={name} onChange={event => setName(event.target.value)}
        onKeyDown={event => {
          setLast(event.key + (event.ctrlKey ? '+ctrl' : ''));
          if (event.key === 'Escape') { event.preventDefault(); setName(''); }
        }} />
      <button id="submit" type="submit">Submit</button>
    </form>
    <button id="first" type="button" onClick={() => setPresses(presses + 1)}>First {presses}</button>
    <div id="panel" onKeyDown={event => { if (event.key === 'F2') setLast('panel F2'); }}>
      <button id="second" type="button" onClick={() => setLast('second pressed')}>Second</button>
    </div>
    <p id="status" role="status">{'submitted ' + submitted + ' / presses ' + presses + ' / last ' + last}</p>
  </main>;
}
