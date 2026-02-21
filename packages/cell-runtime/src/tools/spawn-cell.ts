/**
 * spawn_cell tool — create a child Cell CRD via the K8s API.
 */
import type { CellSpec } from '@kais/core';
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

export interface SpawnCellConfig {
  kubeClient: KubeClientLite;
  parentCellName: string;
  parentNamespace: string;
  parentUid: string;
  parentSpec: CellSpec;
  remainingBudget: () => number;
  deductBudget: (amount: number) => void;
}

export function createSpawnCellTool(config: SpawnCellConfig): Tool {
  return {
    name: 'spawn_cell',
    description: 'Spawn a child Cell. The child will be owned by this Cell and share the budget.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Child cell name (will be prefixed with parent name)' },
        systemPrompt: { type: 'string', description: 'System prompt for the child cell' },
        model: { type: 'string', description: "LLM model (defaults to parent's model)" },
        provider: { type: 'string', description: "LLM provider (defaults to parent's provider)" },
        tools: { type: 'array', items: { type: 'string' }, description: 'Tools for the child' },
        budget: { type: 'number', description: 'Max cost (defaults to 10% of parent remaining)' },
      },
      required: ['name', 'systemPrompt'],
    },
    async execute(input: unknown): Promise<string> {
      const SpawnCellInput = z.object({
        name: z.string().min(1, '"name" must be a non-empty string'),
        systemPrompt: z.string().min(1, '"systemPrompt" must be a non-empty string'),
        model: z.string().optional(),
        provider: z.string().optional(),
        tools: z.array(z.string()).optional(),
        budget: z.number().positive().optional(),
      });
      const parsed = SpawnCellInput.parse(input);

      // 1. Compute child name
      const childName = `${config.parentCellName}-${parsed.name}`;

      // 2. Compute budget
      const remaining = config.remainingBudget();
      const childBudget = parsed.budget ?? remaining * 0.1;

      // 3. Validate budget
      if (childBudget > remaining) {
        throw new Error(
          `Insufficient budget: requested $${childBudget.toFixed(4)} but only $${remaining.toFixed(4)} remaining`,
        );
      }

      // 4. Deduct budget from parent
      config.deductBudget(childBudget);

      // 5. Build child CellSpec
      const childSpec: CellSpec = {
        mind: {
          provider: (parsed.provider ?? config.parentSpec.mind.provider) as CellSpec['mind']['provider'],
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
        apiVersion: 'kais.dev/v1alpha1',
        kind: 'Cell',
        metadata: {
          name: childName,
          namespace: config.parentNamespace,
          ownerReferences: [
            {
              apiVersion: 'kais.dev/v1alpha1',
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

      await config.kubeClient.createCell(cellResource);

      // 7. Return result
      return JSON.stringify({
        status: 'spawned',
        name: childName,
        budget: childBudget,
      });
    },
  };
}
