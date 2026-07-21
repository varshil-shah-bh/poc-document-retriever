import { Injectable } from '@angular/core';

export type SseEvent =
  | { type: 'status'; message: string }
  | { type: 'chunk'; content: string }
  | { type: 'message'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly apiUrl = 'http://localhost:3000';

  /**
   * Sends a question to the RAG backend and yields SSE events as they arrive.
   * Uses native fetch + ReadableStream so POST bodies are supported (EventSource only allows GET).
   */
  async *streamChat(question: string): AsyncGenerator<SseEvent> {
    const response = await fetch(`${this.apiUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Server returned ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by double newline
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                yield JSON.parse(line.slice(6)) as SseEvent;
              } catch {
                // skip malformed JSON
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
