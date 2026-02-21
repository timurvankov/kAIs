import { describe, expect, it } from 'vitest';

import {
  CellSpecSchema,
  CellTemplateSchema,
  CompletionCheckSchema,
  FormationBudgetSchema,
  FormationSpecSchema,
  FormationStatusSchema,
  MissionCompletionSchema,
  MissionEntrypointSchema,
  MissionSpecSchema,
  MissionStatusSchema,
  TopologySpecSchema,
} from '../schemas.js';

// --- Helpers ---

const validMind = {
  provider: 'anthropic' as const,
  model: 'claude-sonnet-4-20250514',
  systemPrompt: 'You are a helpful assistant.',
};

const validCellTemplate = {
  name: 'researcher',
  spec: { mind: validMind },
};

const validTopology = {
  type: 'full_mesh' as const,
};

const validFormationSpec = {
  cells: [validCellTemplate],
  topology: validTopology,
};

const validCompletionCheck = {
  name: 'tests-pass',
  type: 'command' as const,
  command: 'npm test',
  successPattern: 'All tests passed',
};

const validCompletion = {
  checks: [validCompletionCheck],
  maxAttempts: 3,
  timeout: '30m',
};

const validEntrypoint = {
  cell: 'researcher',
  message: 'Please implement the feature described in the objective.',
};

const validMissionSpec = {
  objective: 'Implement user authentication',
  completion: validCompletion,
  entrypoint: validEntrypoint,
};

// --- TopologySpec ---

describe('TopologySpecSchema', () => {
  it('accepts all valid topology types', () => {
    for (const type of ['full_mesh', 'hierarchy', 'star', 'ring', 'stigmergy', 'custom'] as const) {
      const result = TopologySpecSchema.parse({ type });
      expect(result.type).toBe(type);
    }
  });

  it('accepts topology with root (hierarchy)', () => {
    const result = TopologySpecSchema.parse({
      type: 'hierarchy',
      root: 'coordinator',
    });
    expect(result.root).toBe('coordinator');
  });

  it('accepts topology with hub (star)', () => {
    const result = TopologySpecSchema.parse({
      type: 'star',
      hub: 'central-node',
    });
    expect(result.hub).toBe('central-node');
  });

  it('accepts topology with routes (custom)', () => {
    const result = TopologySpecSchema.parse({
      type: 'custom',
      routes: [
        { from: 'researcher', to: ['writer', 'reviewer'] },
        { from: 'writer', to: ['reviewer'], protocol: 'direct' },
      ],
    });
    expect(result.routes).toHaveLength(2);
    expect(result.routes![0].to).toEqual(['writer', 'reviewer']);
    expect(result.routes![1].protocol).toBe('direct');
  });

  it('accepts topology with broadcast', () => {
    const result = TopologySpecSchema.parse({
      type: 'full_mesh',
      broadcast: { enabled: true, from: ['coordinator'] },
    });
    expect(result.broadcast?.enabled).toBe(true);
    expect(result.broadcast?.from).toEqual(['coordinator']);
  });

  it('accepts topology with blackboard (stigmergy)', () => {
    const result = TopologySpecSchema.parse({
      type: 'stigmergy',
      blackboard: { decayMinutes: 60 },
    });
    expect(result.blackboard?.decayMinutes).toBe(60);
  });

  it('rejects invalid topology type', () => {
    expect(() => TopologySpecSchema.parse({ type: 'mesh' })).toThrow();
  });

  it('rejects missing type', () => {
    expect(() => TopologySpecSchema.parse({})).toThrow();
  });

  it('rejects routes with empty to array', () => {
    expect(() =>
      TopologySpecSchema.parse({
        type: 'custom',
        routes: [{ from: 'a', to: [] }],
      }),
    ).toThrow();
  });

  it('rejects routes with empty from string', () => {
    expect(() =>
      TopologySpecSchema.parse({
        type: 'custom',
        routes: [{ from: '', to: ['b'] }],
      }),
    ).toThrow();
  });

  it('rejects blackboard with non-positive decay', () => {
    expect(() =>
      TopologySpecSchema.parse({
        type: 'stigmergy',
        blackboard: { decayMinutes: 0 },
      }),
    ).toThrow();
    expect(() =>
      TopologySpecSchema.parse({
        type: 'stigmergy',
        blackboard: { decayMinutes: -5 },
      }),
    ).toThrow();
  });
});

