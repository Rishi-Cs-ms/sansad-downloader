import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function loadState(stateFile = path.join(projectRoot, 'state.json')) {
  try {
    const raw = await readFile(stateFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function saveState(stateFile = path.join(projectRoot, 'state.json'), state) {
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

export function shouldSendEmail(state, todayKey) {
  return !state?.lastSent || state.lastSent !== todayKey;
}
