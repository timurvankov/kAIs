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
  traceContext: z.record(z.string(), z.string()).optional(),
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
  message: z.string().optional(),
});

// --- CompletionCheck ---

export const CompletionCheckTypeSchema = z.enum(['fileExists', 'command', 'coverage', 'natsResponse']);

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
  /** NATS subject to subscribe to for natsResponse checks. */
  subject: z.string().optional(),
  /** Timeout in seconds for natsResponse checks (default: 30). */
  timeoutSeconds: z.number().positive().optional(),
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
  traceContext: z.record(z.string(), z.string()).optional(),
});

// --- Experiment ---

export const ExperimentVariableSchema = z.object({
  name: z.string().min(1),
  values: z.array(z.unknown()).min(1),
});

export const ExperimentMetricTypeSchema = z.enum([
  'duration',
  'sum',
  'count',
  'boolean',
  'llm_judge',
]);

export const ExperimentLLMJudgeSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'ollama']),
  model: z.string().min(1),
  prompt: z.string().min(1),
});

export const ExperimentMetricSchema = z.object({
  name: z.string().min(1),
  type: ExperimentMetricTypeSchema,
  description: z.string().optional(),
  source: z.string().optional(),
  judge: ExperimentLLMJudgeSchema.optional(),
}).refine(data => data.type !== 'llm_judge' || data.judge !== undefined, {
  message: 'llm_judge metric requires judge configuration',
});

export const ExperimentRuntimeSchema = z.enum(['in-process', 'kubernetes']);

export const ExperimentBudgetSchema = z.object({
  maxTotalCost: z.number().positive(),
  abortOnOverBudget: z.boolean().default(true),
});

export const ExperimentMissionSchema = z.object({
  objective: z.string().min(1),
  completion: MissionCompletionSchema,
});

export const ExperimentSpecSchema = z.object({
  variables: z.array(ExperimentVariableSchema).min(1),
  repeats: z.number().int().positive().default(3),
  template: z.object({
    kind: z.literal('Formation'),
    spec: z.unknown(),
  }),
  mission: ExperimentMissionSchema,
  metrics: z.array(ExperimentMetricSchema).min(1),
  runtime: ExperimentRuntimeSchema.default('in-process'),
  budget: ExperimentBudgetSchema,
  parallel: z.number().int().positive().default(1),
});

// --- ExperimentStatus ---

export const ExperimentPhaseSchema = z.enum([
  'Pending',
  'Running',
  'Analyzing',
  'Completed',
  'Failed',
  'Aborted',
]);

export const ExperimentRunStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
]);

export const ExperimentRunSchema = z.object({
  id: z.string().min(1),
  variables: z.record(z.string(), z.unknown()),
  repeat: z.number().int().positive(),
  phase: ExperimentRunStatusSchema,
  cost: z.number().nonnegative().optional(),
});

export const ExperimentStatusSchema = z.object({
  phase: ExperimentPhaseSchema,
  totalRuns: z.number().int().nonnegative(),
  completedRuns: z.number().int().nonnegative(),
  failedRuns: z.number().int().nonnegative(),
  estimatedCost: z.number().nonnegative().optional(),
  actualCost: z.number().nonnegative(),
  estimatedTimeRemaining: z.string().optional(),
  currentRuns: z.array(ExperimentRunSchema).optional(),
  analysis: z.unknown().optional(),
  message: z.string().optional(),
  suggestions: z.array(z.string()).optional(),
});

// --- Knowledge ---

export const KnowledgeScopeLevelSchema = z.enum([
  'platform',
  'realm',
  'formation',
  'cell',
]);

export const KnowledgeScopeSchema = z.object({
  level: KnowledgeScopeLevelSchema,
  realmId: z.string().optional(),
  formationId: z.string().optional(),
  cellId: z.string().optional(),
});

export const FactSourceTypeSchema = z.enum([
  'mission_extraction',
  'experiment',
  'user_input',
  'promoted',
  'explicit_remember',
]);

export const FactSourceSchema = z.object({
  type: FactSourceTypeSchema,
  missionId: z.string().optional(),
  experimentId: z.string().optional(),
  missionResult: z.string().optional(),
  fromFactId: z.string().optional(),
});

export const FactSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  embedding: z.array(z.number()).optional(),
  scope: KnowledgeScopeSchema,
  source: FactSourceSchema,
  confidence: z.number().min(0).max(1),
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime().optional(),
  tags: z.array(z.string()),
});

export const SearchOptionsSchema = z.object({
  maxResults: z.number().int().positive().default(20),
  minConfidence: z.number().min(0).max(1).default(0),
  includeInvalidated: z.boolean().default(false),
  semantic: z.boolean().default(true),
  recency: z.enum(['prefer_recent', 'prefer_established', 'any']).default('any'),
});

// --- KnowledgeGraph CRD ---

export const KnowledgeGraphPhaseSchema = z.enum(['Pending', 'Provisioning', 'Ready', 'Error']);

export const KnowledgeGraphRetentionSchema = z.object({
  maxFacts: z.number().int().positive(),
  ttlDays: z.number().int().positive(),
});

