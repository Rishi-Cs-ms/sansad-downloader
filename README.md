# Sansad Agenda Downloader

A Node.js (ES Modules) automation that checks both Parliament agenda sites for tomorrow's documents, downloads valid PDFs, and sends one email with any newly discovered attachments.

## What it does

- Monitors both:
  - Lok Sabha: https://sansad.in/ls/business/agenda
  - Rajya Sabha: https://sansad.in/rs/house-business/items-of-business
- For each site, checks both documents:
  - List Of Business
  - Revised List of Business
- Selects tomorrow's date and downloads any available PDF from the in-page viewer.
- Keeps only multi-page PDFs and never overwrites an existing file.
- Tracks each document independently with a persistent state file so later runs continue from the remaining unfinished documents.
- Sends one email when a run finds one or more new PDFs.

## Installation

```bash
cd sansad-downloader
npm ci
npx playwright install chromium
```

Copy the example environment file and edit it:

```bash
cp .env.example .env
```

Example values:

```env
DOWNLOAD_FOLDER=downloads
HEADLESS=true
TIMEOUT=60000
RETRIES=3
TIME_ZONE=Asia/Kolkata
EMAIL_USER=
EMAIL_PASSWORD=
EMAIL_TO=
STATE_FILE=state.json
```

## Environment variables

- DOWNLOAD_FOLDER: output folder for PDFs.
- HEADLESS: run Chromium headlessly.
- TIMEOUT: Playwright timeout in milliseconds.
- RETRIES: retry attempts for each download.
- TIME_ZONE: timezone used for selecting tomorrow's date; keep this as Asia/Kolkata for GitHub Actions.
- EMAIL_USER, EMAIL_PASSWORD, EMAIL_TO: SMTP credentials for Nodemailer. EMAIL_PASSWORD must be a Google App Password for Gmail SMTP.
- STATE_FILE: JSON file used to track per-document progress.

## Running locally

```bash
npm start
```

## GitHub Actions schedule

The workflow uses the requested cron expressions so it runs only during the 7:00 PM to 9:00 PM IST window:

- 13:30-13:59 UTC
- 14:00-14:55 UTC
- 15:00-15:30 UTC

It also supports workflow_dispatch for manual runs.

## GitHub Secrets

Set these in your repository secrets:

- EMAIL_USER
- EMAIL_PASSWORD
- EMAIL_TO

## State persistence

The downloader stores progress in state.json. Because GitHub Actions starts from a fresh checkout, the workflow commits state.json back to the repository whenever it changes.

## Architecture

The project stays modular:

- src/downloader.js: browser flow and document processing
- src/email.js: Nodemailer delivery
- src/state.js: per-document state persistence
- src/logger.js: logging and failure artifacts
- src/pdf.js: PDF validation

## Troubleshooting

- Chromium is missing: run `npx playwright install chromium`.
- Timeout or site unavailable: increase TIMEOUT and inspect logs/app.log plus logs/failures/.
- No document available: the site has not published tomorrow's agenda yet; the run exits cleanly.
- Email not sent: ensure EMAIL_USER/EMAIL_PASSWORD/EMAIL_TO are configured and that the run produced at least one saved PDF.
