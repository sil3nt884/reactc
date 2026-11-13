import { useState } from 'react';

// Starter app: a small task list. Edit this file, then run
// `powershell -File examples/starter/build.ps1` to compile and open it.
// See examples/starter/README.md for what you can use.

interface Task {
  id: number;
  title: string;
  done: boolean;
}

type Filter = 'all' | 'open' | 'done';

const colors = {
  page: '#ffffff',
  text: '#1f2328',
  muted: '#59636e',
  accent: '#2f6feb',
  line: '#d0d7de',
  doneText: '#8c959f',
};

export default function StarterApp() {
  const [draft, setDraft] = useState('');
  const [tasks, setTasks] = useState<Task[]>([
    { id: 1, title: 'Read examples/starter/README.md', done: true },
    { id: 2, title: 'Change this app and rebuild it', done: false },
  ]);
  const [nextId, setNextId] = useState(3);
  const [filter, setFilter] = useState<Filter>('all');

  function addTask() {
    const title = draft.trim();
    if (!title) return;
    setTasks([...tasks, { id: nextId, title, done: false }]);
    setNextId(nextId + 1);
    setDraft('');
  }

  function toggle(id: number) {
    setTasks(tasks.map(task => task.id === id ? { ...task, done: !task.done } : task));
  }

  function remove(id: number) {
    setTasks(tasks.filter(task => task.id !== id));
  }

  const visible = tasks.filter(task => filter === 'all' || (filter === 'done') === task.done);
  const open = tasks.filter(task => !task.done).length;

  return <main style={{ backgroundColor: colors.page, color: colors.text, flexDirection: 'column', gap: 16, padding: 24 }}>
    <h1 style={{ fontSize: 26 }}>My tasks</h1>

    {/* Enter in the field submits the form. Escape clears the draft. */}
    <form id="add-task" style={{ display: 'flex', flexDirection: 'row', gap: 8 }}
      onSubmit={event => { event.preventDefault(); addTask(); }}>
      <input id="draft" aria-label="New task" placeholder="What needs doing?" value={draft}
        style={{ flexGrow: 1 }}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setDraft(''); } }} />
      <button id="add" type="submit" disabled={!draft.trim()}
        style={{ backgroundColor: colors.accent, color: '#ffffff', borderWidth: 0, width: 96 }}>Add</button>
    </form>

    <div id="filters" style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
      {(['all', 'open', 'done'] as Filter[]).map(name =>
        <button key={name} id={'filter-' + name} type="button" onClick={() => setFilter(name)}
          style={filter === name ? { width: 80, borderColor: colors.accent, color: colors.accent } : { width: 80 }}>
          {name}
        </button>)}
    </div>

    <ul id="tasks" style={{ flexDirection: 'column', gap: 8 }}>
      {visible.map(task =>
        <li key={task.id} id={'task-' + task.id} style={{
          display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
          padding: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 8,
        }}>
          <span style={{ flexGrow: 1, color: task.done ? colors.doneText : colors.text }}>
            {(task.done ? '✓ ' : '') + task.title}
          </span>
          <button id={'toggle-' + task.id} type="button" onClick={() => toggle(task.id)} style={{ width: 96 }}>
            {task.done ? 'Reopen' : 'Done'}
          </button>
          <button id={'remove-' + task.id} type="button" aria-label={'Remove ' + task.title}
            onClick={() => remove(task.id)} style={{ width: 44 }}>×</button>
        </li>)}
    </ul>

    <p id="summary" role="status" style={{ color: colors.muted }}>
      {open + ' open · ' + (tasks.length - open) + ' done'}
    </p>
  </main>;
}
