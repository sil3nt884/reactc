import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TITLE, titleProblem } from './tasks.ts';

test('titles must be non-empty text within the limit', () => {
  assert.equal(titleProblem('Buy milk'), null);
  assert.equal(titleProblem('   '), 'Title is required');
  assert.equal(titleProblem(42), 'Title must be text');
  assert.match(titleProblem('x'.repeat(MAX_TITLE + 1)) ?? '', /at most/);
});
