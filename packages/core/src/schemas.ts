import { z } from 'zod';

// --- MindSpec ---

export const LocalBrainSchema = z.object({
  enabled: z.boolean(),
  provider: z.string(),
  model: z.string(),
  preThink: z.boolean(),
  postFilter: z.boolean(),
});

export const SelfModelSchema = z.object({
  enabled: z.boolean(),
});

export const CognitiveModulationSchema = z.object({
  enabled: z.boolean(),
});

export const WorkingMemorySchema = z.object({
  maxMessages: z.number().int().positive(),
  summarizeAfter: z.number().int().positive(),
});

export const MindSpecSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'ollama']),
  model: z.string().min(1),
  systemPrompt: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  localBrain: LocalBrainSchema.optional(),
  selfModel: SelfModelSchema.optional(),
  cognitiveModulation: CognitiveModulationSchema.optional(),
  workingMemory: WorkingMemorySchema.optional(),
});

// --- ToolSpec ---

export const ToolSpecSchema = z.object({
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
});

// --- ResourceSpec ---

export const ResourceSpecSchema = z.object({
  maxTokensPerTurn: z.number().int().positive().optional(),
  maxCostPerHour: z.number().positive().optional(),
  maxTotalCost: z.number().positive().optional(),
  cpuLimit: z.string().optional(),
  memoryLimit: z.string().optional(),
});

// --- CellSpec ---

export const CellSpecSchema = z.object({
  mind: MindSpecSchema,
  tools: z.array(ToolSpecSchema).optional(),
  resources: ResourceSpecSchema.optional(),
});

// --- CellStatus ---

export const CellPhaseSchema = z.enum(['Pending', 'Running', 'Completed', 'Failed', 'Paused']);

export const CellStatusSchema = z.object({
  phase: CellPhaseSchema,
  podName: z.string().optional(),
  totalCost: z.number().optional(),
  totalTokens: z.number().int().optional(),
  lastActive: z.string().datetime().optional(),
  message: z.string().optional(),
});

// --- Envelope ---

export const EnvelopeTypeSchema = z.enum(['message', 'tool_result', 'system', 'control']);

export const EnvelopeSchema = z.object({
  id: z.string().uuid(),
  from: z.string().min(1),
  to: z.string().min(1),
  type: EnvelopeTypeSchema,
  payload: z.unknown(),
  timestamp: z.string().datetime(),
  traceId: z.string().optional(),
  replyTo: z.string().optional(),
});

// --- RetryStrategy ---

export const RetryStrategySchema = z.object({
  maxRetries: z.number().int().nonnegative(),
  backoff: z.enum(['exponential', 'linear', 'constant']),
  baseDelayMs: z.number().int().positive(),
  maxDelayMs: z.number().int().positive(),
});
