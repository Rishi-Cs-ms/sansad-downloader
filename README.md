# Sansad Agenda Downloader

A Node.js (ES Modules) automation that checks both Parliament agenda sites for tomorrow's documents, downloads valid PDFs, and sends one email per day with all saved attachments.

## What it does

- Monitors both:
  - Lok Sabha: https://sansad.in/ls/business/agenda
  - Rajya Sabha: https://sansad.in/rs/house-business/items-of-business
- For each site, checks both documents:
  - List Of Business
  - Revised List of Business
- Selects tomorrow's date and downloads any available PDF from the in-page viewer.
- Keeps only multi-page PDFs and never overwrites an existing file.
- Sends one email per day when at least one valid PDF exists.
- Uses a persistent state file to avoid duplicate emails on subsequent runs.

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
- EMAIL_USER, EMAIL_PASSWORD, EMAIL_TO: SMTP credentials for Nodemailer.
- STATE_FILE: JSON file used for duplicate-email protection.

## Running locally

```bash
npm start
```

## Running GitHub Actions

The repository includes [.github/workflows/parliament-downloader.yml](.github/workflows/parliament-downloader.yml). It runs every 5 minutes between 7:00 PM and 9:00 PM IST via cron and also supports workflow_dispatch.

Set GitHub Secrets:

- EMAIL_USER
- EMAIL_PASSWORD
- EMAIL_TO

## Project structure

```text
sansad-downloader/
├── src/
│   ├── config.js       # Environment configuration
│   ├── downloader.js   # Browser workflow and PDF processing
│   ├── email.js        # Nodemailer email delivery
│   ├── index.js        # Entry point
│   ├── logger.js       # Console and file logging
│   ├── pdf.js          # PDF page counting
│   ├── scheduler.js    # GitHub Actions-friendly entry point
│   └── state.js        # Persistent duplicate-email state
├── .github/workflows/
├── downloads/
├── logs/
├── .env.example
├── package.json
└── README.md
```

## Troubleshooting

- Chromium is missing: run `npx playwright install chromium`.
- Timeout or site unavailable: increase TIMEOUT and inspect logs/app.log plus logs/failures/.
- No document available: the site has not published tomorrow's agenda yet; the run exits cleanly.
- Email not sent: ensure EMAIL_USER/EMAIL_PASSWORD/EMAIL_TO are configured and that the run produced at least one saved PDF.
