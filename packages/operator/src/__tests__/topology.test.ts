import type { CellTemplate, TopologySpec } from '@kais/core';
import { describe, expect, it } from 'vitest';

import {
  expandCellNames,
  generateRouteTable,
  generateTopologyConfigMap,
} from '../topology.js';

// --- Helpers ---

function makeCellTemplates(
  templates: Array<{ name: string; replicas?: number }>,
): CellTemplate[] {
  return templates.map((t) => ({
    name: t.name,
    replicas: t.replicas ?? 1,
    spec: {
      mind: {
        provider: 'anthropic' as const,
        model: 'claude-sonnet-4-20250514',
        systemPrompt: `You are ${t.name}.`,
      },
    },
  }));
}

// --- expandCellNames ---

describe('expandCellNames', () => {
  it('expands single-replica templates', () => {
    const cells = makeCellTemplates([{ name: 'researcher' }, { name: 'writer' }]);
    expect(expandCellNames(cells)).toEqual(['researcher-0', 'writer-0']);
  });

  it('expands multi-replica templates', () => {
    const cells = makeCellTemplates([{ name: 'worker', replicas: 3 }]);
    expect(expandCellNames(cells)).toEqual(['worker-0', 'worker-1', 'worker-2']);
  });

  it('handles mixed replicas', () => {
    const cells = makeCellTemplates([
      { name: 'lead', replicas: 1 },
      { name: 'worker', replicas: 2 },
    ]);
    expect(expandCellNames(cells)).toEqual(['lead-0', 'worker-0', 'worker-1']);
  });
});

// --- generateRouteTable ---

