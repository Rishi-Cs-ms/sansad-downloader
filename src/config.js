import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function booleanFromEnv(value, fallback) {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === 'true';
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveProjectPath(value, fallback) {
  const chosen = value || fallback;
  return path.isAbsolute(chosen) ? chosen : path.resolve(projectRoot, chosen);
}

export const config = Object.freeze({
  projectRoot,
  downloadFolder: resolveProjectPath(process.env.DOWNLOAD_FOLDER, 'downloads'),
  logsFolder: path.join(projectRoot, 'logs'),
  stateFile: resolveProjectPath(process.env.STATE_FILE || 'state.json', 'state.json'),
  headless: booleanFromEnv(process.env.HEADLESS, true),
  timeout: positiveInteger(process.env.TIMEOUT, 60_000),
  retries: positiveInteger(process.env.RETRIES, 3),
  timeZone: process.env.TIME_ZONE || 'Asia/Kolkata',
  sites: [
    { id: 'ls', name: 'Lok Sabha', shortName: 'LS', baseUrl: 'https://sansad.in/ls/business/agenda', filePrefix: 'LS' },
    { id: 'rs', name: 'Rajya Sabha', shortName: 'RS', baseUrl: 'https://sansad.in/rs/house-business/items-of-business', filePrefix: 'RS' }
  ],
  email: {
    user: process.env.EMAIL_USER || '',
    password: process.env.EMAIL_PASSWORD || '',
    to: process.env.EMAIL_TO || ''
  }
});
