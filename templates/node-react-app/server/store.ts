import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Task } from '../shared/tasks.ts';

/** Tasks in memory, saved to a JSON file after every change. */
export class TaskStore {
  private tasks: Task[] = [];
  private nextId = 1;
  private readonly file: string | null;

  /** `file` is where tasks are saved; null keeps them in memory only. */
  constructor(file: string | null) {
    this.file = file;
    if (file && existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { tasks: Task[]; nextId: number };
      this.tasks = saved.tasks;
      this.nextId = saved.nextId;
    }
  }

  list(): Task[] {
    return this.tasks.map(task => ({ ...task }));
  }

  add(title: string): Task {
    const task = { id: this.nextId++, title: title.trim(), done: false };
    this.tasks.push(task);
    this.save();
    return { ...task };
  }

  update(id: number, changes: Partial<Pick<Task, 'title' | 'done'>>): Task | null {
    const task = this.tasks.find(candidate => candidate.id === id);
    if (!task) return null;
    if (changes.title !== undefined) task.title = changes.title.trim();
    if (changes.done !== undefined) task.done = changes.done;
    this.save();
    return { ...task };
  }

  remove(id: number): boolean {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter(task => task.id !== id);
    if (this.tasks.length === before) return false;
    this.save();
    return true;
  }

  private save(): void {
    if (this.file) writeFileSync(this.file, JSON.stringify({ tasks: this.tasks, nextId: this.nextId }, null, 2));
  }
}
