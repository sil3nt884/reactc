// Shared by the server and the client: the data shape, the API address and
// validation. Put code both sides use in shared/ (see reactc.config.json).

export const PORT = 5180;
export const ORIGIN = 'http://127.0.0.1:' + PORT;

export interface Task {
  id: number;
  title: string;
  done: boolean;
}

/** GET /summary: computed on its own thread by the server. */
export interface Summary {
  total: number;
  done: number;
  open: number;
  topWords: Array<[string, number]>;
}

export interface TaskInput {
  title: string;
}

export const MAX_TITLE = 120;

/** Returns an error message, or null when the title is acceptable. */
export function titleProblem(title: unknown): string | null {
  if (typeof title !== 'string') return 'Title must be text';
  const trimmed = title.trim();
  if (!trimmed) return 'Title is required';
  if (trimmed.length > MAX_TITLE) return 'Title must be at most ' + MAX_TITLE + ' characters';
  return null;
}