// --- CellTemplate ---

describe('CellTemplateSchema', () => {
  it('accepts a minimal cell template', () => {
    const result = CellTemplateSchema.parse(validCellTemplate);
    expect(result.name).toBe('researcher');
    expect(result.replicas).toBe(1); // default
    expect(result.spec.mind.provider).toBe('anthropic');
  });

  it('accepts cell template with explicit replicas', () => {
    const result = CellTemplateSchema.parse({
      ...validCellTemplate,
      replicas: 5,
    });
    expect(result.replicas).toBe(5);
  });

  it('accepts cell template with tools and resources', () => {
    const result = CellTemplateSchema.parse({
      name: 'worker',
      replicas: 3,
      spec: {
        mind: validMind,
        tools: [{ name: 'web_search' }],
        resources: { maxCostPerHour: 1.0 },
      },
    });
    expect(result.spec.tools).toHaveLength(1);
    expect(result.spec.resources?.maxCostPerHour).toBe(1.0);
  });

  it('rejects empty name', () => {
    expect(() =>
      CellTemplateSchema.parse({ ...validCellTemplate, name: '' }),
    ).toThrow();
  });

  it('rejects zero replicas', () => {
    expect(() =>
      CellTemplateSchema.parse({ ...validCellTemplate, replicas: 0 }),
    ).toThrow();
  });

  it('rejects negative replicas', () => {
    expect(() =>
      CellTemplateSchema.parse({ ...validCellTemplate, replicas: -1 }),
    ).toThrow();
  });

  it('rejects missing spec', () => {
    expect(() =>
      CellTemplateSchema.parse({ name: 'test' }),
    ).toThrow();
  });
});

// --- FormationBudget ---

describe('FormationBudgetSchema', () => {
  it('accepts empty budget (all optional)', () => {
    const result = FormationBudgetSchema.parse({});
    expect(result).toEqual({});
  });

  it('accepts full budget', () => {
    const result = FormationBudgetSchema.parse({
      maxTotalCost: 100,
      maxCostPerHour: 10,
      allocation: { researcher: '40%', writer: '60%' },
    });
    expect(result.maxTotalCost).toBe(100);
    expect(result.allocation?.['researcher']).toBe('40%');
  });

  it('rejects non-positive maxTotalCost', () => {
    expect(() =>
      FormationBudgetSchema.parse({ maxTotalCost: 0 }),
    ).toThrow();
    expect(() =>
      FormationBudgetSchema.parse({ maxTotalCost: -5 }),
    ).toThrow();
  });

  it('rejects non-positive maxCostPerHour', () => {
    expect(() =>
      FormationBudgetSchema.parse({ maxCostPerHour: 0 }),
    ).toThrow();
  });
});

// --- FormationSpec ---

describe('FormationSpecSchema', () => {
  it('accepts a valid minimal formation spec', () => {
    const result = FormationSpecSchema.parse(validFormationSpec);
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0].name).toBe('researcher');
    expect(result.topology.type).toBe('full_mesh');
    expect(result.budget).toBeUndefined();
  });

  it('accepts formation with multiple cells and budget', () => {
    const result = FormationSpecSchema.parse({
      cells: [
        { name: 'researcher', spec: { mind: validMind } },
        { name: 'writer', replicas: 2, spec: { mind: { ...validMind, model: 'gpt-4' } } },
        { name: 'reviewer', spec: { mind: { ...validMind, provider: 'openai' as const, model: 'gpt-4o' } } },
      ],
      topology: {
        type: 'hierarchy',
        root: 'researcher',
        routes: [
          { from: 'researcher', to: ['writer'] },
          { from: 'writer', to: ['reviewer'] },
        ],
      },
      budget: {
        maxTotalCost: 50,
        allocation: { researcher: '30%', writer: '50%', reviewer: '20%' },
      },
    });
    expect(result.cells).toHaveLength(3);
    expect(result.cells[1].replicas).toBe(2);
    expect(result.topology.root).toBe('researcher');
    expect(result.budget?.maxTotalCost).toBe(50);
  });

  it('rejects empty cells array', () => {
    expect(() =>
      FormationSpecSchema.parse({ cells: [], topology: validTopology }),
    ).toThrow();
  });

  it('rejects missing cells', () => {
    expect(() =>
      FormationSpecSchema.parse({ topology: validTopology }),
    ).toThrow();
  });

  it('rejects missing topology', () => {
    expect(() =>
      FormationSpecSchema.parse({ cells: [validCellTemplate] }),
    ).toThrow();
  });

  it('applies default replicas to cells', () => {
    const result = FormationSpecSchema.parse(validFormationSpec);
    expect(result.cells[0].replicas).toBe(1);
  });
});

