// Task statistics, computed on their own thread with @reactc/threads. Threads
// share the server's heap, so the task list is read in place, not copied.
// Under Node (npm run dev:server) the thread runs on the calling thread.
import { Thread } from '@reactc/threads';
import type { Summary, Task } from '../shared/tasks.ts';

/** Counts open and done tasks and the most common title words. */
export function summarize(tasks: readonly Task[]): Summary {
  const words = new Map<string, number>();
  let done = 0;
  for (const task of tasks) {
    if (task.done) done++;
    for (const word of task.title.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length > 2) words.set(word, (words.get(word) ?? 0) + 1);
    }
  }
  const topWords = [...words].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5);
  return { total: tasks.length, done, open: tasks.length - done, topWords };
}

/** summarize() on a new thread. A thread is a promise: `await new SummaryThread(tasks)`. */
export class SummaryThread extends Thread<Summary> {
  tasks: readonly Task[];

  constructor(tasks: readonly Task[]) {
    super();
    this.tasks = tasks;
  }

  run(): Summary {
    return summarize(this.tasks);
  }
}
