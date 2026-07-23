import path from 'node:path';
import { mkdir, rename, rm, writeFile, access, constants } from 'node:fs/promises';
import { chromium } from 'playwright';
import { config } from './config.js';
import { logger } from './logger.js';
import { countPdfPages } from './pdf.js';
import { loadState, saveState, getDocumentState, markDocumentProcessed } from './state.js';
import { sendEmail } from './email.js';

const AGENDA_DOWNLOAD_TEST_ID = 'get-file__download-button';
const AGENDA_DOCUMENTS = [
  { label: 'List Of Business', filePrefix: 'Agenda', key: 'listOfBusiness' },
  { label: 'Revised List of Business', filePrefix: 'Revised_List_of_Business', key: 'revisedListOfBusiness' }
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

export function today() {
  return addDaysInTimeZone(new Date(), 0);
}

export function agendaDateCandidates(date = new Date()) {
  return [addDaysInTimeZone(date, 1), addDaysInTimeZone(date, 0)];
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

export function looksLikeAgendaPageContent(value) {
  const text = value || '';
  const normalized = normalizeLabel(text);
  return normalized.includes('list of business') ||
    normalized.includes('revised list of business') ||
    /no document available|no documents available|no data available/i.test(text);
}

async function waitForAgendaResponse(page) {
  await page.waitForTimeout(2_000).catch(() => {});
}

async function selectTomorrow(page, targetDate) {
  const input = page.locator('input[placeholder="dd-mmm-yyyy"]');
  await input.waitFor({ state: 'visible' });

  await input.fill(sansadDate(targetDate));
  await input.press('Enter');
  await waitForAgendaResponse(page);
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
  await page.waitForTimeout(2_000).catch(() => {});

  const control = page.getByTestId(AGENDA_DOWNLOAD_TEST_ID);
  const hasControl = await control.count();
  if (hasControl === 0) {
    await logger.warn(`${documentName}: the page did not expose the expected document controls in time; continuing with the current state.`);
    return false;
  }
  return true;
}

async function processAgendaDocument(page, site, document, targetDate, temporaryFolder, runId, state, dayKeyValue) {
  const fileName = agendaFileName(targetDate, site, document);
  const finalPath = path.join(config.downloadFolder, fileName);
  const temporaryPath = path.join(temporaryFolder, `${fileName}.${runId}.part`);

  if (getDocumentState(state, dayKeyValue, site.id, document.key)) {
    await logger.info(`${site.shortName}/${document.label}: already processed for ${dayKeyValue}; skipping.`);
    return { site: site.id, document: document.label, status: 'already-processed' };
  }

  if (await exists(finalPath)) {
    markDocumentProcessed(state, dayKeyValue, site.id, document.key);
    await saveState(config.stateFile, state);
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
    markDocumentProcessed(state, dayKeyValue, site.id, document.key);
    await saveState(config.stateFile, state);
    await logger.success(`${site.shortName}/${document.label}: saved ${finalPath}`);
    return { site: site.id, document: document.label, status: 'saved', filePath: finalPath, pages };
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function processSite(page, site, temporaryFolder, runId, state, dayKeyValue) {
  await logger.info(`${site.name}: opening site.`);
  await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: config.timeout }).catch(() => {});
  await logger.info(`${site.name}: website opened.`);

  const results = [];
  let usedDate = null;

  for (const targetDate of agendaDateCandidates()) {
    await selectTomorrow(page, targetDate);
    await waitForAgendaResponse(page);

    const pageText = await page.locator('body').innerText();
    const noDocument = /no document available|no documents available|no data available/i.test(pageText);
    if (noDocument) {
      await logger.warn(`${site.name}: Sansad reports no document available for ${todayKey(targetDate)}.`);
      continue;
    }

    const dateResults = [];
    for (const document of AGENDA_DOCUMENTS) {
      try {
        dateResults.push(await processAgendaDocument(page, site, document, targetDate, temporaryFolder, runId, state, dayKeyValue));
      } catch (error) {
        await logger.error(`${site.name}/${document.label}: processing failed; continuing with the other documents.`, error);
        await saveFailureArtifacts(page, `${runId}-${site.id}-${document.filePrefix}`);
        dateResults.push({ site: site.id, document: document.label, status: 'failed', error: error.message });
      }
    }

    const hasUsefulResult = dateResults.some((result) => ['saved', 'already-exists', 'already-processed', 'one-page'].includes(result.status));
    if (hasUsefulResult) {
      usedDate = targetDate;
      results.push(...dateResults);
      break;
    }

    if (dateResults.some((result) => result.status !== 'not-published')) {
      usedDate = targetDate;
      results.push(...dateResults);
      break;
    }
  }

  if (!usedDate) {
    await logger.warn(`${site.name}: no agenda was available for either tomorrow or today.`);
    return { site: site.id, status: 'no-document' };
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

  let browser;
  let page;

  try {
    browser = await chromium.launch({ headless: config.headless });
    const context = await browser.newContext({ acceptDownloads: true });
    page = await context.newPage();
    page.setDefaultTimeout(config.timeout);
    page.setDefaultNavigationTimeout(config.timeout);

    const siteResults = [];
    const savedFiles = [];
    for (const site of config.sites) {
      const siteResult = await processSite(page, site, temporaryFolder, runId, state, today);
      siteResults.push(siteResult);
      for (const result of siteResult.results || []) {
        if (result.status === 'saved' && result.filePath && !savedFiles.includes(result.filePath)) {
          savedFiles.push(result.filePath);
        }
      }
    }

    if (savedFiles.length === 0) {
      await logger.info('No valid PDF documents were found this run.');
      return { status: 'completed', sites: siteResults, email: { sent: false, reason: 'no-pdfs' } };
    }

    const emailResult = await sendEmail({ pdfFiles: savedFiles, dateKey: today });
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
