import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createSiteState() {
  return {
    listOfBusiness: false,
    revisedListOfBusiness: false
  };
}

function createDayState() {
  return {
    loksabha: createSiteState(),
    rajyasabha: createSiteState()
  };
}

function normalizeSiteId(siteId) {
  if (siteId === 'ls') return 'loksabha';
  if (siteId === 'rs') return 'rajyasabha';
  return siteId;
}

function normalizeStateShape(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return {};
  }

  const normalized = {};
  for (const [dayKey, dayState] of Object.entries(state)) {
    if (!dayState || typeof dayState !== 'object' || Array.isArray(dayState)) {
      continue;
    }

    const normalizedDayState = {};
    for (const [siteKey, siteState] of Object.entries(dayState)) {
      const normalizedSiteKey = normalizeSiteId(siteKey);
      if (normalizedSiteKey === 'loksabha' || normalizedSiteKey === 'rajyasabha') {
        normalizedDayState[normalizedSiteKey] = siteState;
      }
    }

    if (Object.keys(normalizedDayState).length === 0) {
      normalized[dayKey] = createDayState();
    } else {
      normalized[dayKey] = {
        ...createDayState(),
        ...normalizedDayState
      };
    }
  }
  return normalized;
}

export function getOrCreateDayState(state, dayKey) {
  if (!state[dayKey]) {
    state[dayKey] = createDayState();
  }
  return state[dayKey];
}

export function getDocumentState(state, dayKey, siteId, documentKey) {
  const normalizedSiteId = normalizeSiteId(siteId);
  const dayState = state?.[dayKey];
  return Boolean(dayState?.[normalizedSiteId]?.[documentKey]);
}

export function markDocumentProcessed(state, dayKey, siteId, documentKey) {
  const normalizedSiteId = normalizeSiteId(siteId);
  const dayState = getOrCreateDayState(state, dayKey);
  if (!dayState[normalizedSiteId]) {
    dayState[normalizedSiteId] = createSiteState();
  }
  dayState[normalizedSiteId][documentKey] = true;
  return state;
}

export async function loadState(stateFile = path.join(projectRoot, 'state.json')) {
  try {
    const raw = await readFile(stateFile, 'utf8');
    return normalizeStateShape(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function saveState(stateFile = path.join(projectRoot, 'state.json'), state) {
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
  return state;
}
