import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

export async function countPdfPages(pdfPath) {
  try {
    const bytes = await readFile(pdfPath);
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return pdf.getPageCount();
  } catch (error) {
    throw new Error(`Invalid or unreadable PDF at ${pdfPath}: ${error.message}`, { cause: error });
  }
}
