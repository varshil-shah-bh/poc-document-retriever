import { Chroma } from '@langchain/community/vectorstores/chroma';
import { OpenAIEmbeddings } from '@langchain/openai';
import { config } from '../config/env';

let _embeddings: OpenAIEmbeddings | null = null;
let _vectorStore: Chroma | null = null;

export function getEmbeddings(): OpenAIEmbeddings {
  if (!_embeddings) {
    _embeddings = new OpenAIEmbeddings({
      openAIApiKey: config.OPENAI_API_KEY,
      modelName: config.EMBEDDING_MODEL,
    });
  }
  return _embeddings;
}

/**
 * Returns a singleton ChromaDB vector store connected to the configured collection.
 * The collection is created with cosine distance so similarity scores are in [0, 2]
 * (0 = identical, higher = less similar).
 */
export async function getVectorStore(): Promise<Chroma> {
  if (!_vectorStore) {
    _vectorStore = new Chroma(getEmbeddings(), {
      collectionName: config.CHROMA_COLLECTION,
      url: config.CHROMA_URL,
      collectionMetadata: { 'hnsw:space': 'cosine' },
    });
  }
  return _vectorStore;
}
