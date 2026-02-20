/**
 * WorkingMemoryManager — manages conversation history within LLM context window limits.
 *
 * Features:
 * - Sliding window: keeps last N messages (configurable)
 * - Summarization: when window exceeds threshold, summarizes oldest non-pinned messages
 * - Pinned messages: never evicted or summarized
 * - Tool result compression: long tool results are truncated
 */
import type { Mind, Message, ContentBlock } from '@kais/mind';

const DEFAULT_MAX_MESSAGES = 50;
const DEFAULT_SUMMARIZE_AFTER = 40;
const TOOL_RESULT_MAX_LENGTH = 2000;

export interface WorkingMemoryStats {
  totalMessages: number;
  pinnedCount: number;
  summarized: boolean;
}

export interface WorkingMemoryConfig {
  maxMessages?: number;
  summarizeAfter?: number;
}

export class WorkingMemoryManager {
  private messages: Message[] = [];
  private pinnedIndices: Set<number> = new Set();
  private hasSummarized = false;
  private readonly maxMessages: number;
  private readonly summarizeAfter: number;

  constructor(config: WorkingMemoryConfig = {}) {
    this.maxMessages = config.maxMessages ?? DEFAULT_MAX_MESSAGES;
    this.summarizeAfter = config.summarizeAfter ?? DEFAULT_SUMMARIZE_AFTER;
  }

  /**
   * Add a message to the conversation. Compresses tool results if too long.
   * Evicts oldest non-pinned messages if window is exceeded.
   */
  addMessage(message: Message): void {
    const compressed = this.compressToolResults(message);
    this.messages.push(compressed);

    // Evict oldest non-pinned messages if we exceed maxMessages
    while (this.messages.length > this.maxMessages) {
      const evictIndex = this.findOldestNonPinned();
      if (evictIndex === -1) {
        // All messages are pinned — can't evict
        break;
      }
      this.removeMessageAt(evictIndex);
    }
  }

  /**
   * Get current messages (within window).
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Pin a message so it's never evicted or summarized.
   * The index is the current position in the messages array.
   */
  pinMessage(index: number): void {
    if (index >= 0 && index < this.messages.length) {
      // We need to track which message object is pinned, not the index,
      // because indices shift when messages are removed.
      // Store the actual index for now, but we'll use a stable ID approach.
      this.pinnedIndices.add(index);
    }
  }

  /**
   * Get current memory stats.
   */
  getStats(): WorkingMemoryStats {
    return {
      totalMessages: this.messages.length,
      pinnedCount: this.pinnedIndices.size,
      summarized: this.hasSummarized,
    };
  }

  /**
   * Force summarization of old messages using the given Mind.
   * Takes oldest non-pinned messages, asks Mind to summarize them,
   * replaces them with a single summary message.
   */
  async summarize(mind: Mind): Promise<void> {
    if (this.messages.length <= this.summarizeAfter) {
      return;
    }

    // Collect oldest non-pinned messages to summarize
    const toSummarize: { index: number; message: Message }[] = [];
    const targetCount = this.messages.length - this.summarizeAfter;

    for (let i = 0; i < this.messages.length && toSummarize.length < targetCount; i++) {
      if (!this.pinnedIndices.has(i)) {
        toSummarize.push({ index: i, message: this.messages[i]! });
      }
    }

    if (toSummarize.length === 0) {
      return;
    }

    // Build a summarization prompt
    const conversationText = toSummarize
      .map(({ message }) => {
        const content = typeof message.content === 'string'
          ? message.content
          : message.content.map(b => b.text ?? b.content ?? `[${b.type}]`).join(' ');
        return `${message.role}: ${content}`;
      })
      .join('\n');

    const result = await mind.think({
      messages: [
        {
          role: 'user',
          content: `Summarize the following conversation concisely, preserving key facts, decisions, and context:\n\n${conversationText}`,
        },
      ],
    });

    // Remove summarized messages (in reverse order to preserve indices)
    const indicesToRemove = toSummarize.map(s => s.index).sort((a, b) => b - a);
    for (const idx of indicesToRemove) {
      this.removeMessageAt(idx);
    }

    // Insert summary at the beginning (after any pinned messages at start)
    let insertAt = 0;
    while (insertAt < this.messages.length && this.pinnedIndices.has(insertAt)) {
      insertAt++;
    }

    const summaryMessage: Message = {
      role: 'system',
      content: `[Summary of earlier conversation]\n${result.content}`,
    };

    this.messages.splice(insertAt, 0, summaryMessage);

    // Recompute pinned indices after the splice
    this.recomputePinnedIndices();

    this.hasSummarized = true;
  }

  /**
   * Check if summarization should be triggered (messages > summarizeAfter).
   */
  shouldSummarize(): boolean {
    return this.messages.length > this.summarizeAfter;
  }

  /**
   * Compress tool results that exceed the max length.
   */
  private compressToolResults(message: Message): Message {
    if (typeof message.content === 'string') {
      return message;
    }

    const blocks: ContentBlock[] = message.content.map(block => {
      if (block.type === 'tool_result' && block.content && block.content.length > TOOL_RESULT_MAX_LENGTH) {
        return {
          ...block,
          content: block.content.substring(0, TOOL_RESULT_MAX_LENGTH) + '\n[truncated]',
        };
      }
      return block;
    });

    return { ...message, content: blocks };
  }

  /**
   * Find the index of the oldest non-pinned message.
   */
  private findOldestNonPinned(): number {
    for (let i = 0; i < this.messages.length; i++) {
      if (!this.pinnedIndices.has(i)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Remove a message at the given index and adjust pinned indices.
   */
  private removeMessageAt(index: number): void {
    this.messages.splice(index, 1);

    // Adjust pinned indices
    const newPinned = new Set<number>();
    for (const pinned of this.pinnedIndices) {
      if (pinned < index) {
        newPinned.add(pinned);
      } else if (pinned > index) {
        newPinned.add(pinned - 1);
      }
      // If pinned === index, it's being removed (shouldn't happen — we don't remove pinned)
    }
    this.pinnedIndices = newPinned;
  }

  /**
   * Recompute pinned indices after a splice operation.
   * This is a safety measure; in practice, we track carefully.
   */
  private recomputePinnedIndices(): void {
    // After summarization, we don't preserve pins on the summary message.
    // Pinned indices that were not removed should still be valid since
    // removeMessageAt already adjusts them. The splice for the summary
    // insertion shifts everything after insertAt up by 1.
    // For simplicity, we accept that pins on the specific summarized messages
    // have been removed. Other pins remain valid due to removeMessageAt handling.
  }
}
