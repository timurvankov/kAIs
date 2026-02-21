import type { z } from 'zod';

import type {
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
} from './schemas.js';

export type LocalBrain = z.infer<typeof LocalBrainSchema>;
export type SelfModel = z.infer<typeof SelfModelSchema>;
export type CognitiveModulation = z.infer<typeof CognitiveModulationSchema>;
export type WorkingMemory = z.infer<typeof WorkingMemorySchema>;
export type MindSpec = z.infer<typeof MindSpecSchema>;
export type ToolSpec = z.infer<typeof ToolSpecSchema>;
export type ResourceSpec = z.infer<typeof ResourceSpecSchema>;
export type CellSpec = z.infer<typeof CellSpecSchema>;
export type CellPhase = z.infer<typeof CellPhaseSchema>;
export type CellStatus = z.infer<typeof CellStatusSchema>;
export type EnvelopeType = z.infer<typeof EnvelopeTypeSchema>;
export type Envelope = z.infer<typeof EnvelopeSchema>;
export type RetryStrategy = z.infer<typeof RetryStrategySchema>;

// Formation types
export type TopologyRoute = z.infer<typeof TopologyRouteSchema>;
export type TopologyBroadcast = z.infer<typeof TopologyBroadcastSchema>;
export type TopologyBlackboard = z.infer<typeof TopologyBlackboardSchema>;
export type TopologyType = z.infer<typeof TopologyTypeSchema>;
export type TopologySpec = z.infer<typeof TopologySpecSchema>;
export type FormationBudget = z.infer<typeof FormationBudgetSchema>;
export type CellTemplate = z.infer<typeof CellTemplateSchema>;
export type FormationSpec = z.infer<typeof FormationSpecSchema>;
export type FormationPhase = z.infer<typeof FormationPhaseSchema>;
export type FormationCellStatus = z.infer<typeof FormationCellStatusSchema>;
export type FormationStatus = z.infer<typeof FormationStatusSchema>;

// Mission types
export type CompletionCheckType = z.infer<typeof CompletionCheckTypeSchema>;
export type CompletionCheck = z.infer<typeof CompletionCheckSchema>;
export type MissionReviewSpec = z.infer<typeof MissionReviewSpecSchema>;
export type MissionCompletion = z.infer<typeof MissionCompletionSchema>;
export type MissionEntrypoint = z.infer<typeof MissionEntrypointSchema>;
export type MissionBudget = z.infer<typeof MissionBudgetSchema>;
export type MissionSpec = z.infer<typeof MissionSpecSchema>;
export type MissionPhase = z.infer<typeof MissionPhaseSchema>;
export type MissionCheckStatus = z.infer<typeof MissionCheckStatusSchema>;
export type MissionCheckResult = z.infer<typeof MissionCheckResultSchema>;
export type MissionReviewStatus = z.infer<typeof MissionReviewStatusSchema>;
export type MissionHistoryEntry = z.infer<typeof MissionHistoryEntrySchema>;
export type MissionStatus = z.infer<typeof MissionStatusSchema>;

// Experiment types
export type ExperimentVariable = z.infer<typeof ExperimentVariableSchema>;
export type ExperimentMetricType = z.infer<typeof ExperimentMetricTypeSchema>;
export type ExperimentLLMJudge = z.infer<typeof ExperimentLLMJudgeSchema>;
export type ExperimentMetric = z.infer<typeof ExperimentMetricSchema>;
export type ExperimentRuntime = z.infer<typeof ExperimentRuntimeSchema>;
export type ExperimentBudget = z.infer<typeof ExperimentBudgetSchema>;
export type ExperimentMission = z.infer<typeof ExperimentMissionSchema>;
export type ExperimentSpec = z.infer<typeof ExperimentSpecSchema>;
export type ExperimentPhase = z.infer<typeof ExperimentPhaseSchema>;
export type ExperimentRunStatus = z.infer<typeof ExperimentRunStatusSchema>;
export type ExperimentRun = z.infer<typeof ExperimentRunSchema>;
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;