// --- FormationStatus ---

describe('FormationStatusSchema', () => {
  it('accepts a valid formation status', () => {
    const result = FormationStatusSchema.parse({
      phase: 'Running',
      readyCells: 2,
      totalCells: 3,
      totalCost: 5.5,
      cells: [
        { name: 'researcher', phase: 'Running', cost: 3.0 },
        { name: 'writer', phase: 'Running', cost: 2.5 },
        { name: 'reviewer', phase: 'Pending', cost: 0 },
      ],
    });
    expect(result.phase).toBe('Running');
    expect(result.readyCells).toBe(2);
    expect(result.cells).toHaveLength(3);
  });

  it('accepts formation status without cells array', () => {
    const result = FormationStatusSchema.parse({
      phase: 'Pending',
      readyCells: 0,
      totalCells: 0,
      totalCost: 0,
    });
    expect(result.cells).toBeUndefined();
  });

  it('accepts all valid phases', () => {
    for (const phase of ['Pending', 'Running', 'Paused', 'Completed', 'Failed'] as const) {
      const result = FormationStatusSchema.parse({
        phase,
        readyCells: 0,
        totalCells: 0,
        totalCost: 0,
      });
      expect(result.phase).toBe(phase);
    }
  });

  it('rejects invalid phase', () => {
    expect(() =>
      FormationStatusSchema.parse({
        phase: 'Unknown',
        readyCells: 0,
        totalCells: 0,
        totalCost: 0,
      }),
    ).toThrow();
  });

  it('rejects negative readyCells', () => {
    expect(() =>
      FormationStatusSchema.parse({
        phase: 'Running',
        readyCells: -1,
        totalCells: 0,
        totalCost: 0,
      }),
    ).toThrow();
  });

  it('rejects negative totalCost', () => {
    expect(() =>
      FormationStatusSchema.parse({
        phase: 'Running',
        readyCells: 0,
        totalCells: 0,
        totalCost: -1,
      }),
    ).toThrow();
  });
});

// --- CompletionCheck ---

describe('CompletionCheckSchema', () => {
  it('accepts a fileExists check', () => {
    const result = CompletionCheckSchema.parse({
      name: 'output-exists',
      type: 'fileExists',
      paths: ['/output/result.json'],
    });
    expect(result.type).toBe('fileExists');
    expect(result.paths).toEqual(['/output/result.json']);
  });

  it('accepts a command check with patterns', () => {
    const result = CompletionCheckSchema.parse({
      name: 'tests-pass',
      type: 'command',
      command: 'npm test',
      successPattern: 'All tests passed',
      failPattern: 'FAIL',
    });
    expect(result.type).toBe('command');
    expect(result.command).toBe('npm test');
    expect(result.successPattern).toBe('All tests passed');
  });

  it('accepts a coverage check with jsonPath and operator', () => {
    const result = CompletionCheckSchema.parse({
      name: 'coverage-check',
      type: 'coverage',
      command: 'npm run coverage -- --json',
      jsonPath: '$.total.lines.pct',
      operator: '>=',
      value: 80,
    });
    expect(result.type).toBe('coverage');
    expect(result.operator).toBe('>=');
    expect(result.value).toBe(80);
  });

  it('accepts a minimal check (just name and type)', () => {
    const result = CompletionCheckSchema.parse({
      name: 'basic',
      type: 'command',
    });
    expect(result.name).toBe('basic');
    expect(result.command).toBeUndefined();
  });

  it('rejects empty name', () => {
    expect(() =>
      CompletionCheckSchema.parse({ name: '', type: 'command' }),
    ).toThrow();
  });

  it('rejects invalid type', () => {
    expect(() =>
      CompletionCheckSchema.parse({ name: 'test', type: 'invalid' }),
    ).toThrow();
  });
});

