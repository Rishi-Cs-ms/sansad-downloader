import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadState, saveState, getDocumentState, markDocumentProcessed } from '../src/state.js';
import { looksLikeAgendaPageContent } from '../src/downloader.js';

test('tracks each document independently for a day', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sansad-state-'));
  try {
    const stateFile = path.join(tempDir, 'state.json');
    const state = {};
    markDocumentProcessed(state, '2026-07-23', 'loksabha', 'listOfBusiness');
    await saveState(stateFile, state);

    const reloaded = await loadState(stateFile);
    assert.equal(getDocumentState(reloaded, '2026-07-23', 'loksabha', 'listOfBusiness'), true);
    assert.equal(getDocumentState(reloaded, '2026-07-23', 'loksabha', 'revisedListOfBusiness'), false);
    assert.equal(getDocumentState(reloaded, '2026-07-23', 'rajyasabha', 'listOfBusiness'), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('recognizes agenda page labels and no-document messages', () => {
  assert.equal(looksLikeAgendaPageContent('List of Business'), true);
  assert.equal(looksLikeAgendaPageContent('Revised List of Business'), true);
  assert.equal(looksLikeAgendaPageContent('No document available'), true);
  assert.equal(looksLikeAgendaPageContent('Some unrelated content'), false);
});
