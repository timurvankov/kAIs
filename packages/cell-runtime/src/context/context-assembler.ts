/**
 * ContextAssembler v1 — combines various sources into the final message array for Mind.think().
 *
 * v1 is simple:
 * - First message: system role with systemPrompt (+ injections appended)
 * - Remaining messages: working memory messages in order
 * - No token budget management (that's v2 in Phase 4)
 */
import type { Message } from '@kais/mind';

export interface AssembleParams {
  systemPrompt: string;
  workingMemory: Message[];
  injections?: string[];
}

export class ContextAssembler {
  /**
   * Build the full context for a think call.
   */
  assemble(params: AssembleParams): Message[] {
    const { systemPrompt, workingMemory, injections } = params;

    // Build system prompt with optional injections
    let fullSystemPrompt = systemPrompt;
    if (injections && injections.length > 0) {
      fullSystemPrompt += '\n\n---\n\n' + injections.join('\n\n---\n\n');
    }

    const messages: Message[] = [
      { role: 'system', content: fullSystemPrompt },
      ...workingMemory,
    ];

    return messages;
  }
}
