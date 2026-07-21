import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

/**
 * Parses raw document bytes into plain text using LangChain document loaders.
 * Supports PDF, DOCX/DOC, and plain text.
 */
export async function parseDocument(content: Buffer, contentType: string): Promise<string> {
  const ext = resolveExtension(contentType);
  const tmpFile = join(tmpdir(), `rag_doc_${randomUUID()}${ext}`);

  try {
    await fs.writeFile(tmpFile, content);

    if (ext === '.pdf') {
      const { PDFLoader } = await import('@langchain/community/document_loaders/fs/pdf');
      const loader = new PDFLoader(tmpFile, { splitPages: false });
      const docs = await loader.load();
      return docs.map((d) => d.pageContent).join('\n\n');
    }

    if (ext === '.docx') {
      const { DocxLoader } = await import('@langchain/community/document_loaders/fs/docx');
      const loader = new DocxLoader(tmpFile);
      const docs = await loader.load();
      return docs.map((d) => d.pageContent).join('\n\n');
    }

    // Plain text / Markdown / CSV fallback
    return content.toString('utf-8');
  } finally {
    await fs.unlink(tmpFile).catch(() => undefined);
  }
}

function resolveExtension(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('pdf')) return '.pdf';
  if (ct.includes('wordprocessingml') || ct.includes('docx') || ct.includes('msword'))
    return '.docx';
  return '.txt';
}
