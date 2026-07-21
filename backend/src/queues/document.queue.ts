import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

/** Job submitted via the Alfresco route — worker downloads by nodeId */
export interface AlfrescoJobData {
  source: 'alfresco';
  nodeId: string;
  documentId?: string;
}

/** Job submitted via the direct-upload route — worker reads from a temp file */
export interface UploadJobData {
  source: 'upload';
  /** Absolute path to the temp file written by multer */
  filePath: string;
  contentType: string;
  filename: string;
  documentId?: string;
}

export type DocumentJobData = AlfrescoJobData | UploadJobData;

export interface DocumentJobResult {
  /** Identifies the processed document (nodeId for Alfresco, filename for uploads) */
  documentRef: string;
  chunksStored: number;
}

export const documentQueue = new Queue<DocumentJobData, DocumentJobResult>(
  'document-processing',
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  },
);
