import nodemailer from 'nodemailer';
import path from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';

export async function sendEmail({ pdfFiles, dateKey }) {
  const recipients = (process.env.EMAIL_TO || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (recipients.length === 0) {
    await logger.warn('No EMAIL_TO recipients configured; skipping email.');
    return { sent: false, reason: 'no-recipients' };
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });

  const subject = `Parliament Agenda - ${dateKey}`;
  const body = 'The attached agenda documents were automatically downloaded.';

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: recipients.join(','),
    subject,
    text: body,
    attachments: pdfFiles.map((filePath) => ({
      filename: path.basename(filePath),
      path: filePath
    }))
  });

  await logger.success(`Email sent to ${recipients.join(', ')} with ${pdfFiles.length} attachment(s).`);
  return { sent: true };
}
