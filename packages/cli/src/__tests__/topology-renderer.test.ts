import { describe, expect, it } from 'vitest';
import { generateRouteTable, renderTopology } from '../topology-renderer.js';
import type { CellTemplate, TopologySpec } from '../topology-renderer.js';

// Helper: minimal cell template
function cell(name: string, replicas = 1): CellTemplate {
  return { name, replicas, spec: {} };
}

// ---------------------------------------------------------------------------
// generateRouteTable tests
// ---------------------------------------------------------------------------

describe('generateRouteTable', () => {
  describe('full_mesh', () => {
    it('every cell can message every other cell', () => {
      const topology: TopologySpec = { type: 'full_mesh' };
      const cells = [cell('alpha', 2), cell('beta', 1)];

      const routes = generateRouteTable(topology, cells);

      expect(routes['alpha-0']).toEqual(['alpha-1', 'beta-0']);
      expect(routes['alpha-1']).toEqual(['alpha-0', 'beta-0']);
      expect(routes['beta-0']).toEqual(['alpha-0', 'alpha-1']);
    });

    it('single cell has no routes', () => {
      const topology: TopologySpec = { type: 'full_mesh' };
      const cells = [cell('solo', 1)];

      const routes = generateRouteTable(topology, cells);

      expect(routes['solo-0']).toEqual([]);
    });
  });

  describe('hierarchy', () => {
    it('root can send to all children; children can send to root', () => {
      const topology: TopologySpec = { type: 'hierarchy', root: 'lead' };
      const cells = [cell('lead', 1), cell('worker', 3)];

      const routes = generateRouteTable(topology, cells);

      expect(routes['lead-0']).toEqual(['worker-0', 'worker-1', 'worker-2']);
      expect(routes['worker-0']).toEqual(['lead-0']);
      expect(routes['worker-1']).toEqual(['lead-0']);
      expect(routes['worker-2']).toEqual(['lead-0']);
    });

    it('supports multiple root replicas', () => {
      const topology: TopologySpec = { type: 'hierarchy', root: 'lead' };
      const cells = [cell('lead', 2), cell('worker', 1)];

      const routes = generateRouteTable(topology, cells);

      expect(routes['lead-0']).toEqual(['worker-0']);
      expect(routes['lead-1']).toEqual(['worker-0']);
      expect(routes['worker-0']).toEqual(['lead-0', 'lead-1']);
    });
  });

  describe('star', () => {
    it('hub can send to all spokes; spokes can send to hub only', () => {
      const topology: TopologySpec = { type: 'star', hub: 'coordinator' };
      const cells = [cell('coordinator', 1), cell('agent', 2)];

      const routes = generateRouteTable(topology, cells);

      expect(routes['coordinator-0']).toEqual(['agent-0', 'agent-1']);
      expect(routes['agent-0']).toEqual(['coordinator-0']);
      expect(routes['agent-1']).toEqual(['coordinator-0']);
    });
  });

  describe('ring', () => {
    it('each cell can send to next and previous', () => {
      const topology: TopologySpec = { type: 'ring' };
      const cells = [cell('a', 1), cell('b', 1), cell('c', 1)];

      const routes = generateRouteTable(topology, cells);

      expect(routes['a-0']).toEqual(['b-0', 'c-0']);
      expect(routes['b-0']).toEqual(['c-0', 'a-0']);
      expect(routes['c-0']).toEqual(['a-0', 'b-0']);
    });

    it('two cells form a bidirectional pair', () => {
      const topology: TopologySpec = { type: 'ring' };
      const cells = [cell('x', 1), cell('y', 1)];

      const routes = generateRouteTable(topology, cells);

      expect(routes['x-0']).toEqual(['y-0']);
      expect(routes['y-0']).toEqual(['x-0']);
    });
  });

  describe('custom', () => {
    it('uses explicit routes, expanding template names', () => {
      const topology: TopologySpec = {
        type: 'custom',
        routes: [
          { from: 'architect', to: ['developer', 'reviewer'] },
          { from: 'developer', to: ['architect'] },
          { from: 'reviewer', to: ['architect'] },
        ],
      };
      const cells = [cell('architect', 1), cell('developer', 2), cell('reviewer', 1)];

      const routes = generateRouteTable(topology, cells);

      expect(routes['architect-0']).toEqual(['developer-0', 'developer-1', 'reviewer-0']);
      expect(routes['developer-0']).toEqual(['architect-0']);
      expect(routes['developer-1']).toEqual(['architect-0']);
      expect(routes['reviewer-0']).toEqual(['architect-0']);
    });
  });

  describe('stigmergy', () => {
    it('no direct routes — communication via blackboard', () => {
      const topology: TopologySpec = {
        type: 'stigmergy',
        blackboard: { decayMinutes: 30 },
      };
      const cells = [cell('ant', 3)];

      const routes = generateRouteTable(topology, cells);

      expect(routes['ant-0']).toEqual([]);
      expect(routes['ant-1']).toEqual([]);
      expect(routes['ant-2']).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// renderTopology tests
// ---------------------------------------------------------------------------

describe('renderTopology', () => {
  it('renders full_mesh topology', () => {
    const topology: TopologySpec = { type: 'full_mesh' };
    const cells = [cell('alpha', 2)];

    const output = renderTopology(topology, cells);

    expect(output).toContain('Topology: full_mesh');
    expect(output).toContain('alpha-0');
    expect(output).toContain('alpha-1');
    expect(output).toContain('\u2500\u2500\u2192'); // ──→
  });

  it('renders hierarchy topology', () => {
    const topology: TopologySpec = { type: 'hierarchy', root: 'lead' };
    const cells = [cell('lead', 1), cell('worker', 2)];

    const output = renderTopology(topology, cells);

    expect(output).toContain('Topology: hierarchy');
    expect(output).toContain('lead-0');
    expect(output).toContain('worker-0');
    expect(output).toContain('worker-1');
  });

  it('renders star topology', () => {
    const topology: TopologySpec = { type: 'star', hub: 'hub' };
    const cells = [cell('hub', 1), cell('spoke', 2)];

    const output = renderTopology(topology, cells);

    expect(output).toContain('Topology: star');
    expect(output).toContain('hub-0');
    expect(output).toContain('spoke-0');
    expect(output).toContain('spoke-1');
  });

  it('renders ring topology', () => {
    const topology: TopologySpec = { type: 'ring' };
    const cells = [cell('node', 3)];

    const output = renderTopology(topology, cells);

    expect(output).toContain('Topology: ring');
    expect(output).toContain('node-0');
    expect(output).toContain('node-1');
    expect(output).toContain('node-2');
  });

  it('renders custom topology with aligned arrows', () => {
    const topology: TopologySpec = {
      type: 'custom',
      routes: [
        { from: 'architect', to: ['developer', 'reviewer'] },
        { from: 'developer', to: ['architect', 'reviewer'] },
        { from: 'reviewer', to: ['architect'] },
      ],
    };
    const cells = [cell('architect', 1), cell('developer', 2), cell('reviewer', 1)];

    const output = renderTopology(topology, cells);

    expect(output).toContain('Topology: custom');
    // architect-0 should have 3 targets (developer-0, developer-1, reviewer-0)
    const lines = output.split('\n');
    const architectLine = lines.find((l) => l.includes('architect-0') && l.includes('\u2500\u2500\u2192'));
    expect(architectLine).toBeDefined();
    expect(architectLine).toContain('developer-0');

    // reviewer-0 should route to architect-0
    // Use trimStart to match lines where reviewer-0 is the *source* (not a target in a continuation line)
    const reviewerLine = lines.find((l) => l.trimStart().startsWith('reviewer-0') && l.includes('\u2500\u2500\u2192'));
    expect(reviewerLine).toBeDefined();
    expect(reviewerLine).toContain('architect-0');
  });

  it('renders stigmergy topology with blackboard info', () => {
    const topology: TopologySpec = {
      type: 'stigmergy',
      blackboard: { decayMinutes: 15 },
    };
    const cells = [cell('ant', 3)];

    const output = renderTopology(topology, cells);

    expect(output).toContain('Topology: stigmergy');
    expect(output).toContain('communication via blackboard only');
    expect(output).toContain('15 minutes');
  });

  it('shows (no routes) for cells with no targets', () => {
    // A custom topology where one cell has no routes defined
    const topology: TopologySpec = {
      type: 'custom',
      routes: [{ from: 'sender', to: ['receiver'] }],
    };
    const cells = [cell('sender', 1), cell('receiver', 1)];

    const output = renderTopology(topology, cells);

    // receiver-0 should show (no routes) since no outgoing routes were defined
    expect(output).toContain('receiver-0');
    expect(output).toContain('(no routes)');
  });
});
