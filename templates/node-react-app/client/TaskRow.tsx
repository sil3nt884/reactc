import type { Task } from '../shared/tasks.ts';

interface TaskRowProps {
  task: Task;
  busy: boolean;
  onToggle: (task: Task) => void;
  onRemove: (task: Task) => void;
}

export function TaskRow({ task, busy, onToggle, onRemove }: TaskRowProps) {
  return <li id={'task-' + task.id} className={task.done ? 'task done' : 'task'}>
    <span className="task-title">{(task.done ? '✓ ' : '') + task.title}</span>
    <button id={'toggle-' + task.id} type="button" className="secondary" disabled={busy}
      onClick={() => onToggle(task)}>{task.done ? 'Reopen' : 'Done'}</button>
    <button id={'remove-' + task.id} type="button" className="secondary icon" disabled={busy}
      aria-label={'Remove ' + task.title} onClick={() => onRemove(task)}>×</button>
  </li>;
}
