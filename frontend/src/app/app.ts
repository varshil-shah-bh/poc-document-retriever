import {
  AfterViewChecked,
  Component,
  ElementRef,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { ChatService } from './services/chat.service';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements AfterViewChecked {
  @ViewChild('messagesContainer') private messagesContainer?: ElementRef<HTMLElement>;

  private readonly chatService = inject(ChatService);

  readonly messages = signal<ChatMessage[]>([]);
  readonly isLoading = signal(false);
  readonly loadingStatus = signal('');
  inputText = '';

  private shouldScroll = false;

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  private scrollToBottom(): void {
    const el = this.messagesContainer?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  onInput(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    this.inputText = el.value;
    // Auto-grow textarea
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 128) + 'px';
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  async sendMessage(): Promise<void> {
    const question = this.inputText.trim();
    if (!question || this.isLoading()) return;

    // Add user message
    this.messages.update((msgs) => [...msgs, { role: 'user', content: question }]);
    this.inputText = '';
    // Reset textarea height
    const ta = document.querySelector<HTMLTextAreaElement>('textarea');
    if (ta) ta.style.height = 'auto';

    this.isLoading.set(true);
    this.loadingStatus.set('Searching vector embeddings…');
    this.shouldScroll = true;

    // Placeholder for the AI reply
    const aiIndex = this.messages().length;
    this.messages.update((msgs) => [
      ...msgs,
      { role: 'assistant', content: '', streaming: true },
    ]);

    try {
      for await (const event of this.chatService.streamChat(question)) {
        switch (event.type) {
          case 'status':
            this.loadingStatus.set(event.message);
            break;

          case 'chunk':
            this.messages.update((msgs) => {
              const updated = [...msgs];
              updated[aiIndex] = {
                ...updated[aiIndex],
                content: updated[aiIndex].content + event.content,
                streaming: true,
              };
              return updated;
            });
            this.shouldScroll = true;
            break;

          case 'message':
            this.messages.update((msgs) => {
              const updated = [...msgs];
              updated[aiIndex] = { role: 'assistant', content: event.content, streaming: false };
              return updated;
            });
            break;

          case 'done':
            this.messages.update((msgs) => {
              const updated = [...msgs];
              updated[aiIndex] = { ...updated[aiIndex], streaming: false };
              return updated;
            });
            break;

          case 'error':
            this.messages.update((msgs) => {
              const updated = [...msgs];
              updated[aiIndex] = {
                role: 'assistant',
                content: event.message,
                streaming: false,
              };
              return updated;
            });
            break;
        }
      }
    } catch {
      this.messages.update((msgs) => {
        const updated = [...msgs];
        updated[aiIndex] = {
          role: 'assistant',
          content: 'Failed to connect to the server. Please try again.',
          streaming: false,
        };
        return updated;
      });
    } finally {
      this.isLoading.set(false);
      this.loadingStatus.set('');
      this.shouldScroll = true;
    }
  }
}
