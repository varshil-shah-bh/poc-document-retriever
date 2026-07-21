import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { Document } from '@langchain/core/documents';
import { getVectorStore } from './chroma.service';
import { BM25, rrfRerank } from '../utils/bm25';
import { config } from '../config/env';

export type SseEvent =
  | { type: 'status'; message: string }
  | { type: 'chunk'; content: string }
  | { type: 'message'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

const SYSTEM_PROMPT = `You are a helpful assistant that answers questions strictly based on the provided document context.
- Only use information present in the context below.
- If the context does not contain enough information, say exactly: "No relevant information found in the knowledge base."
- Be concise and factual.

Context:
{context}`;

/**
 * Core RAG pipeline as an async generator that emits SSE-style events.
 *
 * Flow:
 *  1. ChromaDB cosine-similarity search (top SIMILARITY_TOP_K chunks)
 *  2. BM25 re-scoring on the same candidate set
 *  3. Reciprocal Rank Fusion (RRF) to merge both rankings
 *  4. Relevance gate: if best cosine distance > RELEVANCE_THRESHOLD → no-info reply
 *  5. Stream LLM response token by token
 */
export async function* streamRagResponse(question: string): AsyncGenerator<SseEvent> {
  yield { type: 'status', message: 'Searching vector embeddings…' };

  const vectorStore = await getVectorStore();

  // ── 1. Vector similarity search ──────────────────────────────────────────
  let candidates: Array<[Document, number]>;
  try {
    candidates = await vectorStore.similaritySearchWithScore(question, config.SIMILARITY_TOP_K);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Empty collection or ChromaDB unavailable
    console.error('[RAG] ChromaDB query failed:', msg);
    yield {
      type: 'message',
      content: 'No documents have been indexed yet. Please ingest some documents first.',
    };
    return;
  }

  if (!candidates.length) {
    yield {
      type: 'message',
      content: 'No relevant information found in the knowledge base.',
    };
    return;
  }

  // ── 2. Relevance gate (cosine distance threshold) ────────────────────────
  // ChromaDB returns distance (not similarity): 0 = identical, 2 = opposite.
  // We only continue if at least the best result is within the threshold.
  const bestDistance = candidates[0][1];
  if (bestDistance > config.RELEVANCE_THRESHOLD) {
    yield {
      type: 'message',
      content: 'No relevant information found in the knowledge base.',
    };
    return;
  }

  // ── 3. BM25 re-scoring ───────────────────────────────────────────────────
  const texts = candidates.map(([doc]) => doc.pageContent);
  const bm25 = new BM25(texts);
  const bm25Scores = bm25.score(question);

  // similarity ranks: 0 … N-1 (already sorted best-first by ChromaDB)
  const similarityRanks = candidates.map((_, i) => i);

  // bm25 ranks: sort indices by descending BM25 score
  const bm25Ranks = bm25Scores
    .map((score, i) => ({ score, i }))
    .sort((a, b) => b.score - a.score)
    .map(({ i }) => i);

  // ── 4. RRF merge + take top-K context chunks ─────────────────────────────
  const rrfScores = rrfRerank(similarityRanks, bm25Ranks);
  const topIndices = rrfScores
    .map((score, i) => ({ score, i }))
    .sort((a, b) => b.score - a.score)
    .slice(0, config.CONTEXT_TOP_K)
    .map(({ i }) => i);

  const contextDocs = topIndices.map((i) => candidates[i][0]);
  const context = contextDocs
    .map((d, i) => `[${i + 1}] ${d.pageContent.trim()}`)
    .join('\n\n---\n\n');

  yield { type: 'status', message: 'Generating response…' };

  // ── 5. Stream LLM response ───────────────────────────────────────────────
  const llm = new ChatOpenAI({
    openAIApiKey: config.OPENAI_API_KEY,
    modelName: config.LLM_MODEL,
    streaming: true,
    temperature: 0.1,
  });

  const stream = await llm.stream([
    new SystemMessage(SYSTEM_PROMPT.replace('{context}', context)),
    new HumanMessage(question),
  ]);

  for await (const chunk of stream) {
    const text = typeof chunk.content === 'string' ? chunk.content : '';
    if (text) {
      yield { type: 'chunk', content: text };
    }
  }

  yield { type: 'done' };
}
