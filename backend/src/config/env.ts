import 'dotenv/config';

export const config = {
  PORT: parseInt(process.env['PORT'] ?? '3000', 10),
  REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  CHROMA_URL: process.env['CHROMA_URL'] ?? 'http://localhost:8000',
  CHROMA_COLLECTION: process.env['CHROMA_COLLECTION'] ?? 'rag_documents',
  OPENAI_API_KEY: process.env['OPENAI_API_KEY'] ?? '',
  EMBEDDING_MODEL: process.env['EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
  LLM_MODEL: process.env['LLM_MODEL'] ?? 'gpt-4o-mini',
  ALFRESCO_BASE_URL: process.env['ALFRESCO_BASE_URL'] ?? 'http://localhost:8080',
  ALFRESCO_USERNAME: process.env['ALFRESCO_USERNAME'] ?? 'admin',
  ALFRESCO_PASSWORD: process.env['ALFRESCO_PASSWORD'] ?? 'admin',
  RELEVANCE_THRESHOLD: parseFloat(process.env['RELEVANCE_THRESHOLD'] ?? '0.7'),
  SIMILARITY_TOP_K: parseInt(process.env['SIMILARITY_TOP_K'] ?? '20', 10),
  CONTEXT_TOP_K: parseInt(process.env['CONTEXT_TOP_K'] ?? '5', 10),
} as const;
