import axios from 'axios';
import { config } from '../config/env';

export interface DocumentDownload {
  content: Buffer;
  contentType: string;
  filename: string;
}

const alfrescoClient = axios.create({
  baseURL: config.ALFRESCO_BASE_URL,
  auth: {
    username: config.ALFRESCO_USERNAME,
    password: config.ALFRESCO_PASSWORD,
  },
  timeout: 60_000,
});

/**
 * Downloads the raw content of an Alfresco node by its ID.
 * Uses the Alfresco Public REST API v1.
 */
export async function downloadDocument(nodeId: string): Promise<DocumentDownload> {
  const response = await alfrescoClient.get(
    `/alfresco/api/-default-/public/alfresco/versions/1/nodes/${nodeId}/content`,
    { responseType: 'arraybuffer', headers: { Accept: '*/*' } },
  );

  const contentType =
    (response.headers['content-type'] as string | undefined) ?? 'application/octet-stream';
  const contentDisposition =
    (response.headers['content-disposition'] as string | undefined) ?? '';
  const filenameMatch = contentDisposition.match(/filename[^;=\n]*=\s*(['"]?)([^;\n'"]+)\1/i);
  const filename = filenameMatch?.[2]?.trim() ?? `document_${nodeId}`;

  return {
    content: Buffer.from(response.data as ArrayBuffer),
    contentType,
    filename,
  };
}

/**
 * Retrieves node metadata (name, content type, size, etc.).
 */
export async function getNodeMetadata(nodeId: string): Promise<Record<string, unknown>> {
  const response = await alfrescoClient.get(
    `/alfresco/api/-default-/public/alfresco/versions/1/nodes/${nodeId}`,
  );
  return response.data as Record<string, unknown>;
}
