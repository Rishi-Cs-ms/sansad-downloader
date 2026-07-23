import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadState, saveState, shouldSendEmail } from '../src/state.js';

test('shouldSendEmail returns false for the same day after a successful send', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sansad-state-'));
  try {
    const stateFile = path.join(tempDir, 'state.json');
    await saveState(stateFile, { lastSent: '2026-07-23' });
    const state = await loadState(stateFile);
    assert.equal(shouldSendEmail(state, '2026-07-23'), false);
    assert.equal(shouldSendEmail(state, '2026-07-24'), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
