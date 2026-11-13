import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, SummaryThread } from './summary.ts';

const tasks = [
  { id: 1, title: 'Write the report', done: true },
  { id: 2, title: 'Review the report draft', done: false },
  { id: 3, title: 'Plan', done: false },
];

test('summarize counts tasks and common words', () => {
  assert.deepEqual(summarize(tasks), {
    total: 3, done: 1, open: 2,
    topWords: [['report', 2], ['the', 2], ['draft', 1], ['plan', 1], ['review', 1]],
  });
});

test('a SummaryThread can be awaited like a promise', async () => {
  assert.equal((await new SummaryThread(tasks)).total, 3);
});
