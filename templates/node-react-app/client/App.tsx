// The React client. `npm run build:client` compiles it into
// dist/client/Tasks.exe, which talks to the server at httpOrigin.
import { useEffect, useState } from 'react';
import { titleProblem } from '../shared/tasks.ts';
import type { Task } from '../shared/tasks.ts';
import { api } from './api.ts';
import { TaskRow } from './TaskRow.tsx';
import './App.css';

type Filter = 'all' | 'open' | 'done';

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      setTasks(await api.list());
      setError('');
    } catch (problem) {
      setError('Cannot reach the server. Start it with npm run dev:server or dist/server/TasksServer.exe. ' +
        (problem instanceof Error ? problem.message : ''));
    } finally {
      setLoading(false);
    }
  }

  // Runs one server call at a time and shows its error, if any.
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function add() {
    const problem = titleProblem(draft);
    if (problem) { setError(problem); return; }
    void run(async () => {
      const task = await api.add(draft);
      setTasks(current => [...current, task]);
      setDraft('');
    });
  }

  function toggle(task: Task) {
    void run(async () => {
      const updated = await api.update(task.id, { done: !task.done });
      setTasks(current => current.map(item => item.id === updated.id ? updated : item));
    });
  }

  function remove(task: Task) {
    void run(async () => {
      await api.remove(task.id);
      setTasks(current => current.filter(item => item.id !== task.id));
    });
  }

  const visible = tasks.filter(task => filter === 'all' || (filter === 'done') === task.done);
  const open = tasks.filter(task => !task.done).length;

  return <main className="app">
    <h1>Tasks</h1>

    {/* Enter in the field submits; Escape clears it. */}
    <form id="add-task" className="add-form" onSubmit={event => { event.preventDefault(); add(); }}>
      <input id="draft" aria-label="New task" placeholder="What needs doing?" value={draft}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setDraft(''); } }} />
      <button id="add" type="submit" disabled={busy || !draft.trim()}>Add</button>
    </form>

    <div className="filters">
      {(['all', 'open', 'done'] as Filter[]).map(name =>
        <button key={name} id={'filter-' + name} type="button" className={filter === name ? 'active' : ''}
          onClick={() => setFilter(name)}>{name}</button>)}
      <button id="refresh" type="button" disabled={loading} onClick={() => { void load(); }}>Refresh</button>
    </div>

    {error ? <p id="error" role="alert" className="error">{error}</p> : null}

    <ul id="tasks" className="tasks">
      {visible.map(task => <TaskRow key={task.id} task={task} busy={busy} onToggle={toggle} onRemove={remove} />)}
    </ul>

    <p id="summary" role="status" className="summary">
      {loading ? 'Loading…' : open + ' open · ' + (tasks.length - open) + ' done'}
    </p>
  </main>;
}
