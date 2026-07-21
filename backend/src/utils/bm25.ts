/**
 * Lightweight BM25 scorer and Reciprocal Rank Fusion (RRF) helper.
 * Used at query-time to re-rank documents retrieved by vector similarity search.
 */

export class BM25 {
  private readonly k1 = 1.5;
  private readonly b = 0.75;
  private readonly tokenizedDocs: string[][];
  private readonly idf: Map<string, number>;
  private readonly avgDocLength: number;

  constructor(documents: string[]) {
    this.tokenizedDocs = documents.map((d) => BM25.tokenize(d));
    const total = this.tokenizedDocs.reduce((s, d) => s + d.length, 0);
    this.avgDocLength = this.tokenizedDocs.length ? total / this.tokenizedDocs.length : 1;
    this.idf = this.computeIDF();
  }

  private static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  private computeIDF(): Map<string, number> {
    const df = new Map<string, number>();
    for (const doc of this.tokenizedDocs) {
      for (const term of new Set(doc)) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }
    const N = this.tokenizedDocs.length;
    const idf = new Map<string, number>();
    for (const [term, freq] of df) {
      idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
    }
    return idf;
  }

  /** Returns a BM25 score per document (higher = more relevant). */
  score(query: string): number[] {
    const queryTerms = BM25.tokenize(query);
    return this.tokenizedDocs.map((doc) => {
      const docLength = doc.length;
      const tf = new Map<string, number>();
      for (const term of doc) tf.set(term, (tf.get(term) ?? 0) + 1);

      return queryTerms.reduce((score, term) => {
        const termTf = tf.get(term) ?? 0;
        const termIdf = this.idf.get(term) ?? 0;
        const num = termTf * (this.k1 + 1);
        const denom =
          termTf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));
        return score + termIdf * (num / denom);
      }, 0);
    });
  }
}

/**
 * Reciprocal Rank Fusion over two ranked index lists.
 *
 * @param similarityRanks - document indices sorted by vector similarity (best first)
 * @param bm25Ranks       - document indices sorted by BM25 score (best first)
 * @param k               - RRF constant (default 60)
 * @returns per-document RRF score array (higher = more relevant)
 */
export function rrfRerank(
  similarityRanks: number[],
  bm25Ranks: number[],
  k = 60,
): number[] {
  const n = similarityRanks.length;
  const scores = new Array<number>(n).fill(0);

  similarityRanks.forEach((docIdx, rank) => {
    scores[docIdx] += 1 / (k + rank + 1);
  });

  bm25Ranks.forEach((docIdx, rank) => {
    scores[docIdx] += 1 / (k + rank + 1);
  });

  return scores;
}
