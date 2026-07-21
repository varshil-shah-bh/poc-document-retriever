import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * Parses raw document bytes into clean, readable plain text.
 *
 * PDF  → pdfjs-dist  (renders actual page text; avoids the raw object-stream
 *                     garbage that pdf-parse emits for tagged/structured PDFs)
 * DOCX → mammoth
 * TXT  → UTF-8 decode
 */
export async function parseDocument(content: Buffer, contentType: string): Promise<string> {
  const ext = resolveExtension(contentType);

  if (ext === '.pdf') {
    return parsePDF(content);
  }

  if (ext === '.docx') {
    return parseDocx(content);
  }

  // Plain text / Markdown / CSV
  return content.toString('utf-8');
}

// ── PDF via pdfjs-dist ────────────────────────────────────────────────────────

async function parsePDF(content: Buffer): Promise<string> {
  // pdfjs-dist ships a legacy Node.js-compatible CJS build
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as any;

  // Disable the worker (not available in Node.js)
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

function resolveExtension(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('pdf')) return '.pdf';
  if (ct.includes('wordprocessingml') || ct.includes('docx') || ct.includes('msword'))
    return '.docx';
  return '.txt';
}

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

