import { Router, Request, Response } from 'express';
import multer from 'multer';
import { join } from 'path';
import { tmpdir } from 'os';
import { documentQueue } from '../queues/document.queue';

const router = Router();

// ── Multer setup ──────────────────────────────────────────────────────────────
const upload = multer({
  dest: join(tmpdir(), 'rag-uploads'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    // Allow octet-stream — the parser uses magic bytes + filename extension to
    // detect the real type, so an incorrect Content-Type is not a problem here.
    const allowed = new Set([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/octet-stream', // generic binary — detected by magic bytes
      'text/plain',
      'text/markdown',
      'text/csv',
    ]);
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    const allowedExts = new Set(['pdf', 'docx', 'doc', 'txt', 'md', 'csv']);
    if (allowed.has(file.mimetype) || file.mimetype.startsWith('text/') || allowedExts.has(ext ?? '')) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Allowed: PDF, DOCX, DOC, TXT, MD, CSV.'));
    }
  },
});

/**
 * POST /api/documents/ingest
 *
 * Queues an Alfresco document for background processing.
 * Body: { nodeId: string, documentId?: string }
 *
 * Returns 202 Accepted with the BullMQ job ID so the caller can poll /jobs/:jobId.
 */
router.post('/ingest', async (req: Request, res: Response): Promise<void> => {
  const { nodeId, documentId } = req.body as { nodeId?: string; documentId?: string };

  if (!nodeId || typeof nodeId !== 'string' || !nodeId.trim()) {
    res.status(400).json({ error: 'nodeId is required and must be a non-empty string.' });
    return;
  }

  try {
    const job = await documentQueue.add(
      'ingest',
      { source: 'alfresco', nodeId: nodeId.trim(), documentId: documentId?.trim() },
      { jobId: `alfresco_${nodeId.trim()}_${Date.now()}` },
    );

    res.status(202).json({
      message: 'Document queued for processing.',
      jobId: job.id,
      nodeId: nodeId.trim(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Document Route] Failed to enqueue job:', msg);
    res.status(500).json({ error: 'Failed to queue the document for processing.' });
  }
});

/**
 * POST /api/documents/upload
 *
 * Accepts a direct file upload (multipart/form-data), saves it to a temp
 * directory, and queues a BullMQ job to parse + embed it.
 *
 * Form fields:
 *   file       (required) — the document binary (PDF, DOCX, TXT, MD, CSV)
 *   documentId (optional) — a human-readable label stored in chunk metadata
 *
 * Returns 202 Accepted with the job ID.
 */
router.post(
  '/upload',
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: 'A file must be uploaded in the "file" field.' });
      return;
    }

    const { documentId } = req.body as { documentId?: string };
    const { path: filePath, mimetype, originalname } = req.file;

    try {
      const job = await documentQueue.add(
        'ingest',
        {
          source: 'upload',
          filePath,
          contentType: mimetype,
          filename: originalname,
          documentId: documentId?.trim(),
        },
        { jobId: `upload_${originalname}_${Date.now()}` },
      );

      res.status(202).json({
        message: 'Document queued for processing.',
        jobId: job.id,
        filename: originalname,
        size: req.file.size,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Document Route] Failed to enqueue upload job:', msg);
      res.status(500).json({ error: 'Failed to queue the document for processing.' });
    }
  },
);

/**
 * GET /api/documents/jobs/:jobId
 *
 * Returns the current state and progress of a processing job.
 */
router.get('/jobs/:jobId', async (req: Request, res: Response): Promise<void> => {
  const { jobId } = req.params;

  try {
    const job = await documentQueue.getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }

    const state = await job.getState();

    res.json({
      jobId: job.id,
      state,
      progress: job.progress,
      data: job.data,
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Document Route] Failed to get job:', msg);
    res.status(500).json({ error: 'Failed to retrieve job status.' });
  }
});

export default router;