// --- MissionCompletion ---

describe('MissionCompletionSchema', () => {
  it('accepts a valid completion spec', () => {
    const result = MissionCompletionSchema.parse(validCompletion);
    expect(result.checks).toHaveLength(1);
    expect(result.maxAttempts).toBe(3);
    expect(result.timeout).toBe('30m');
  });

  it('accepts completion with review', () => {
    const result = MissionCompletionSchema.parse({
      ...validCompletion,
      review: {
        enabled: true,
        reviewer: 'senior-dev',
        criteria: 'Code quality, test coverage, documentation',
      },
    });
    expect(result.review?.enabled).toBe(true);
    expect(result.review?.reviewer).toBe('senior-dev');
  });

  it('applies default maxAttempts of 3', () => {
    const result = MissionCompletionSchema.parse({
      checks: [validCompletionCheck],
      timeout: '15m',
    });
    expect(result.maxAttempts).toBe(3);
  });

  it('rejects empty checks array', () => {
    expect(() =>
      MissionCompletionSchema.parse({
        checks: [],
        maxAttempts: 3,
        timeout: '30m',
      }),
    ).toThrow();
  });

  it('rejects missing timeout', () => {
    expect(() =>
      MissionCompletionSchema.parse({
        checks: [validCompletionCheck],
        maxAttempts: 3,
      }),
    ).toThrow();
  });

  it('rejects empty timeout', () => {
    expect(() =>
      MissionCompletionSchema.parse({
        checks: [validCompletionCheck],
        maxAttempts: 3,
        timeout: '',
      }),
    ).toThrow();
  });

  it('rejects zero maxAttempts', () => {
    expect(() =>
      MissionCompletionSchema.parse({
        checks: [validCompletionCheck],
        maxAttempts: 0,
        timeout: '30m',
      }),
    ).toThrow();
  });

  it('rejects review with empty reviewer', () => {
    expect(() =>
      MissionCompletionSchema.parse({
        ...validCompletion,
        review: { enabled: true, reviewer: '', criteria: 'Good code' },
      }),
    ).toThrow();
  });
});

// --- MissionEntrypoint ---

describe('MissionEntrypointSchema', () => {
  it('accepts a valid entrypoint', () => {
    const result = MissionEntrypointSchema.parse(validEntrypoint);
    expect(result.cell).toBe('researcher');
    expect(result.message).toBe('Please implement the feature described in the objective.');
  });

  it('rejects empty cell', () => {
    expect(() =>
      MissionEntrypointSchema.parse({ cell: '', message: 'Do something' }),
    ).toThrow();
  });

  it('rejects empty message', () => {
    expect(() =>
      MissionEntrypointSchema.parse({ cell: 'researcher', message: '' }),
    ).toThrow();
  });

  it('rejects missing fields', () => {
    expect(() => MissionEntrypointSchema.parse({})).toThrow();
    expect(() => MissionEntrypointSchema.parse({ cell: 'x' })).toThrow();
  });
});

// --- MissionSpec ---

