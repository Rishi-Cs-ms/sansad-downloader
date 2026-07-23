import { runDownload } from './downloader.js';
import { logger } from './logger.js';

runDownload().catch(async (error) => {
  await logger.error('Unhandled application error.', error);
  process.exitCode = 1;
});
