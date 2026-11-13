// Adapted from chetx27/notes-app's App.js and SearchBar.js. See LICENSE.
import { useEffect, useState } from 'react';
import { createFetch } from '../../src/reactc-fetch.js';

const request = createFetch('http://127.0.0.1:43767');
const welcome = '# Welcome to Notes\nType your Markdown here.';
const panel = { padding: 14, gap: 8, borderRadius: 8, backgroundColor: '#1b2636' };

type Note = { id: number; markdown: string; tag: string; timestamp: string };

function SearchBar({ searchTerm, onSearchChange }: { searchTerm: string; onSearchChange: (text: string) => void }) {
  return <div style={{ gap: 6 }}>
    <input id="search" type="text" placeholder="Search notes or tags" value={searchTerm}
      onChange={event => onSearchChange(event.target.value)} />
    {searchTerm && <button onClick={() => onSearchChange('')}>Clear search</button>}
  </div>;
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  return <div id="preview" style={{ gap: 4 }}>
    {markdown.split('\n').map((line, index) => {
      if (!line.trim()) return null;
      if (line.startsWith('# ')) return <h1 key={index}>{line.slice(2)}</h1>;
      if (line.startsWith('## ')) return <h2 key={index}>{line.slice(3)}</h2>;
      if (line.startsWith('### ')) return <h3 key={index}>{line.slice(4)}</h3>;
      if (line.startsWith('- ') || line.startsWith('* ')) return <p key={index}>• {line.slice(2)}</p>;
      return <p key={index}>{line}</p>;
    })}
  </div>;
}

async function json(path: string, init?: object) {
  const response = await request(path, init);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'The server returned HTTP ' + response.status);
  return result;
}

export default function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [markdown, setMarkdown] = useState(welcome);
  const [tag, setTag] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [status, setStatus] = useState('Loading notes…');
  const [pending, setPending] = useState(true);

  function start(message: string, action: () => Promise<void>) {
    setPending(true);
    setStatus(message);
    void action().catch(error => setStatus(error.message)).finally(() => setPending(false));
  }

  function loadNotes() {
    start('Loading notes…', async () => {
      const data = await json('/notes');
      setNotes(data);
      setStatus(data.length ? 'Notes loaded' : 'No saved notes yet');
    });
  }

  useEffect(loadNotes, []);

  function selectNote(note: Note) {
    setMarkdown(note.markdown);
    setTag(note.tag);
    setSelectedNoteId(note.id);
  }

  function resetEditor() {
    setMarkdown('# New Note\n');
    setTag('');
    setSelectedNoteId(null);
  }

  function saveNote() {
    if (!markdown.trim()) {
      setStatus('Write a note before saving.');
      return;
    }
    start('Saving note…', async () => {
      const note = await json('/notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown, tag }),
      });
      setNotes(current => [...current, note]);
      setSelectedNoteId(note.id);
      setStatus('Note saved');
    });
  }

  function deleteNote(id: number) {
    setDeleteId(null);
    start('Deleting note…', async () => {
      await json('/notes/' + id, { method: 'DELETE' });
      setNotes(current => current.filter(note => note.id !== id));
      if (selectedNoteId === id) resetEditor();
      setStatus('Note deleted');
    });
  }

  const query = searchTerm.trim().toLowerCase();
  const filtered = notes.filter(note => note.markdown.toLowerCase().includes(query) || note.tag.toLowerCase().includes(query));

  return <main style={{ padding: 16, gap: 12 }}>
    <h1>Markdown Notes</h1>
    <p id="status" style={{ color: '#a7c4ee' }}>{status}</p>
    <div style={panel}>
      <h2>Editor</h2>
      <textarea id="editor" aria-label="Markdown" value={markdown} onChange={event => setMarkdown(event.target.value)} style={{ height: 145 }} />
      <input id="tag" aria-label="Tag" placeholder="Add a tag" value={tag} onChange={event => setTag(event.target.value)} />
      <div style={{ flexDirection: 'row', gap: 8 }}>
        <button id="save" disabled={pending} onClick={saveNote}>Save note</button>
        <button id="new" disabled={pending} onClick={resetEditor}>New note</button>
      </div>
    </div>
    <div style={panel}>
      <h2>Preview</h2>
      <MarkdownPreview markdown={markdown} />
    </div>
    <div style={panel}>
      <h2>Saved notes ({notes.length})</h2>
      <SearchBar searchTerm={searchTerm} onSearchChange={setSearchTerm} />
      <button id="reload" disabled={pending} onClick={loadNotes}>Reload notes</button>
      {!filtered.length && <p>{query ? 'No matches' : 'Saved notes appear here.'}</p>}
      {filtered.map(note => <div key={note.id} style={{ gap: 5 }}>
        <div style={{ flexDirection: 'row', gap: 8 }}>
          <button id={'note-' + note.id} disabled={pending} onClick={() => selectNote(note)}>
            {note.markdown.split('\n')[0].replace(/^#+\s*/, '').trim() || 'Untitled'}
          </button>
          <button id={'ask-delete-' + note.id} disabled={pending} onClick={() => setDeleteId(note.id)}>Delete</button>
        </div>
        {note.tag && <p style={{ color: '#a7c4ee' }}>{note.tag}</p>}
        {deleteId === note.id && <div style={{ flexDirection: 'row', gap: 8 }}>
          <button id={'delete-' + note.id} disabled={pending} onClick={() => deleteNote(note.id)}>Confirm delete</button>
          <button onClick={() => setDeleteId(null)}>Cancel</button>
        </div>}
      </div>)}
    </div>
  </main>;
}
