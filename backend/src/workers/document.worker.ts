/**
 * Document processing worker.
 * Run with:  pnpm worker  (or  npx tsx src/workers/document.worker.ts)
 *
 * Handles two job sources:
 *  • 'alfresco' — downloads the document from Alfresco Content Services by nodeId
 *  • 'upload'   — reads from a temp file written by the direct-upload route
 *
 * Common steps for both:
 *  1. Obtain raw bytes + content-type
 *  2. Parse to plain text (PDF / DOCX / TXT)
 *  3. Paragraph-aware chunking (RecursiveCharacterTextSplitter)
 *  4. Create embeddings and persist to ChromaDB
 */

import { promises as fs } from 'fs';
import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis';
import { documentQueue, type DocumentJobData, type DocumentJobResult } from '../queues/document.queue';
import { downloadDocument } from '../services/alfresco.service';
import { parseDocument } from '../utils/document-parser';
import { getVectorStore } from '../services/chroma.service';

async function processDocument(
  job: { data: DocumentJobData; updateProgress: (p: number) => Promise<void> },
): Promise<DocumentJobResult> {
  // ── Step 1: Obtain raw content ───────────────────────────────────────────
  await job.updateProgress(10);

  let content: Buffer;
  let contentType: string;
  let filename: string;
  let documentRef: string;

  if (job.data.source === 'alfresco') {
    const { nodeId, documentId } = job.data;
    documentRef = nodeId;
    console.log(`[Worker] Alfresco job — nodeId=${nodeId}`);
    const result = await downloadDocument(nodeId);
    content = result.content;
    contentType = result.contentType;
    filename = result.filename;
    console.log(`[Worker] Downloaded "${filename}" (${contentType}, ${content.length} bytes)`);
  } else {
    const { filePath, contentType: ct, filename: fn, documentId } = job.data;
    documentRef = documentId ?? fn;
    console.log(`[Worker] Upload job — file=${fn}`);
    content = await fs.readFile(filePath);
    contentType = ct;
    filename = fn;
    console.log(`[Worker] Read "${filename}" from temp path (${content.length} bytes)`);
  }

  // ── Step 2: Parse document to plain text ─────────────────────────────────
  await job.updateProgress(30);
  const text = await parseDocument(content, contentType);
  console.log(`[Worker] Parsed text length: ${text.length} chars`);

  if (!text.trim()) {
    throw new Error(`Document "${documentRef}" produced empty text after parsing.`);
  }

  // ── Step 3: Semantic chunking ─────────────────────────────────────────────
  await job.updateProgress(50);

  // Paragraph-aware semantic chunking:
  // 1. Split on paragraph boundaries (double newlines)
  // 2. Merge short paragraphs into same chunk; split oversized ones by sentence
  const { RecursiveCharacterTextSplitter } = await import('@langchain/textsplitters');
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 800,
    chunkOverlap: 150,
    separators: ['\n\n', '\n', '. ', '! ', '? ', ' ', ''],
  });
  const metadata = { documentRef, documentId: (job.data.documentId ?? documentRef), filename, processedAt: new Date().toISOString() };
  const chunks = await splitter.createDocuments([text], [metadata]);

  // ── Step 4: Store embeddings in ChromaDB ──────────────────────────────────
  await job.updateProgress(75);
  const vectorStore = await getVectorStore();
  await vectorStore.addDocuments(chunks);

  // ── Step 5: Cleanup temp file (upload jobs only) ──────────────────────────
  if (job.data.source === 'upload') {
    await fs.unlink(job.data.filePath).catch(() => undefined);
  }

  await job.updateProgress(100);
  console.log(`[Worker] Stored ${chunks.length} chunks for documentRef=${documentRef}`);
  return { documentRef, chunksStored: chunks.length };
}

// ── Worker registration ───────────────────────────────────────────────────────

const worker = new Worker<DocumentJobData, DocumentJobResult>(
  documentQueue.name,
  async (job) => processDocument({ data: job.data, updateProgress: job.updateProgress.bind(job) }),
  { connection: redisConnection, concurrency: 2 },
);

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed:`, job.returnvalue);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('[Worker] Worker error:', err.message);
});

console.log('[Worker] Document processing worker started. Waiting for jobs…');
