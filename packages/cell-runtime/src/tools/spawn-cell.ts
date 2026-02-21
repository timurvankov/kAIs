/**
 * spawn_cell tool v2 — create a child Cell CRD via the K8s API.
 *
 * Phase 8 additions:
 * - canSpawnChildren: allow child to spawn its own children (ecosystem coordinator)
 * - blueprintRef: instantiate a registered Blueprint instead of defining inline
 * - maxDepth: limit how deep the child's subtree can go
 * - recursionValidator: optional external validation (depth, descendants, policy, budget)
 */
import type { CellSpec, RecursionSpec, SpawnValidationResult } from '@kais/core';
import { z } from 'zod';

import type { Tool } from './tool-executor.js';

export interface KubeClientLite {
  createCell(cell: CellResourceLite): Promise<void>;
}

export interface CellResourceLite {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    ownerReferences: Array<{
      apiVersion: string;
      kind: string;
      name: string;
      uid: string;
      controller: boolean;
      blockOwnerDeletion: boolean;
    }>;
  };
  spec: CellSpec;
}

/** Callback to validate spawn against recursion constraints. */
export type RecursionValidatorFn = (
  parentCellId: string,
  namespace: string,
  recursionSpec: RecursionSpec | undefined,
  input: { name: string; systemPrompt: string; budget?: number; blueprintRef?: string; canSpawnChildren?: boolean; maxDepth?: number },
) => Promise<SpawnValidationResult>;

export interface SpawnCellConfig {
  kubeClient: KubeClientLite;
  parentCellName: string;
  parentNamespace: string;
  parentUid: string;
  parentSpec: CellSpec;
  /** Parent's recursion config (from CRD). */
  parentRecursion?: RecursionSpec;
  remainingBudget: () => number;
  deductBudget: (amount: number) => void;
  /** Optional external recursion validator (checks depth, descendants, policy, platform limit). */
  recursionValidator?: RecursionValidatorFn;
}

export function createSpawnCellTool(config: SpawnCellConfig): Tool {
  return {
    name: 'spawn_cell',
    description: 'Spawn a child Cell. Can be a simple agent or ecosystem coordinator that spawns its own children.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Child cell name (will be prefixed with parent name)' },
        systemPrompt: { type: 'string', description: 'System prompt for the child cell' },
        model: { type: 'string', description: "LLM model (defaults to parent's model)" },
        provider: { type: 'string', description: "LLM provider (defaults to parent's provider)" },
        tools: { type: 'array', items: { type: 'string' }, description: 'Tools for the child' },
        budget: { type: 'number', description: 'Max cost (defaults to 10% of parent remaining)' },
        canSpawnChildren: {
          type: 'boolean',
          description: 'Allow this child to spawn its own children (ecosystem coordinator)',
        },
        blueprintRef: {
          type: 'string',
          description: 'Instantiate a registered Blueprint instead of defining inline',
        },
        maxDepth: {
          type: 'integer',
          description: 'How many levels deep the child subtree can go (default: 3)',
        },
      },
      required: ['name', 'systemPrompt'],
    },
    async execute(input: unknown): Promise<string> {
      const SpawnCellInput = z.object({
        name: z.string().min(1, '"name" must be a non-empty string'),
        systemPrompt: z.string().min(1, '"systemPrompt" must be a non-empty string'),
        model: z.string().optional(),
        provider: z.enum(['anthropic', 'openai', 'ollama']).optional(),
        tools: z.array(z.string()).optional(),
        budget: z.number().positive().optional(),
        canSpawnChildren: z.boolean().optional(),
        blueprintRef: z.string().optional(),
        maxDepth: z.number().int().positive().optional(),
      });
      const parsed = SpawnCellInput.parse(input);

      // 1. Compute child name
      const childName = `${config.parentCellName}-${parsed.name}`;

      // 2. Compute budget
      const remaining = config.remainingBudget();
      const childBudget = parsed.budget ?? remaining * 0.1;

      // 3. Validate budget
      if (childBudget <= 0) {
        throw new Error('Child budget must be greater than zero');
      }
      if (childBudget > remaining) {
        throw new Error(
          `Insufficient budget: requested $${childBudget.toFixed(4)} but only $${remaining.toFixed(4)} remaining`,
        );
      }

      // 4. Run recursion validation if validator is provided
      if (config.recursionValidator) {
        const validation = await config.recursionValidator(
          config.parentCellName,
          config.parentNamespace,
          config.parentRecursion,
          {
            name: parsed.name,
            systemPrompt: parsed.systemPrompt,
            budget: childBudget,
            blueprintRef: parsed.blueprintRef,
            canSpawnChildren: parsed.canSpawnChildren,
            maxDepth: parsed.maxDepth,
          },
        );

        if (!validation.allowed) {
          if (validation.pending) {
            return JSON.stringify({
              status: 'pending_approval',
              reason: validation.reason,
            });
          }
          throw new Error(`Spawn rejected: ${validation.reason}`);
        }
      }

      // 5. Build child CellSpec
      const childRecursion = parsed.canSpawnChildren
        ? {
            maxDepth: parsed.maxDepth ?? 3,
            maxDescendants: config.parentRecursion?.maxDescendants ?? 50,
            spawnPolicy: config.parentRecursion?.spawnPolicy ?? 'open' as const,
          }
        : undefined;

      const childSpec: CellSpec = {
        mind: {
          provider: parsed.provider ?? config.parentSpec.mind.provider,
          model: parsed.model ?? config.parentSpec.mind.model,
          systemPrompt: parsed.systemPrompt,
        },
        tools: parsed.tools?.map(name => ({ name })),
        resources: {
          maxTotalCost: childBudget,
        },
        parentRef: config.parentCellName,
      };

      // 6. Create Cell CRD with ownerReferences
      const cellResource: CellResourceLite = {
        apiVersion: 'kais.io/v1',
        kind: 'Cell',
        metadata: {
          name: childName,
          namespace: config.parentNamespace,
          ownerReferences: [
            {
              apiVersion: 'kais.io/v1',
              kind: 'Cell',
              name: config.parentCellName,
              uid: config.parentUid,
              controller: true,
              blockOwnerDeletion: true,
            },
          ],
        },
        spec: childSpec,
      };

      // Attach recursion config if child can spawn (as annotation for CRD)
      if (childRecursion) {
        (cellResource as unknown as Record<string, unknown>).recursion = childRecursion;
      }

      await config.kubeClient.createCell(cellResource);

      // 7. Deduct budget from parent (only after successful creation)
      config.deductBudget(childBudget);

      // 8. Return result
      return JSON.stringify({
        status: 'spawned',
        name: childName,
        budget: childBudget,
        canSpawnChildren: parsed.canSpawnChildren ?? false,
      });
    },
  };
}