describe('generateRouteTable', () => {
  describe('full_mesh', () => {
    it('every cell can message every other cell', () => {
      const topology: TopologySpec = { type: 'full_mesh' };
      const cells = makeCellTemplates([
        { name: 'a', replicas: 1 },
        { name: 'b', replicas: 1 },
        { name: 'c', replicas: 1 },
      ]);

      const routes = generateRouteTable(topology, cells);

      expect(routes['a-0']).toEqual(expect.arrayContaining(['b-0', 'c-0']));
      expect(routes['b-0']).toEqual(expect.arrayContaining(['a-0', 'c-0']));
      expect(routes['c-0']).toEqual(expect.arrayContaining(['a-0', 'b-0']));
    });

    it('a cell cannot message itself', () => {
      const topology: TopologySpec = { type: 'full_mesh' };
      const cells = makeCellTemplates([{ name: 'a', replicas: 2 }]);

      const routes = generateRouteTable(topology, cells);

      expect(routes['a-0']).not.toContain('a-0');
      expect(routes['a-1']).not.toContain('a-1');
    });

    it('handles single cell (no routes)', () => {
      const topology: TopologySpec = { type: 'full_mesh' };
      const cells = makeCellTemplates([{ name: 'solo' }]);

      const routes = generateRouteTable(topology, cells);

      expect(routes['solo-0']).toEqual([]);
    });

    it('handles multi-replica full mesh', () => {
      const topology: TopologySpec = { type: 'full_mesh' };
      const cells = makeCellTemplates([{ name: 'worker', replicas: 3 }]);

      const routes = generateRouteTable(topology, cells);

      expect(routes['worker-0']).toEqual(expect.arrayContaining(['worker-1', 'worker-2']));
      expect(routes['worker-0']).not.toContain('worker-0');
      expect(routes['worker-1']).toEqual(expect.arrayContaining(['worker-0', 'worker-2']));
      expect(routes['worker-2']).toEqual(expect.arrayContaining(['worker-0', 'worker-1']));
    });
  });

  describe('hierarchy', () => {
    it('root can message children, children can message root', () => {
      const topology: TopologySpec = { type: 'hierarchy', root: 'lead' };
      const cells = makeCellTemplates([
        { name: 'lead', replicas: 1 },
        { name: 'worker', replicas: 2 },
      ]);

      const routes = generateRouteTable(topology, cells);

      expect(routes['lead-0']).toEqual(expect.arrayContaining(['worker-0', 'worker-1']));
      expect(routes['worker-0']).toEqual(['lead-0']);
      expect(routes['worker-1']).toEqual(['lead-0']);
    });

    it('children cannot message each other', () => {
      const topology: TopologySpec = { type: 'hierarchy', root: 'lead' };
      const cells = makeCellTemplates([
        { name: 'lead' },
        { name: 'a' },
        { name: 'b' },
      ]);

      const routes = generateRouteTable(topology, cells);

      expect(routes['a-0']).not.toContain('b-0');
      expect(routes['b-0']).not.toContain('a-0');
    });
  });

  describe('star', () => {
    it('hub can message all spokes, spokes can message hub', () => {
      const topology: TopologySpec = { type: 'star', hub: 'coordinator' };
      const cells = makeCellTemplates([
        { name: 'coordinator' },
        { name: 'worker', replicas: 3 },
      ]);

      const routes = generateRouteTable(topology, cells);

      expect(routes['coordinator-0']).toEqual(
        expect.arrayContaining(['worker-0', 'worker-1', 'worker-2']),
      );
      expect(routes['worker-0']).toEqual(['coordinator-0']);
      expect(routes['worker-1']).toEqual(['coordinator-0']);
      expect(routes['worker-2']).toEqual(['coordinator-0']);
    });

    it('spokes cannot message each other', () => {
      const topology: TopologySpec = { type: 'star', hub: 'hub' };
      const cells = makeCellTemplates([
        { name: 'hub' },
        { name: 'a' },
        { name: 'b' },
      ]);

      const routes = generateRouteTable(topology, cells);

      expect(routes['a-0']).not.toContain('b-0');
      expect(routes['b-0']).not.toContain('a-0');
    });
  });

  describe('ring', () => {
    it('each cell can message next and previous', () => {
      const topology: TopologySpec = { type: 'ring' };
      const cells = makeCellTemplates([
        { name: 'a' },
        { name: 'b' },
        { name: 'c' },
        { name: 'd' },
      ]);

      const routes = generateRouteTable(topology, cells);

      // a-0 next=b-0, prev=d-0
      expect(routes['a-0']).toEqual(expect.arrayContaining(['b-0', 'd-0']));
      // b-0 next=c-0, prev=a-0
      expect(routes['b-0']).toEqual(expect.arrayContaining(['c-0', 'a-0']));
      // c-0 next=d-0, prev=b-0
      expect(routes['c-0']).toEqual(expect.arrayContaining(['d-0', 'b-0']));
      // d-0 next=a-0, prev=c-0
      expect(routes['d-0']).toEqual(expect.arrayContaining(['a-0', 'c-0']));
    });

    it('two cells form a simple bidirectional link', () => {
      const topology: TopologySpec = { type: 'ring' };
      const cells = makeCellTemplates([{ name: 'a' }, { name: 'b' }]);

      const routes = generateRouteTable(topology, cells);

      expect(routes['a-0']).toEqual(['b-0']);
      expect(routes['b-0']).toEqual(['a-0']);
    });

    it('single cell has no routes in ring', () => {
      const topology: TopologySpec = { type: 'ring' };
      const cells = makeCellTemplates([{ name: 'solo' }]);

      const routes = generateRouteTable(topology, cells);

      expect(routes['solo-0']).toEqual([]);
    });

    it('three cells each connect to two neighbors', () => {
      const topology: TopologySpec = { type: 'ring' };
      const cells = makeCellTemplates([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);

      const routes = generateRouteTable(topology, cells);

      expect(routes['a-0']).toHaveLength(2);
      expect(routes['b-0']).toHaveLength(2);
      expect(routes['c-0']).toHaveLength(2);
    });
  });

  describe('custom', () => {
    it('uses routes from topology spec, expanding template names', () => {
      const topology: TopologySpec = {
        type: 'custom',
        routes: [
          { from: 'researcher', to: ['writer'] },
          { from: 'writer', to: ['reviewer'] },
        ],
      };
      const cells = makeCellTemplates([
        { name: 'researcher' },
        { name: 'writer' },
        { name: 'reviewer' },
      ]);

      const routes = generateRouteTable(topology, cells);

      expect(routes['researcher-0']).toEqual(['writer-0']);
      expect(routes['writer-0']).toEqual(['reviewer-0']);
      expect(routes['reviewer-0']).toEqual([]);
    });

    it('handles multi-replica targets in custom routes', () => {
      const topology: TopologySpec = {
        type: 'custom',
        routes: [{ from: 'lead', to: ['worker'] }],
      };
      const cells = makeCellTemplates([
        { name: 'lead' },
        { name: 'worker', replicas: 3 },
      ]);

      const routes = generateRouteTable(topology, cells);

      expect(routes['lead-0']).toEqual(
        expect.arrayContaining(['worker-0', 'worker-1', 'worker-2']),
      );
    });
  });

  describe('stigmergy', () => {
    it('generates empty routes for all cells', () => {
      const topology: TopologySpec = {
        type: 'stigmergy',
        blackboard: { decayMinutes: 30 },
      };
      const cells = makeCellTemplates([
        { name: 'a', replicas: 2 },
        { name: 'b' },
      ]);

      const routes = generateRouteTable(topology, cells);

      expect(routes['a-0']).toEqual([]);
      expect(routes['a-1']).toEqual([]);
      expect(routes['b-0']).toEqual([]);
    });
  });
});

// --- generateTopologyConfigMap ---

describe('generateTopologyConfigMap', () => {
  it('generates a ConfigMap with correct metadata', () => {
    const topology: TopologySpec = { type: 'full_mesh' };
    const cells = makeCellTemplates([{ name: 'a' }, { name: 'b' }]);

    const cm = generateTopologyConfigMap(
      'my-formation',
      'default',
      topology,
      cells,
      { name: 'my-formation', uid: 'uid-123' },
    );

    expect(cm.metadata?.name).toBe('topology-my-formation');
    expect(cm.metadata?.namespace).toBe('default');
  });

  it('sets ownerReferences to the Formation', () => {
    const topology: TopologySpec = { type: 'full_mesh' };
    const cells = makeCellTemplates([{ name: 'a' }]);

    const cm = generateTopologyConfigMap(
      'my-formation',
      'default',
      topology,
      cells,
      { name: 'my-formation', uid: 'uid-123' },
    );

    const ref = cm.metadata?.ownerReferences?.[0];
    expect(ref?.apiVersion).toBe('kais.io/v1');
    expect(ref?.kind).toBe('Formation');
    expect(ref?.name).toBe('my-formation');
    expect(ref?.uid).toBe('uid-123');
    expect(ref?.controller).toBe(true);
  });

  it('contains valid routes.json data', () => {
    const topology: TopologySpec = { type: 'full_mesh' };
    const cells = makeCellTemplates([{ name: 'a' }, { name: 'b' }]);

    const cm = generateTopologyConfigMap(
      'my-formation',
      'default',
      topology,
      cells,
      { name: 'my-formation', uid: 'uid-123' },
    );

    expect(cm.data).toBeDefined();
    expect(cm.data!['routes.json']).toBeDefined();

    const routes = JSON.parse(cm.data!['routes.json']!) as Record<string, string[]>;
    expect(routes['a-0']).toEqual(['b-0']);
    expect(routes['b-0']).toEqual(['a-0']);
  });
});
