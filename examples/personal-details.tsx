'use client';

import { useState } from 'react';
import { callServer } from '../src/page-runtime.js';

// A standalone prototype page.
export default function PersonalDetails() {
  const [name, setName] = useState('Example User');
  const [height, setHeight] = useState('175');
  const [goals, setGoals] = useState('Build strength');
  const [status, setStatus] = useState('Ready to edit');
  const [saving, setSaving] = useState(false);

  function save() {
    const fullName = name.trim();
    const heightCm = Number(height);
    if (!fullName || fullName.length > 100) { setStatus('Enter a name of 1–100 characters.'); return; }
    if (!height.trim() || !Number.isFinite(heightCm) || heightCm < 30 || heightCm > 300) { setStatus('Enter a height between 30 and 300 cm.'); return; }
    if (goals.length > 1000) { setStatus('Keep goals within 1000 characters.'); return; }
    setSaving(true);
    setStatus('Saving…');
    callServer('profile.save', {fullName, heightCm, goals}, (result) => {
      setSaving(false);
      setStatus(result && result.ok === true ? 'Saved successfully' : 'Save failed. Your edits are still here.');
    });
  }

  return <main style={{padding:24, width:440, flexDirection:'column'}}>
    <h1>Personal details</h1>
    <p>Porffor native page · demo data</p>
    <label htmlFor="full-name">Full name</label>
    <input id="full-name" value={name} disabled={saving} onChange={event => setName(event.target.value)} />
    <label htmlFor="height">Height (cm)</label>
    <input id="height" value={height} disabled={saving} onChange={event => setHeight(event.target.value)} />
    <label htmlFor="goals">Goals</label>
    <textarea id="goals" value={goals} disabled={saving} onChange={event => setGoals(event.target.value)} />
    <button id="save" disabled={saving} onClick={save}>Save changes</button>
    <p id="status" role="status">{status}</p>
  </main>;
}
