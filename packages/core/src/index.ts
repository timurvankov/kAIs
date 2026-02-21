// Zod schemas
export {
  CellPhaseSchema,
  CellSpecSchema,
  CellStatusSchema,
  CellTemplateSchema,
  CognitiveModulationSchema,
  CompletionCheckSchema,
  CompletionCheckTypeSchema,
  EnvelopeSchema,
  EnvelopeTypeSchema,
  ExperimentBudgetSchema,
  ExperimentLLMJudgeSchema,
  ExperimentMetricSchema,
  ExperimentMetricTypeSchema,
  ExperimentMissionSchema,
  ExperimentPhaseSchema,
  ExperimentRunSchema,
  ExperimentRunStatusSchema,
  ExperimentRuntimeSchema,
  ExperimentSpecSchema,
  ExperimentStatusSchema,
  ExperimentVariableSchema,
  FormationBudgetSchema,
  FormationCellStatusSchema,
  FormationPhaseSchema,
  FormationSpecSchema,
  FormationStatusSchema,
  LocalBrainSchema,
  MindSpecSchema,
  MissionBudgetSchema,
  MissionCheckResultSchema,
  MissionCheckStatusSchema,
  MissionCompletionSchema,
  MissionEntrypointSchema,
  MissionHistoryEntrySchema,
  MissionPhaseSchema,
  MissionReviewSpecSchema,
  MissionReviewStatusSchema,
  MissionSpecSchema,
  MissionStatusSchema,
  ResourceSpecSchema,
  RetryStrategySchema,
  SelfModelSchema,
  ToolSpecSchema,
  TopologyBlackboardSchema,
  TopologyBroadcastSchema,
  TopologyRouteSchema,
  TopologySpecSchema,
  TopologyTypeSchema,
  WorkingMemorySchema,
  // Knowledge schemas
  KnowledgeScopeLevelSchema,
  KnowledgeScopeSchema,
  FactSourceTypeSchema,
  FactSourceSchema,
  FactSchema,
  SearchOptionsSchema,
  // KnowledgeGraph schemas
  KnowledgeGraphPhaseSchema,
  KnowledgeGraphRetentionSchema,
  KnowledgeGraphResourcesSchema,
  KnowledgeGraphSpecSchema,
  KnowledgeGraphStatusSchema,
  // Blueprint schemas
  BlueprintParameterTypeSchema,
  BlueprintParameterSchema,
  BlueprintEvidenceSchema,
  BlueprintSpecSchema,
  BlueprintVersionSchema,
  BlueprintStatusSchema,
  // Phase 6: Evolution
  EvolutionSelectionSchema,
  EvolutionCrossoverSchema,
  EvolutionMutationSchema,
  EvolutionStoppingSchema,
  EvolutionSpecSchema,
  EvolutionPhaseSchema,
  EvolutionIndividualSchema,
  EvolutionStatusSchema,
  // Phase 6: Swarm
  SwarmTriggerTypeSchema,
  SwarmTriggerSchema,
  SwarmScalingSchema,
  SwarmSpecSchema,
  SwarmPhaseSchema,
  SwarmStatusSchema,
  // Phase 6: Adaptation
  CollectiveImmunityEntrySchema,
  NeuroplasticityEntrySchema,
  EpigeneticConfigSchema,
  TopologyAdaptationRuleSchema,
  // Phase 9: Channel
  ChannelSpecSchema,
  ChannelPhaseSchema,
  ChannelStatusSchema,
  // Phase 9: Federation
  FederationClusterSchema,
  FederationSchedulingSchema,
  FederationSpecSchema,
  FederationPhaseSchema,
  FederationStatusSchema,
  // Phase 9: HumanCell
  HumanCellSpecSchema,
  // Phase 9: Marketplace
  MarketplaceBlueprintSchema,
  // Phase 9: A2A
  A2AAgentCardSchema,
} from './schemas.js';

// TypeScript types (inferred from Zod)
export type {
  CellPhase,
  CellSpec,
  CellStatus,
  CellTemplate,
  CognitiveModulation,
  CompletionCheck,
  CompletionCheckType,
  Envelope,
  EnvelopeType,
  ExperimentBudget,
  ExperimentLLMJudge,
  ExperimentMetric,
  ExperimentMetricType,
  ExperimentMission,
  ExperimentPhase,
  ExperimentRun,
  ExperimentRunStatus,
  ExperimentRuntime,
  ExperimentSpec,
  ExperimentStatus,
  ExperimentVariable,
  FormationBudget,
  FormationCellStatus,
  FormationPhase,
  FormationSpec,
  FormationStatus,
  LocalBrain,
  MindSpec,
  MissionBudget,
  MissionCheckResult,
  MissionCheckStatus,
  MissionCompletion,
  MissionEntrypoint,
  MissionHistoryEntry,
  MissionPhase,
  MissionReviewSpec,
  MissionReviewStatus,
  MissionSpec,
  MissionStatus,
  ResourceSpec,
  RetryStrategy,
  SelfModel,
  ToolSpec,
  TopologyBlackboard,
  TopologyBroadcast,
  TopologyRoute,
  TopologySpec,
  TopologyType,
  WorkingMemory,
  // Knowledge types
  KnowledgeScopeLevel,
  KnowledgeScope,
  FactSourceType,
  FactSource,
  Fact,
  SearchOptions,
  // KnowledgeGraph types
  KnowledgeGraphPhase,
  KnowledgeGraphRetention,
  KnowledgeGraphResources,
  KnowledgeGraphSpec,
  KnowledgeGraphStatus,
  // Blueprint types
  BlueprintParameterType,
  BlueprintParameter,
  BlueprintEvidence,
  BlueprintSpec,
  BlueprintVersion,
  BlueprintStatus,
  // Phase 6
  EvolutionSelection,
  EvolutionCrossover,
  EvolutionMutation,
  EvolutionStopping,
  EvolutionSpec,
  EvolutionPhase,
  EvolutionIndividual,
  EvolutionStatus,
  SwarmTriggerType,
  SwarmTrigger,
  SwarmScaling,
  SwarmSpec,
  SwarmPhase,
  SwarmStatus,
  CollectiveImmunityEntry,
  NeuroplasticityEntry,
  EpigeneticConfig,
  TopologyAdaptationRule,
  // Phase 9
  ChannelSpec,
  ChannelPhase,
  ChannelStatus,
  FederationCluster,
  FederationScheduling,
  FederationSpec,
  FederationPhase,
  FederationStatus,
  HumanCellSpec,
  MarketplaceBlueprint,
  A2AAgentCard,
} from './types.js';

