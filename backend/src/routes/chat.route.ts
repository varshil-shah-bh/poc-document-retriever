import { Router, Request, Response } from 'express';
import { streamRagResponse } from '../services/rag.service';

const router = Router();

/**
 * POST /api/chat
 *
 * Accepts a user question, runs the hybrid RAG pipeline, and streams the
 * response as Server-Sent Events (SSE).
 *
 * SSE event shapes (JSON-encoded in each `data:` line):
 *   { type: 'status',  message: string }   — pipeline status update
 *   { type: 'chunk',   content: string }   — incremental LLM token
 *   { type: 'message', content: string }   — complete message (e.g. no-info reply)
 *   { type: 'done' }                       — stream finished
 *   { type: 'error',   message: string }   — unexpected error
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { question } = req.body as { question?: string };

  if (!question || typeof question !== 'string' || !question.trim()) {
    res.status(400).json({ error: 'question is required.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering if behind proxy
  res.flushHeaders();

  const send = (data: object): void => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    for await (const event of streamRagResponse(question.trim())) {
      send(event);
      if (res.writableEnded) break; // Client disconnected
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unexpected error';
    console.error('[Chat Route] Error during RAG pipeline:', msg);
    send({ type: 'error', message: 'An error occurred while processing your request.' });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

export default router;
