import { useState } from 'react';

// Controls without their own border use the native renderer's defaults. The
// light root background selects light control fills and window chrome.
export default function DefaultControls() {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [tinted, setTinted] = useState('');
  const [presses, setPresses] = useState(0);

  return <main style={{ backgroundColor: '#ffffff', color: '#1f2328', flexDirection: 'column', gap: 12, padding: 16 }}>
    <h1>Default controls</h1>
    <input id="plain-input" aria-label="Name" placeholder="Name" value={name}
      onChange={event => setName(event.target.value)} />
    <textarea id="plain-notes" aria-label="Notes" value={notes} onChange={event => setNotes(event.target.value)} />
    <button id="plain-button" onClick={() => setPresses(presses + 1)}>Pressed {presses} times</button>
    <input id="tinted-input" aria-label="Tinted" style={{ borderColor: '#d22f8c' }} value={tinted}
      onChange={event => setTinted(event.target.value)} />
    <input id="borderless-input" aria-label="Borderless" style={{ borderWidth: 0 }} value=""
      onChange={() => {}} />
    <input id="custom-input" aria-label="Custom" style={{ borderWidth: 2, borderColor: '#5c9bff' }} value=""
      onChange={() => {}} />
    <p id="summary" role="status">{(name || 'Nobody') + ' / ' + presses}</p>
  </main>;
}
