import path from 'node:path';
import { mkdir, rename, rm, writeFile, access, constants } from 'node:fs/promises';
import { chromium } from 'playwright';
import { config } from './config.js';
import { logger } from './logger.js';
import { countPdfPages } from './pdf.js';
import { loadState, saveState, shouldSendEmail } from './state.js';
import { sendEmail } from './email.js';

const AGENDA_DOWNLOAD_TEST_ID = 'get-file__download-button';
const AGENDA_DOCUMENTS = [
  { label: 'List Of Business', filePrefix: 'Agenda' },
  { label: 'Revised List of Business', filePrefix: 'Revised_List_of_Business' }
];

function addDaysInTimeZone(baseDate, days) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(baseDate);

  const year = Number(parts.find((part) => part.type === 'year').value);
  const month = Number(parts.find((part) => part.type === 'month').value);
  const day = Number(parts.find((part) => part.type === 'day').value);
  return new Date(Date.UTC(year, month - 1, day + days));
}

export function tomorrow() {
  return addDaysInTimeZone(new Date(), 1);
}

export function todayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function agendaFileName(date, site, document) {
  return `${site.filePrefix}_${document.filePrefix}_${todayKey(date)}.pdf`;
}

function sansadDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date).replace(/ /g, '-');
}

function muiAriaDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: config.timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function saveFailureArtifacts(page, runId) {
  if (!page || page.isClosed()) return;
  const folder = path.join(config.logsFolder, 'failures');
  await mkdir(folder, { recursive: true });
  const base = path.join(folder, `failure-${runId}`);
  await Promise.allSettled([
    page.screenshot({ path: `${base}.png`, fullPage: true }),
    page.content().then((html) => writeFile(`${base}.html`, html, 'utf8'))
  ]);
}

