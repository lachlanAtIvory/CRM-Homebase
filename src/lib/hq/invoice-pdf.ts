import { extractText, getDocumentProxy } from "unpdf";

/** Server-only helpers for validating and reading an uploaded invoice PDF. */

export const MAX_INVOICE_BYTES = 5 * 1024 * 1024;   // 5 MB — matches the bucket limit

/** Real PDFs start with "%PDF-". Checked on the bytes, not the file name or MIME type. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
    bytes[3] === 0x46 && bytes[4] === 0x2d
  );
}

/**
 * Extract the text layer. Throws if the PDF can't be parsed; returns ""
 * for image-only (scanned) PDFs, which have no text to read.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // pdf.js takes ownership of the buffer it's given, so hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
