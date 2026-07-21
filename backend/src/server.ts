import express from 'express';
import cors from 'cors';
import { config } from './config/env';
import documentRouter from './routes/document.route';
import chatRouter from './routes/chat.route';

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: ['http://localhost:4200', 'http://localhost:4201'],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
  }),
);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/documents', documentRouter);
app.use('/api/chat', chatRouter);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(config.PORT, () => {
  console.log(`[Server] Listening on http://localhost:${config.PORT}`);
  console.log(`[Server] ChromaDB: ${config.CHROMA_URL} | Collection: ${config.CHROMA_COLLECTION}`);
});