function normalizeLabel(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function waitForAgendaResponse(page) {
  await page.waitForFunction(
    (firstDocumentName) => {
      const normalized = firstDocumentName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      return [...document.querySelectorAll('p')].some((node) => {
        const text = (node.textContent || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        return text === normalized;
      }) || [...document.querySelectorAll('p')].some((node) => /no document available/i.test(node.textContent || ''));
    },
    AGENDA_DOCUMENTS[0].label,
    { timeout: config.timeout }
  );
}

async function selectTomorrow(page, targetDate) {
  const input = page.locator('input[placeholder="dd-mmm-yyyy"]');
  await input.waitFor({ state: 'visible' });

  await input.fill(sansadDate(targetDate));
  await input.press('Enter');
  await page.waitForFunction(
    (expected) => document.querySelector('button[aria-label^="Choose date, selected date is"]')
      ?.getAttribute('aria-label')?.includes(expected),
    muiAriaDate(targetDate),
    { timeout: config.timeout }
  );
}

async function downloadPdf(page, temporaryPath) {
  const control = page.getByTestId(AGENDA_DOWNLOAD_TEST_ID);
  await control.waitFor({ state: 'visible' });
  const downloadPromise = page.waitForEvent('download', { timeout: config.timeout });
  await control.click();
  const download = await downloadPromise;
  const failure = await download.failure();
  if (failure) throw new Error(`Browser reported a download failure: ${failure}`);
  await download.saveAs(temporaryPath);
}

async function downloadWithRetry(page, temporaryPath, documentName) {
  let lastError;
  for (let attempt = 1; attempt <= config.retries; attempt += 1) {
    try {
      await logger.info(`${documentName}: download started (attempt ${attempt}/${config.retries}).`);
      await downloadPdf(page, temporaryPath);
      await logger.success(`${documentName}: download finished.`);
      return;
    } catch (error) {
      lastError = error;
      await logger.warn(`${documentName}: download attempt ${attempt} failed: ${error.message}`);
      await rm(temporaryPath, { force: true });
    }
  }
  throw new Error(`Download failed after ${config.retries} attempts: ${lastError.message}`, { cause: lastError });
}

function agendaCard(page, documentName) {
  return page.locator('.MuiCard-root').filter({
    has: page.locator('p').filter({ hasText: documentName })
  });
}

async function selectAgendaDocument(page, documentName) {
  const card = agendaCard(page, documentName);
  if (await card.count() !== 1) return false;

  const cardLink = card.locator('a');
  if (await cardLink.count() !== 1) {
    throw new Error(`Could not identify the download/select link for ${documentName}.`);
  }

  await cardLink.click();
  await page.waitForFunction(
    ({ name, testId }) => {
      const title = [...document.querySelectorAll('p')]
        .find((node) => (node.textContent || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
      const cardElement = title?.closest('.MuiCard-root');
      return Boolean(cardElement) && Boolean(document.querySelector(`[data-testid="${testId}"]`));
    },
    { name: documentName, testId: AGENDA_DOWNLOAD_TEST_ID },
    { timeout: config.timeout }
  );
  return true;
}

async function processAgendaDocument(page, site, document, targetDate, temporaryFolder, runId) {
  const fileName = agendaFileName(targetDate, site, document);
  const finalPath = path.join(config.downloadFolder, fileName);
  const temporaryPath = path.join(temporaryFolder, `${fileName}.${runId}.part`);

  if (await exists(finalPath)) {
    await logger.info(`${site.shortName}/${document.label}: skipped because ${fileName} already exists.`);
    return { site: site.id, document: document.label, status: 'already-exists', filePath: finalPath };
  }

  try {
    const available = await selectAgendaDocument(page, document.label);
    if (!available) {
      await logger.info(`${site.shortName}/${document.label}: not published for tomorrow; skipped.`);
      return { site: site.id, document: document.label, status: 'not-published' };
    }

    await logger.info(`${site.shortName}/${document.label}: PDF found in Sansad’s in-page PDF viewer.`);
    await downloadWithRetry(page, temporaryPath, `${site.shortName}/${document.label}`);
    const pages = await countPdfPages(temporaryPath);
    await logger.info(`${site.shortName}/${document.label}: number of pages: ${pages}.`);

    if (pages === 1) {
      await rm(temporaryPath, { force: true });
      await logger.info(`${site.shortName}/${document.label}: skipped because agenda contains only one page.`);
      return { site: site.id, document: document.label, status: 'one-page', pages };
    }

    if (await exists(finalPath)) {
      await rm(temporaryPath, { force: true });
      await logger.warn(`${site.shortName}/${document.label}: ${fileName} was created by another run; temporary file deleted.`);
      return { site: site.id, document: document.label, status: 'already-exists', filePath: finalPath };
    }

    await rename(temporaryPath, finalPath);
    await logger.success(`${site.shortName}/${document.label}: saved ${finalPath}`);
    return { site: site.id, document: document.label, status: 'saved', filePath: finalPath, pages };
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function processSite(page, site, targetDate, temporaryFolder, runId) {
  await logger.info(`${site.name}: opening site.`);
  await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: config.timeout }).catch(() => {});
  await logger.info(`${site.name}: website opened.`);

  await selectTomorrow(page, targetDate);
  await waitForAgendaResponse(page);

  const noDocument = await page.getByText('No document available', { exact: false }).count();
  if (noDocument > 0) {
    await logger.warn(`${site.name}: Sansad reports no document available for tomorrow.`);
    return { site: site.id, status: 'no-document' };
  }

  const results = [];
  for (const document of AGENDA_DOCUMENTS) {
    try {
      results.push(await processAgendaDocument(page, site, document, targetDate, temporaryFolder, runId));
    } catch (error) {
      await logger.error(`${site.name}/${document.label}: processing failed; continuing with the other documents.`, error);
      await saveFailureArtifacts(page, `${runId}-${site.id}-${document.filePrefix}`);
      results.push({ site: site.id, document: document.label, status: 'failed', error: error.message });
    }
  }
  return { site: site.id, status: 'completed', results };
}

export async function runDownload() {
  const startedAt = Date.now();
  const runId = `${Date.now()}-${process.pid}`;
  const targetDate = tomorrow();
  const temporaryFolder = path.join(config.downloadFolder, '.tmp');
  const today = todayKey(new Date());
  const state = await loadState(config.stateFile);

  await mkdir(temporaryFolder, { recursive: true });
  await logger.info(`Tomorrow date (${config.timeZone}): ${today}.`);

  if (!shouldSendEmail(state, today)) {
    await logger.info(`Email already sent for ${today}; exiting without downloading again.`);
    return { status: 'already-sent' };
  }

  let browser;
  let page;

  try {
    browser = await chromium.launch({ headless: config.headless });
    const context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();
    page.setDefaultTimeout(config.timeout);
    page.setDefaultNavigationTimeout(config.timeout);

    const siteResults = [];
    for (const site of config.sites) {
      siteResults.push(await processSite(page, site, targetDate, temporaryFolder, runId));
    }

    const savedFiles = siteResults
      .flatMap((siteResult) => siteResult.results || [])
      .filter((result) => result.status === 'saved')
      .map((result) => result.filePath);

    if (savedFiles.length === 0) {
      await logger.info('No valid PDF documents were found this run.');
      return { status: 'completed', sites: siteResults, email: { sent: false, reason: 'no-pdfs' } };
    }

    const emailResult = await sendEmail({ pdfFiles: savedFiles, dateKey: today });
    if (emailResult.sent) {
      await saveState(config.stateFile, { ...state, lastSent: today });
    }

    return { status: 'completed', sites: siteResults, email: emailResult };
  } catch (error) {
    await logger.error('Agenda download run failed.', error);
    await saveFailureArtifacts(page, runId);
    throw error;
  } finally {
    await browser?.close().catch(async (error) => logger.error('Browser close failed.', error));
    await logger.info(`Execution time: ${Date.now() - startedAt} ms.`);
  }
}
