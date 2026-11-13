import React, { useEffect, useState } from 'react';

// reactc fixture for window and document keydown listeners. reactc binds
// `window` and `document` to native host adapters; the JS compiler does not.
export default function WindowKeys() {
  const [log, setLog] = useState('ready');
  useEffect(() => {
    function onWindowKey(event) {
      if (event.ctrlKey && event.key === 's') { event.preventDefault(); setLog('saved'); }
    }
    function onDocumentKey(event) {
      if (event.key === 'F1') setLog('help');
    }
    window.addEventListener('keydown', onWindowKey);
    document.addEventListener('keydown', onDocumentKey);
    return () => {
      window.removeEventListener('keydown', onWindowKey);
      document.removeEventListener('keydown', onDocumentKey);
    };
  }, []);
  return (
    <main style={{ backgroundColor: '#ffffff', color: '#1f2328', padding: 16 }}>
      <input id="field" aria-label="Field" value="" onChange={() => {}} />
      <p id="log" role="status">{log}</p>
    </main>
  );
}
