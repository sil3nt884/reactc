// Adapted from chetx27/notes-app's server.js. See LICENSE.
import express from 'express';
import cors from 'cors';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const app = express();
const port = Number(process.env.PORT || 43767);
const file = process.env.NOTES_FILE || 'notes.json';
let state = existsSync(file)
  ? JSON.parse(readFileSync(file, 'utf8'))
  : { notes: [], nextId: 1 };

function store(next) {
  const temporary = file + '.tmp';
  writeFileSync(temporary, JSON.stringify(next), 'utf8');
  renameSync(temporary, file);
  state = next;
}

app.use(cors());
app.use(express.json({ limit: '8kb' }));

app.get('/notes', (req, res) => {
  res.json(state.notes);
});

app.post('/notes', (req, res) => {
  const { markdown, tag } = req.body || {};
  if (typeof markdown !== 'string' || !markdown.trim() || typeof tag !== 'string') {
    return res.status(400).json({ message: 'Write a note before saving.' });
  }
  const note = { id: state.nextId, markdown, tag, timestamp: new Date().toISOString() };
  const notes = [...state.notes, note];
  if (Buffer.byteLength(JSON.stringify(notes)) > 32768) {
    return res.status(413).json({ message: 'The note list is full. Delete a note to make room.' });
  }
  try {
    store({ notes, nextId: state.nextId + 1 });
    res.json(note);
  } catch {
    res.status(500).json({ message: 'The server could not save the note.' });
  }
});

app.delete('/notes/:id', (req, res) => {
  const id = Number(req.params.id);
  const notes = state.notes.filter(note => note.id !== id);
  if (notes.length === state.notes.length) return res.status(404).json({ message: 'Note not found.' });
  try {
    store({ notes, nextId: state.nextId });
    res.json({ message: 'Note deleted.' });
  } catch {
    res.status(500).json({ message: 'The server could not delete the note.' });
  }
});

app.listen(port, '127.0.0.1', () => console.log(`Notes API at http://127.0.0.1:${port}/notes`));
