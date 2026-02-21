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
  parentRef: z.string().optional(),
  formationRef: z.string().optional(),
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
}).refine(
  (data) => data.maxDelayMs >= data.baseDelayMs,
  { message: 'maxDelayMs must be >= baseDelayMs' },
);

// --- TopologySpec ---

export const TopologyRouteSchema = z.object({
  from: z.string().min(1),
  to: z.array(z.string().min(1)).min(1),
  protocol: z.string().optional(),
});

export const TopologyBroadcastSchema = z.object({
  enabled: z.boolean(),
  from: z.array(z.string().min(1)),
});

export const TopologyBlackboardSchema = z.object({
  decayMinutes: z.number().positive(),
});

export const TopologyTypeSchema = z.enum([
  'full_mesh',
  'hierarchy',
  'star',
  'ring',
  'stigmergy',
  'custom',
]);

export const TopologySpecSchema = z.object({
  type: TopologyTypeSchema,
  root: z.string().optional(),
  hub: z.string().optional(),
  routes: z.array(TopologyRouteSchema).optional(),
  broadcast: TopologyBroadcastSchema.optional(),
  blackboard: TopologyBlackboardSchema.optional(),
}).superRefine((data, ctx) => {
  if (data.type === 'hierarchy' && !data.root) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'hierarchy topology requires root',
      path: ['root'],
    });
  }
  if (data.type === 'star' && !data.hub) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'star topology requires hub',
      path: ['hub'],
    });
  }
  if (data.type === 'custom' && (!data.routes || data.routes.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'custom topology requires routes',
      path: ['routes'],
    });
  }
  if (data.type === 'stigmergy' && !data.blackboard) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'stigmergy topology requires blackboard',
      path: ['blackboard'],
    });
  }
});

// --- FormationBudget ---

export const FormationBudgetSchema = z.object({
  maxTotalCost: z.number().positive().optional(),
  maxCostPerHour: z.number().positive().optional(),
  allocation: z.record(z.string(), z.string()).optional(),
});

// --- CellTemplate (for Formation) ---

export const CellTemplateSchema = z.object({
  name: z.string().min(1),
  replicas: z.number().int().positive().default(1),
  spec: CellSpecSchema,
});

// --- FormationSpec ---

export const FormationSpecSchema = z.object({
  cells: z.array(CellTemplateSchema).min(1),
  topology: TopologySpecSchema,
  budget: FormationBudgetSchema.optional(),
});

// --- FormationStatus ---

export const FormationPhaseSchema = z.enum(['Pending', 'Running', 'Paused', 'Completed', 'Failed']);

export const FormationCellStatusSchema = z.object({
  name: z.string().min(1),
  phase: CellPhaseSchema,
  cost: z.number().nonnegative(),
});

export const FormationStatusSchema = z.object({
  phase: FormationPhaseSchema,
  readyCells: z.number().int().nonnegative(),
  totalCells: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  cells: z.array(FormationCellStatusSchema).optional(),
});

// --- CompletionCheck ---

export const CompletionCheckTypeSchema = z.enum(['fileExists', 'command', 'coverage']);

export const CompletionCheckSchema = z.object({
  name: z.string().min(1),
  type: CompletionCheckTypeSchema,
  paths: z.array(z.string()).optional(),
  command: z.string().optional(),
  successPattern: z.string().optional(),
  failPattern: z.string().optional(),
  jsonPath: z.string().optional(),
  operator: z.string().optional(),
  value: z.number().optional(),
});

// --- MissionReview ---

export const MissionReviewSpecSchema = z.object({
  enabled: z.boolean(),
  reviewer: z.string().min(1),
  criteria: z.string().min(1),
});

// --- MissionCompletion ---

export const MissionCompletionSchema = z.object({
  checks: z.array(CompletionCheckSchema).min(1),
  review: MissionReviewSpecSchema.optional(),
  maxAttempts: z.number().int().positive().default(3),
  timeout: z.string().min(1),
});

// --- MissionEntrypoint ---

export const MissionEntrypointSchema = z.object({
  cell: z.string().min(1),
  message: z.string().min(1),
});

// --- MissionBudget ---

export const MissionBudgetSchema = z.object({
  maxCost: z.number().positive(),
});

// --- MissionSpec ---

export const MissionSpecSchema = z.object({
  formationRef: z.string().optional(),
  cellRef: z.string().optional(),
  objective: z.string().min(1),
  completion: MissionCompletionSchema,
  entrypoint: MissionEntrypointSchema,
  budget: MissionBudgetSchema.optional(),
}).refine(data => data.formationRef !== undefined || data.cellRef !== undefined, {
  message: 'At least one of formationRef or cellRef must be provided',
});

// --- MissionStatus ---

export const MissionPhaseSchema = z.enum(['Pending', 'Running', 'Succeeded', 'Failed']);

export const MissionCheckStatusSchema = z.enum(['Pending', 'Passed', 'Failed', 'Error']);

export const MissionCheckResultSchema = z.object({
  name: z.string().min(1),
  status: MissionCheckStatusSchema,
});

export const MissionReviewStatusSchema = z.object({
  status: z.enum(['Pending', 'Approved', 'Rejected']),
  feedback: z.string().optional(),
});

export const MissionHistoryEntrySchema = z.object({
  attempt: z.number().int().positive(),
  startedAt: z.string().datetime(),
  result: z.string().min(1),
});

export const MissionStatusSchema = z.object({
  phase: MissionPhaseSchema,
  attempt: z.number().int().nonnegative(),
  startedAt: z.string().datetime().optional(),
  cost: z.number().nonnegative(),
  checks: z.array(MissionCheckResultSchema).optional(),
  review: MissionReviewStatusSchema.optional(),
  history: z.array(MissionHistoryEntrySchema).optional(),
  message: z.string().optional(),
});