// Error model
export {
  BudgetError,
  KaisError,
  LLMError,
  ProtocolViolation,
  ToolError,
  TransientError,
} from './errors.js';

// Retry
export { withRetry } from './retry.js';

// Envelope helper
export { createEnvelope } from './envelope.js';

// Telemetry
export { initTelemetry, shutdownTelemetry, getTracer, getMeter } from './telemetry.js';
export type { Tracer, Meter } from '@opentelemetry/api';

// Logger
export { logger, createLogger } from './logger.js';
export type { Logger } from 'pino';

// Experiment analysis
export { analyzeExperiment } from './analysis.js';
export type {
  ExperimentAnalysis,
  MetricAnalysis,
  VariantStats,
  PairwiseComparison,
  ParetoPoint,
  RunDataPoint,
} from './analysis.js';

// In-Process Runtime
export { InMemoryBus, InProcessRuntime } from './runtime.js';
export type {
  CellRuntime,
  RunningCell,
  MessageBus,
  MessageHandler,
  Subscription,
} from './runtime.js';

// Knowledge store
export { InMemoryKnowledgeStore } from './knowledge.js';
export type { KnowledgeStore, ScopedKnowledgeStore, AddFactInput } from './knowledge.js';

// Protocol system
export {
  ProtocolSession,
  ProtocolEnforcer,
  CONTRACT_PROTOCOL,
  DELIBERATION_PROTOCOL,
  AUCTION_PROTOCOL,
} from './protocol.js';
export type {
  Protocol,
  ProtocolState,
  ProtocolTransition,
  ProtocolAction,
  ValidationResult,
} from './protocol.js';

// RBAC schemas
export {
  AuthConfigSchema,
  AuthUserSchema,
  RbacCheckRequestSchema,
  RbacCheckResultSchema,
  RbacResourceSchema,
  RbacRuleSchema,
  RbacVerbSchema,
  RoleBindingSchema,
  RoleSchema,
  RoleSpecSchema,
  StaticTokenEntrySchema,
} from './rbac-schemas.js';

// RBAC types
export type {
  AuthConfig,
  AuthUser,
  RbacCheckRequest,
  RbacCheckResult,
  RbacResource,
  RbacRule,
  RbacVerb,
  Role,
  RoleBinding,
  RoleSpec,
  StaticTokenEntry,
} from './rbac-types.js';

// Recursion / Budget / SpawnRequest schemas
export {
  BudgetBalanceSchema,
  BudgetLedgerEntrySchema,
  BudgetOperationSchema,
  CellTreeNodeSchema,
  RecursionSpecSchema,
  RequestedCellSpecSchema,
  SpawnPolicySchema,
  SpawnRequestPhaseSchema,
  SpawnRequestSchema,
  SpawnValidationResultSchema,
} from './recursion-schemas.js';

// Recursion / Budget / SpawnRequest types
export type {
  BudgetBalance,
  BudgetLedgerEntry,
  BudgetOperation,
  CellTreeNode,
  RecursionSpec,
  RequestedCellSpec,
  SpawnPolicy,
  SpawnRequest,
  SpawnRequestPhase,
  SpawnValidationResult,
} from './recursion-types.js';

// NATS Auth + Audit Log schemas
export {
  AuditActionSchema,
  AuditEntrySchema,
  NatsCredentialsSchema,
  NatsPermissionSchema,
} from './nats-auth-schemas.js';

// NATS Auth + Audit Log types
export type {
  AuditAction,
  AuditEntry,
  NatsCredentials,
  NatsPermission,
} from './nats-auth-types.js';

// Phase 6: Adaptation systems
export { CollectiveImmunityStore } from './collective-immunity.js';
export { NeuroplasticityTracker } from './neuroplasticity.js';
export { TopologyAdapter } from './topology-adaptation.js';
export { EpigeneticLayer } from './epigenetic.js';

// Phase 9: Services
export { HumanCellRuntime } from './human-cell.js';
export type { PendingMessage, HumanNotification } from './human-cell.js';
export { Marketplace } from './marketplace.js';
export { A2AGateway } from './a2a-gateway.js';
export type { A2ATask } from './a2a-gateway.js';