describe('MissionSpecSchema', () => {
  it('accepts a valid minimal mission spec', () => {
    const result = MissionSpecSchema.parse(validMissionSpec);
    expect(result.objective).toBe('Implement user authentication');
    expect(result.completion.checks).toHaveLength(1);
    expect(result.entrypoint.cell).toBe('researcher');
    expect(result.formationRef).toBeUndefined();
    expect(result.cellRef).toBeUndefined();
    expect(result.budget).toBeUndefined();
  });

  it('accepts mission spec with formationRef', () => {
    const result = MissionSpecSchema.parse({
      ...validMissionSpec,
      formationRef: 'my-formation',
    });
    expect(result.formationRef).toBe('my-formation');
  });

  it('accepts mission spec with cellRef', () => {
    const result = MissionSpecSchema.parse({
      ...validMissionSpec,
      cellRef: 'my-cell',
    });
    expect(result.cellRef).toBe('my-cell');
  });

  it('accepts mission spec with budget', () => {
    const result = MissionSpecSchema.parse({
      ...validMissionSpec,
      budget: { maxCost: 25.0 },
    });
    expect(result.budget?.maxCost).toBe(25.0);
  });

  it('rejects empty objective', () => {
    expect(() =>
      MissionSpecSchema.parse({ ...validMissionSpec, objective: '' }),
    ).toThrow();
  });

  it('rejects missing completion', () => {
    expect(() =>
      MissionSpecSchema.parse({
        objective: 'Do something',
        entrypoint: validEntrypoint,
      }),
    ).toThrow();
  });

  it('rejects missing entrypoint', () => {
    expect(() =>
      MissionSpecSchema.parse({
        objective: 'Do something',
        completion: validCompletion,
      }),
    ).toThrow();
  });

  it('rejects non-positive budget maxCost', () => {
    expect(() =>
      MissionSpecSchema.parse({
        ...validMissionSpec,
        budget: { maxCost: 0 },
      }),
    ).toThrow();
    expect(() =>
      MissionSpecSchema.parse({
        ...validMissionSpec,
        budget: { maxCost: -5 },
      }),
    ).toThrow();
  });

  it('accepts mission spec with multiple checks', () => {
    const result = MissionSpecSchema.parse({
      ...validMissionSpec,
      completion: {
        checks: [
          { name: 'build', type: 'command', command: 'npm run build' },
          { name: 'test', type: 'command', command: 'npm test', successPattern: 'passed' },
          { name: 'output', type: 'fileExists', paths: ['/dist/index.js'] },
        ],
        maxAttempts: 5,
        timeout: '1h',
      },
    });
    expect(result.completion.checks).toHaveLength(3);
    expect(result.completion.maxAttempts).toBe(5);
  });
});

// --- MissionStatus ---

