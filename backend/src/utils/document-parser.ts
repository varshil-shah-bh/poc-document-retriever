import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

/**
 * Parses raw document bytes into clean, readable plain text.
 *
 * Type detection priority (most → least reliable):
 *  1. Magic bytes   — immune to wrong/missing Content-Type headers
 *  2. File extension from the filename
 *  3. Content-Type  header (last resort; often "application/octet-stream")
 *
 * PDF  → pdfjs-dist  (renders actual page text; avoids the raw object-stream
 *                     garbage that pdf-parse emits for tagged/structured PDFs)
 * DOCX → mammoth
 * TXT  → UTF-8 decode
 */
export async function parseDocument(
  content: Buffer,
  contentType: string,
  filename?: string,
): Promise<string> {
  const ext = detectFileType(content, contentType, filename);

  if (ext === '.pdf') return parsePDF(content);
  if (ext === '.docx') return parseDocx(content);
  return content.toString('utf-8');
}

// ── File-type detection ───────────────────────────────────────────────────────

/**
 * Determines the canonical extension using magic bytes first, then filename,
 * then Content-Type.  Returns '.pdf', '.docx', or '.txt'.
 */
function detectFileType(content: Buffer, contentType: string, filename?: string): string {
  // ── 1. Magic bytes ────────────────────────────────────────────────────────
  // PDF: starts with "%PDF"
  if (content.length >= 4 && content.slice(0, 4).toString('ascii') === '%PDF') {
    return '.pdf';
  }
  // DOCX / ZIP: PK\x03\x04 signature (Office Open XML is a ZIP archive)
  if (
    content.length >= 4 &&
    content[0] === 0x50 && content[1] === 0x4b &&
    content[2] === 0x03 && content[3] === 0x04
  ) {
    return '.docx';
  }

  // ── 2. Filename extension ─────────────────────────────────────────────────
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'pdf')              return '.pdf';
    if (ext === 'docx' || ext === 'doc') return '.docx';
    if (ext === 'txt' || ext === 'md' || ext === 'csv') return '.txt';
  }

  // ── 3. Content-Type header ────────────────────────────────────────────────
  const ct = contentType.toLowerCase();
  if (ct.includes('pdf'))                                             return '.pdf';
  if (ct.includes('wordprocessingml') || ct.includes('msword'))       return '.docx';

  return '.txt';
}

// ── PDF via pdfjs-dist ────────────────────────────────────────────────────────

async function parsePDF(content: Buffer): Promise<string> {
  // pdfjs-dist 4+ ships only ESM (.mjs) — use dynamic import, not require().
  // The legacy build is more Node.js-friendly (no modern browser-only APIs).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsLib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as any;

  // Disable the browser worker thread — not available in Node.js
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';

  const uint8 = new Uint8Array(content);
  const loadingTask = pdfjsLib.getDocument({ data: uint8, useSystemFonts: true });
  const pdf = await loadingTask.promise;

  const pageTexts: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Group items into lines by their Y position (rounded to nearest 2pt)
    const lineMap = new Map<number, string[]>();

    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      // transform[5] is the Y coordinate
      const y = Math.round((item as { transform: number[]; str: string }).transform[5] / 2) * 2;
      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y)!.push((item as { str: string }).str);
    }

    // Sort lines top-to-bottom (descending Y in PDF coordinates)
    const lines = Array.from(lineMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, words]) => words.join(' ').trim())
      .filter(Boolean);

    if (lines.length) pageTexts.push(lines.join('\n'));
  }

  const fullText = pageTexts.join('\n\n');
  return sanitizeText(fullText);
}

// ── DOCX via mammoth ──────────────────────────────────────────────────────────

async function parseDocx(content: Buffer): Promise<string> {
  const tmpFile = join(tmpdir(), `rag_docx_${randomUUID()}.docx`);
  try {
    await fs.writeFile(tmpFile, content);
    const { DocxLoader } = await import('@langchain/community/document_loaders/fs/docx');
    const loader = new DocxLoader(tmpFile);
    const docs = await loader.load();
    return sanitizeText(docs.map((d) => d.pageContent).join('\n\n'));
  } finally {
    await fs.unlink(tmpFile).catch(() => undefined);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Strips residual PDF internal syntax that occasionally leaks through parsers
 * (object headers, dictionaries, binary streams) and normalises whitespace.
 */
export function sanitizeText(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return true; // keep blank lines for paragraph detection
      if (/^\d+\s+\d+\s+(obj|R)\s*$/.test(t)) return false; // PDF object / ref
      if (/^(endobj|stream|endstream|xref|startxref|%%EOF)\s*$/.test(t)) return false;
      if (/^<</.test(t) || /^>>\s*$/.test(t)) return false; // PDF dict delimiters
      if (/^\/[A-Za-z]/.test(t)) return false; // PDF name entries (/Type, /K, etc.)
      // Lines that contain zero printable ASCII – likely binary/hex data
      if (!/[\x20-\x7E]/.test(t)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n') // collapse excessive blank lines
    .trim();
}

