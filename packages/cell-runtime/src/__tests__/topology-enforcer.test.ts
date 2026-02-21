import { describe, expect, it } from 'vitest';

import { createTopologyEnforcer } from '../topology/topology-enforcer.js';
import type { TopologyFs } from '../topology/topology-enforcer.js';

function makeFs(files: Record<string, string>): TopologyFs {
  return {
    async readFile(path: string): Promise<string> {
      const content = files[path];
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return content;
    },
  };
}

const sampleRouteTable: Record<string, string[]> = {
  'architect-0': ['developer-0', 'developer-1', 'reviewer-0'],
  'developer-0': ['architect-0', 'reviewer-0'],
  'developer-1': ['architect-0', 'reviewer-0'],
  'reviewer-0': ['architect-0'],
};

describe('TopologyEnforcer', () => {
  it('loads a route table and allows valid targets', async () => {
    const fs = makeFs({
      '/etc/kais/topology/routes.json': JSON.stringify(sampleRouteTable),
    });
    const enforcer = await createTopologyEnforcer('architect-0', undefined, fs);

    expect(enforcer.canSendTo('developer-0')).toBe(true);
    expect(enforcer.canSendTo('developer-1')).toBe(true);
    expect(enforcer.canSendTo('reviewer-0')).toBe(true);
  });

  it('blocks targets not in the route table', async () => {
    const fs = makeFs({
      '/etc/kais/topology/routes.json': JSON.stringify(sampleRouteTable),
    });
    const enforcer = await createTopologyEnforcer('developer-0', undefined, fs);

    expect(enforcer.canSendTo('developer-1')).toBe(false);
    expect(enforcer.canSendTo('unknown-cell')).toBe(false);
  });

  it('returns correct allowed targets list', async () => {
    const fs = makeFs({
      '/etc/kais/topology/routes.json': JSON.stringify(sampleRouteTable),
    });
    const enforcer = await createTopologyEnforcer('architect-0', undefined, fs);

    const allowed = enforcer.getAllowedTargets();
    expect(allowed).toEqual(['developer-0', 'developer-1', 'reviewer-0']);
  });

  it('returns an empty list for a cell not in the route table', async () => {
    const fs = makeFs({
      '/etc/kais/topology/routes.json': JSON.stringify(sampleRouteTable),
    });
    const enforcer = await createTopologyEnforcer('unknown-cell', undefined, fs);

    expect(enforcer.canSendTo('architect-0')).toBe(false);
    expect(enforcer.getAllowedTargets()).toEqual([]);
  });

  it('allows all targets when route table file does not exist', async () => {
    const fs = makeFs({});
    const enforcer = await createTopologyEnforcer('any-cell', undefined, fs);

    expect(enforcer.canSendTo('anyone')).toBe(true);
    expect(enforcer.canSendTo('literally-anyone')).toBe(true);
    expect(enforcer.getAllowedTargets()).toEqual([]);
  });

  it('allows all targets when route table file is invalid JSON', async () => {
    const fs = makeFs({
      '/etc/kais/topology/routes.json': 'not valid json {{{',
    });
    const enforcer = await createTopologyEnforcer('any-cell', undefined, fs);

    expect(enforcer.canSendTo('anyone')).toBe(true);
  });

  it('uses custom route table path', async () => {
    const customPath = '/custom/routes.json';
    const fs = makeFs({
      [customPath]: JSON.stringify({
        'my-cell': ['target-a'],
      }),
    });
    const enforcer = await createTopologyEnforcer('my-cell', customPath, fs);

    expect(enforcer.canSendTo('target-a')).toBe(true);
    expect(enforcer.canSendTo('target-b')).toBe(false);
  });

  it('getAllowedTargets returns a defensive copy', async () => {
    const fs = makeFs({
      '/etc/kais/topology/routes.json': JSON.stringify(sampleRouteTable),
    });
    const enforcer = await createTopologyEnforcer('reviewer-0', undefined, fs);

    const targets = enforcer.getAllowedTargets();
    targets.push('hacked');
    // Original should be unmodified
    expect(enforcer.getAllowedTargets()).toEqual(['architect-0']);
  });
});
