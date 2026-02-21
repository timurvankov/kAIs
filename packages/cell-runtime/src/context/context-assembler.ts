/**
 * ContextAssembler v2 — combines various sources into the final message array for Mind.think().
 *
 * v1 features (preserved):
 * - First message: system role with systemPrompt (+ injections appended)
 * - Remaining messages: working memory messages in order
 *
 * v2 additions (Phase 4):
 * - Token budget management — fits context within model's context window
 * - Knowledge injection with relevance scoring (higher score = higher priority)
 * - Source prioritization: system prompt > knowledge > recent messages > old messages
 * - Graceful truncation: oldest messages are dropped first
 */
import type { Message } from '@kais/mind';

/** Rough token estimate: ~4 chars per token (conservative). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** A knowledge fact with optional relevance score for prioritized injection. */
export interface KnowledgeFact {
  content: string;
  relevance?: number; // 0-1, higher = more relevant
}

export interface AssembleParams {
  systemPrompt: string;
  workingMemory: Message[];
  injections?: string[];

  // v2 fields (all optional for backward compat)
  /** Maximum token budget for the assembled context. If omitted, no truncation occurs. */
  maxTokens?: number;
  /** Knowledge facts to inject, sorted by relevance. */
  knowledge?: KnowledgeFact[];
  /** Self-model awareness text to inject into system prompt. */
  selfAwareness?: string;
}

export class ContextAssembler {
  /**
   * Build the full context for a think call.
   *
   * When maxTokens is provided, the assembler:
   * 1. Always includes the system prompt (never truncated)
   * 2. Injects knowledge facts by relevance score, fitting within budget
   * 3. Includes working memory from newest to oldest, truncating old messages if needed
   */
  assemble(params: AssembleParams): Message[] {
    const {
      systemPrompt,
      workingMemory,
      injections,
      maxTokens,
      knowledge,
      selfAwareness,
    } = params;

    // Build system prompt with optional sections
    let fullSystemPrompt = systemPrompt;

    // Inject self-awareness (v2)
    if (selfAwareness) {
      fullSystemPrompt += '\n\n## Self-Awareness\n' + selfAwareness;
    }

    // Inject knowledge facts sorted by relevance (v2)
    if (knowledge && knowledge.length > 0) {
      const sorted = [...knowledge].sort(
        (a, b) => (b.relevance ?? 0) - (a.relevance ?? 0),
      );

      if (maxTokens) {
        // Budget-aware: only inject facts that fit
        const budgetForKnowledge = Math.floor(maxTokens * 0.3); // Reserve up to 30% for knowledge
        let usedTokens = 0;
        const included: string[] = [];

        for (const fact of sorted) {
          const tokens = estimateTokens(fact.content);
          if (usedTokens + tokens > budgetForKnowledge) break;
          included.push(fact.content);
          usedTokens += tokens;
        }

        if (included.length > 0) {
          fullSystemPrompt +=
            '\n\n## Relevant Knowledge\n' + included.join('\n\n');
        }
      } else {
        // No budget: include all knowledge
        fullSystemPrompt +=
          '\n\n## Relevant Knowledge\n' +
          sorted.map((f) => f.content).join('\n\n');
      }
    }

    // Append legacy injections
    if (injections && injections.length > 0) {
      fullSystemPrompt += '\n\n---\n\n' + injections.join('\n\n---\n\n');
    }

    const systemMessage: Message = {
      role: 'system',
      content: fullSystemPrompt,
    };

    // No budget constraint: return everything
    if (!maxTokens) {
      return [systemMessage, ...workingMemory];
    }

    // Budget-aware assembly: system prompt always included
    const systemTokens = estimateTokens(fullSystemPrompt);
    let remainingBudget = maxTokens - systemTokens;

    if (remainingBudget <= 0) {
      // System prompt alone exceeds budget — return it anyway
      return [systemMessage];
    }

    // Include messages from newest to oldest (most recent context is most valuable)
    const includedMessages: Message[] = [];
    for (let i = workingMemory.length - 1; i >= 0; i--) {
      const msg = workingMemory[i]!;
      const tokens = estimateTokens(
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      );

      if (tokens > remainingBudget) break; // Can't fit any more
      includedMessages.unshift(msg); // Prepend to maintain order
      remainingBudget -= tokens;
    }

    return [systemMessage, ...includedMessages];
  }
}
