import type { z } from 'zod';

import type {
  CellPhaseSchema,
  CellSpecSchema,
  CellStatusSchema,
  CognitiveModulationSchema,
  EnvelopeSchema,
  EnvelopeTypeSchema,
  LocalBrainSchema,
  MindSpecSchema,
  ResourceSpecSchema,
  RetryStrategySchema,
  SelfModelSchema,
  ToolSpecSchema,
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