describe('MissionStatusSchema', () => {
  it('accepts a valid pending status', () => {
    const result = MissionStatusSchema.parse({
      phase: 'Pending',
      attempt: 0,
      cost: 0,
    });
    expect(result.phase).toBe('Pending');
    expect(result.attempt).toBe(0);
    expect(result.cost).toBe(0);
  });

  it('accepts a running status with all fields', () => {
    const result = MissionStatusSchema.parse({
      phase: 'Running',
      attempt: 2,
      startedAt: '2025-06-15T10:00:00Z',
      cost: 3.5,
      checks: [
        { name: 'build', status: 'Passed' },
        { name: 'test', status: 'Pending' },
      ],
      review: { status: 'Pending' },
      history: [
        { attempt: 1, startedAt: '2025-06-15T09:00:00Z', result: 'Failed: tests did not pass' },
      ],
      message: 'Retrying after test failures',
    });
    expect(result.phase).toBe('Running');
    expect(result.attempt).toBe(2);
    expect(result.checks).toHaveLength(2);
    expect(result.review?.status).toBe('Pending');
    expect(result.history).toHaveLength(1);
  });

  it('accepts a succeeded status', () => {
    const result = MissionStatusSchema.parse({
      phase: 'Succeeded',
      attempt: 1,
      startedAt: '2025-06-15T10:00:00Z',
      cost: 2.0,
      checks: [
        { name: 'build', status: 'Passed' },
        { name: 'test', status: 'Passed' },
      ],
      review: { status: 'Approved', feedback: 'Looks great!' },
    });
    expect(result.phase).toBe('Succeeded');
    expect(result.review?.feedback).toBe('Looks great!');
  });

  it('accepts a failed status with history', () => {
    const result = MissionStatusSchema.parse({
      phase: 'Failed',
      attempt: 3,
      cost: 15.0,
      checks: [
        { name: 'test', status: 'Failed' },
      ],
      history: [
        { attempt: 1, startedAt: '2025-06-15T09:00:00Z', result: 'Failed' },
        { attempt: 2, startedAt: '2025-06-15T09:30:00Z', result: 'Failed' },
        { attempt: 3, startedAt: '2025-06-15T10:00:00Z', result: 'Failed' },
      ],
      message: 'Max attempts exceeded',
    });
    expect(result.phase).toBe('Failed');
    expect(result.history).toHaveLength(3);
  });

  it('accepts all valid phases', () => {
    for (const phase of ['Pending', 'Running', 'Succeeded', 'Failed'] as const) {
      const result = MissionStatusSchema.parse({ phase, attempt: 0, cost: 0 });
      expect(result.phase).toBe(phase);
    }
  });

  it('accepts all valid check statuses', () => {
    for (const status of ['Pending', 'Passed', 'Failed', 'Error'] as const) {
      const result = MissionStatusSchema.parse({
        phase: 'Running',
        attempt: 1,
        cost: 0,
        checks: [{ name: 'test', status }],
      });
      expect(result.checks![0].status).toBe(status);
    }
  });

  it('accepts all valid review statuses', () => {
    for (const status of ['Pending', 'Approved', 'Rejected'] as const) {
      const result = MissionStatusSchema.parse({
        phase: 'Running',
        attempt: 1,
        cost: 0,
        review: { status },
      });
      expect(result.review?.status).toBe(status);
    }
  });

  it('rejects invalid phase', () => {
    expect(() =>
      MissionStatusSchema.parse({ phase: 'Unknown', attempt: 0, cost: 0 }),
    ).toThrow();
  });

  it('rejects negative attempt', () => {
    expect(() =>
      MissionStatusSchema.parse({ phase: 'Pending', attempt: -1, cost: 0 }),
    ).toThrow();
  });

  it('rejects negative cost', () => {
    expect(() =>
      MissionStatusSchema.parse({ phase: 'Pending', attempt: 0, cost: -1 }),
    ).toThrow();
  });

  it('rejects invalid check status', () => {
    expect(() =>
      MissionStatusSchema.parse({
        phase: 'Running',
        attempt: 1,
        cost: 0,
        checks: [{ name: 'test', status: 'Invalid' }],
      }),
    ).toThrow();
  });

  it('rejects invalid review status', () => {
    expect(() =>
      MissionStatusSchema.parse({
        phase: 'Running',
        attempt: 1,
        cost: 0,
        review: { status: 'Invalid' },
      }),
    ).toThrow();
  });

  it('rejects invalid startedAt format', () => {
    expect(() =>
      MissionStatusSchema.parse({
        phase: 'Running',
        attempt: 1,
        cost: 0,
        startedAt: 'not-a-date',
      }),
    ).toThrow();
  });

  it('rejects invalid history entry timestamp', () => {
    expect(() =>
      MissionStatusSchema.parse({
        phase: 'Running',
        attempt: 1,
        cost: 0,
        history: [{ attempt: 1, startedAt: 'bad-date', result: 'Failed' }],
      }),
    ).toThrow();
  });
});

// --- CellSpec with new fields ---

describe('CellSpecSchema (parentRef, formationRef)', () => {
  const validCellSpec = {
    mind: validMind,
  };

  it('accepts CellSpec with parentRef', () => {
    const result = CellSpecSchema.parse({
      ...validCellSpec,
      parentRef: 'coordinator',
    });
    expect(result.parentRef).toBe('coordinator');
  });

  it('accepts CellSpec with formationRef', () => {
    const result = CellSpecSchema.parse({
      ...validCellSpec,
      formationRef: 'my-formation',
    });
    expect(result.formationRef).toBe('my-formation');
  });

  it('accepts CellSpec with both parentRef and formationRef', () => {
    const result = CellSpecSchema.parse({
      ...validCellSpec,
      parentRef: 'coordinator',
      formationRef: 'my-formation',
    });
    expect(result.parentRef).toBe('coordinator');
    expect(result.formationRef).toBe('my-formation');
  });

  it('accepts CellSpec without parentRef or formationRef (backward compatible)', () => {
    const result = CellSpecSchema.parse(validCellSpec);
    expect(result.parentRef).toBeUndefined();
    expect(result.formationRef).toBeUndefined();
  });
});
