import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const logFile = path.join(config.logsFolder, 'app.log');
const colours = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', success: '\x1b[32m', reset: '\x1b[0m' };

function errorMessage(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function write(level, message) {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
  const colour = colours[level] || colours.info;
  console.log(`${colour}${line}${colours.reset}`);
  await mkdir(config.logsFolder, { recursive: true });
  await appendFile(logFile, `${line}\n`, 'utf8');
}

export const logger = {
  info: (message) => write('info', message),
  warn: (message) => write('warn', message),
  success: (message) => write('success', message),
  error: async (message, error) => write('error', `${message}${error ? ` | ${errorMessage(error)}` : ''}`)
};
