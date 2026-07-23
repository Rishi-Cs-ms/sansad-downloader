import { runDownload } from './downloader.js';
import { logger } from './logger.js';

try {
  await logger.info('Scheduler entry point started; GitHub Actions will trigger each run.');
  await runDownload();
} catch (error) {
  await logger.error('Scheduled run failed.', error);
}