export const KnowledgeGraphResourcesSchema = z.object({
  memory: z.string(),
  cpu: z.string(),
  storage: z.string().optional(),
});

export const KnowledgeGraphSpecSchema = z.object({
  scope: KnowledgeScopeSchema,
  parentRef: z.string().optional(),
  dedicated: z.boolean().default(false),
  inherit: z.boolean().default(true),
  retention: KnowledgeGraphRetentionSchema.optional(),
  resources: KnowledgeGraphResourcesSchema.optional(),
});

export const KnowledgeGraphStatusSchema = z.object({
  phase: KnowledgeGraphPhaseSchema,
  endpoint: z.string().optional(),
  database: z.string().optional(),
  factCount: z.number().int().optional(),
  parentChain: z.array(z.string()).optional(),
  lastSyncedAt: z.string().optional(),
});

// --- Blueprint ---

export const BlueprintParameterTypeSchema = z.enum([
  'string',
  'integer',
  'number',
  'boolean',
  'enum',
]);

export const BlueprintParameterSchema = z.object({
  name: z.string().min(1),
  type: BlueprintParameterTypeSchema,
  default: z.unknown().optional(),
  description: z.string().optional(),
  values: z.array(z.unknown()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const BlueprintEvidenceSchema = z.object({
  experiments: z.array(z.object({
    name: z.string(),
    finding: z.string(),
  })).optional(),
  successRate: z.number().min(0).max(1).optional(),
  avgCompletionTime: z.number().nonnegative().optional(),
  avgCost: z.number().nonnegative().optional(),
});

export const BlueprintSpecSchema = z.object({
  description: z.string().optional(),
  parameters: z.array(BlueprintParameterSchema),
  formation: z.unknown(),
  mission: z.unknown().optional(),
  evidence: BlueprintEvidenceSchema.optional(),
});

export const BlueprintVersionSchema = z.object({
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  changes: z.string().optional(),
});

export const BlueprintStatusSchema = z.object({
  usageCount: z.number().int().nonnegative().default(0),
  lastUsed: z.string().datetime().optional(),
  avgSuccessRate: z.number().min(0).max(1).optional(),
  versions: z.array(BlueprintVersionSchema).optional(),
});

// ========== Phase 6: Evolution ==========

export const EvolutionSelectionSchema = z.enum(['tournament', 'roulette', 'rank']);

export const EvolutionCrossoverSchema = z.enum(['uniform', 'single_point', 'two_point']);

export const EvolutionMutationSchema = z.object({
  rate: z.number().min(0).max(1),
  perGene: z.boolean().default(true),
});

export const EvolutionStoppingSchema = z.object({
  maxGenerations: z.number().int().positive(),
  stagnationLimit: z.number().int().positive().optional(),
  fitnessThreshold: z.number().optional(),
  budgetLimit: z.number().positive().optional(),
});

export const EvolutionSpecSchema = z.object({
  populationSize: z.number().int().positive().min(2),
  selection: EvolutionSelectionSchema.default('tournament'),
  crossover: EvolutionCrossoverSchema.default('uniform'),
  mutation: EvolutionMutationSchema,
  elitism: z.number().int().nonnegative().default(1),
  stopping: EvolutionStoppingSchema,
  genes: z.array(z.object({
    name: z.string().min(1),
    type: z.enum(['enum', 'numeric', 'string']),
    values: z.array(z.unknown()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })).min(1),
  fitness: z.object({
    metrics: z.array(z.string().min(1)).min(1),
    weights: z.record(z.string(), z.number()).optional(),
  }),
  template: z.object({
    kind: z.literal('Formation'),
    spec: z.unknown(),
  }),
  mission: ExperimentMissionSchema,
  runtime: ExperimentRuntimeSchema.default('in-process'),
  budget: ExperimentBudgetSchema,
  parallel: z.number().int().positive().default(1),
});

export const EvolutionPhaseSchema = z.enum([
  'Pending', 'Running', 'Analyzing', 'Completed', 'Failed', 'Aborted',
]);

export const EvolutionIndividualSchema = z.object({
  id: z.string().min(1),
  genes: z.record(z.string(), z.unknown()),
  fitness: z.number().optional(),
  generation: z.number().int().nonnegative(),
});

export const EvolutionStatusSchema = z.object({
  phase: EvolutionPhaseSchema,
  generation: z.number().int().nonnegative(),
  bestFitness: z.number().optional(),
  bestIndividual: EvolutionIndividualSchema.optional(),
  populationSize: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  geneImportance: z.record(z.string(), z.number()).optional(),
  message: z.string().optional(),
});

// ========== Phase 6: Swarm ==========

export const SwarmTriggerTypeSchema = z.enum([
  'queue_depth', 'metric', 'budget_efficiency', 'schedule',
]);

export const SwarmTriggerSchema = z.object({
  type: SwarmTriggerTypeSchema,
  threshold: z.number().optional(),
  metricName: z.string().optional(),
  schedule: z.string().optional(),
  above: z.number().optional(),
  below: z.number().optional(),
});

export const SwarmScalingSchema = z.object({
  minReplicas: z.number().int().nonnegative().default(0),
  maxReplicas: z.number().int().positive(),
  step: z.number().int().positive().default(1),
  cooldownSeconds: z.number().int().positive().default(60),
  stabilizationSeconds: z.number().int().positive().default(120),
});

export const SwarmSpecSchema = z.object({
  cellTemplate: z.string().min(1),
  formationRef: z.string().min(1),
  trigger: SwarmTriggerSchema,
  scaling: SwarmScalingSchema,
  budget: z.object({
    maxCostPerHour: z.number().positive().optional(),
  }).optional(),
  drainGracePeriodSeconds: z.number().int().positive().default(30),
});

export const SwarmPhaseSchema = z.enum(['Active', 'Suspended', 'Error']);

export const SwarmStatusSchema = z.object({
  phase: SwarmPhaseSchema,
  currentReplicas: z.number().int().nonnegative(),
  desiredReplicas: z.number().int().nonnegative(),
  lastScaleTime: z.string().datetime().optional(),
  lastTriggerValue: z.number().optional(),
  message: z.string().optional(),
});

// ========== Phase 6: Adaptation ==========

export const CollectiveImmunityEntrySchema = z.object({
  fingerprint: z.string().min(1),
  solution: z.string().min(1),
  contributor: z.string().min(1),
  confidence: z.number().min(0).max(1),
  hits: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
});

export const NeuroplasticityEntrySchema = z.object({
  toolName: z.string().min(1),
  usageCount: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  lastUsed: z.string().datetime().optional(),
  pruned: z.boolean().default(false),
});

export const EpigeneticConfigSchema = z.object({
  realm: z.string().min(1),
  modifiers: z.record(z.string(), z.unknown()),
  description: z.string().optional(),
});

export const TopologyAdaptationRuleSchema = z.object({
  fromCell: z.string().min(1),
  toCell: z.string().min(1),
  weight: z.number().min(0).max(1),
  messageCount: z.number().int().nonnegative(),
  avgLatencyMs: z.number().nonnegative(),
});

// ========== Phase 9: Channel ==========

export const ChannelSpecSchema = z.object({
  formations: z.array(z.string().min(1)).min(2),
  schema: z.unknown().optional(),
  maxMessageSize: z.number().int().positive().default(65536),
  retentionMinutes: z.number().int().positive().default(60),
});

export const ChannelPhaseSchema = z.enum(['Active', 'Paused', 'Error']);

export const ChannelStatusSchema = z.object({
  phase: ChannelPhaseSchema,
  messageCount: z.number().int().nonnegative().default(0),
  subscriberCount: z.number().int().nonnegative().default(0),
  lastMessageAt: z.string().datetime().optional(),
});

// ========== Phase 9: Federation ==========

export const FederationClusterSchema = z.object({
  name: z.string().min(1),
  endpoint: z.string().min(1),
  labels: z.record(z.string(), z.string()).optional(),
  capacity: z.object({
    maxCells: z.number().int().positive(),
    availableCells: z.number().int().nonnegative(),
  }).optional(),
  lastHeartbeat: z.string().datetime().optional(),
});

export const FederationSchedulingSchema = z.object({
  labelSelector: z.record(z.string(), z.string()).optional(),
  strategy: z.enum(['round_robin', 'least_loaded', 'label_match']).default('label_match'),
});

export const FederationSpecSchema = z.object({
  clusters: z.array(FederationClusterSchema).min(1),
  scheduling: FederationSchedulingSchema,
  natsLeafnodePort: z.number().int().positive().default(7422),
});

export const FederationPhaseSchema = z.enum(['Pending', 'Active', 'Degraded', 'Error']);

export const FederationStatusSchema = z.object({
  phase: FederationPhaseSchema,
  readyClusters: z.number().int().nonnegative(),
  totalClusters: z.number().int().nonnegative(),
  scheduledCells: z.number().int().nonnegative().default(0),
  message: z.string().optional(),
});

// ========== Phase 9: HumanCell ==========

export const HumanCellSpecSchema = z.object({
  notifications: z.object({
    slack: z.object({ webhookUrl: z.string() }).optional(),
    email: z.object({ to: z.string() }).optional(),
    dashboard: z.boolean().default(true),
  }),
  escalation: z.object({
    timeoutMinutes: z.number().int().positive().default(30),
    action: z.enum(['reminder', 'llm_fallback', 'skip']).default('reminder'),
    fallbackModel: z.string().optional(),
  }).optional(),
});

// ========== Phase 9: Marketplace ==========

export const MarketplaceBlueprintSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  author: z.string().min(1),
  blueprint: BlueprintSpecSchema,
  tags: z.array(z.string()),
  rating: z.number().min(0).max(5).optional(),
  downloads: z.number().int().nonnegative().default(0),
  publishedAt: z.string().datetime(),
});

// ========== Phase 9: A2A Gateway ==========

export const A2AAgentCardSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  url: z.string().min(1),
  skills: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    inputSchema: z.unknown().optional(),
  })),
  version: z.string().default('1.0.0'),
});
