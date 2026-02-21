/**
 * Topology ASCII renderer for the kAIs CLI.
 *
 * Renders a route table (cell → targets) as a human-readable ASCII graph.
 */

export interface TopologyRoute {
  from: string;
  to: string[];
  protocol?: string;
}

export interface TopologySpec {
  type: 'full_mesh' | 'hierarchy' | 'star' | 'ring' | 'stigmergy' | 'custom';
  root?: string;
  hub?: string;
  routes?: TopologyRoute[];
  broadcast?: { enabled: boolean; from: string[] };
  blackboard?: { decayMinutes: number };
}

export interface CellTemplate {
  name: string;
  replicas: number;
  spec: unknown;
}

/**
 * Expand cell templates into a flat list of cell names.
 * For a template with name "researcher" and replicas 3, generates:
 *   ["researcher-0", "researcher-1", "researcher-2"]
 */
function expandCellNames(cells: CellTemplate[]): string[] {
  const names: string[] = [];
  for (const tpl of cells) {
    for (let i = 0; i < tpl.replicas; i++) {
      names.push(`${tpl.name}-${i}`);
    }
  }
  return names;
}

/**
 * Find which expanded cell names correspond to a template name.
 */
function cellNamesForTemplate(templateName: string, cells: CellTemplate[]): string[] {
  const tpl = cells.find((c) => c.name === templateName);
  if (!tpl) return [];
  const names: string[] = [];
  for (let i = 0; i < tpl.replicas; i++) {
    names.push(`${tpl.name}-${i}`);
  }
  return names;
}

/**
 * Generate a route table mapping each cell name to the list of cell names
 * it is allowed to send messages to.
 *
 * This replicates the logic from @kais/operator topology.ts so the CLI
 * does not need to import the operator package.
 */
export function generateRouteTable(
  topology: TopologySpec,
  cells: CellTemplate[],
): Record<string, string[]> {
  const allNames = expandCellNames(cells);
  const routes: Record<string, string[]> = {};

  for (const name of allNames) {
    routes[name] = [];
  }

  switch (topology.type) {
    case 'full_mesh': {
      for (const name of allNames) {
        routes[name] = allNames.filter((n) => n !== name);
      }
      break;
    }

    case 'hierarchy': {
      const rootTemplateName = topology.root!;
      const rootNames = cellNamesForTemplate(rootTemplateName, cells);
      const childNames = allNames.filter((n) => !rootNames.includes(n));

      for (const root of rootNames) {
        routes[root] = childNames;
      }
      for (const child of childNames) {
        routes[child] = [...rootNames];
      }
      break;
    }

    case 'star': {
      const hubTemplateName = topology.hub!;
      const hubNames = cellNamesForTemplate(hubTemplateName, cells);
      const spokeNames = allNames.filter((n) => !hubNames.includes(n));

      for (const hub of hubNames) {
        routes[hub] = spokeNames;
      }
      for (const spoke of spokeNames) {
        routes[spoke] = [...hubNames];
      }
      break;
    }

    case 'ring': {
      for (let i = 0; i < allNames.length; i++) {
        const name = allNames[i]!;
        const next = allNames[(i + 1) % allNames.length]!;
        const prev = allNames[(i - 1 + allNames.length) % allNames.length]!;
        const targets: string[] = [];
        if (next !== name) targets.push(next);
        if (prev !== name && prev !== next) targets.push(prev);
        routes[name] = targets;
      }
      break;
    }

    case 'custom': {
      if (topology.routes) {
        for (const route of topology.routes) {
          const fromNames = cellNamesForTemplate(route.from, cells);
          const froms = fromNames.length > 0 ? fromNames : [route.from];

          const toNames: string[] = [];
          for (const to of route.to) {
            const expanded = cellNamesForTemplate(to, cells);
            if (expanded.length > 0) {
              toNames.push(...expanded);
            } else {
              toNames.push(to);
            }
          }

          for (const from of froms) {
            if (routes[from]) {
              routes[from] = [...new Set([...routes[from]!, ...toNames])];
            } else {
              routes[from] = toNames;
            }
          }
        }
      }
      break;
    }

    case 'stigmergy': {
      // No direct routes — communication only via blackboard
      break;
    }
  }

  return routes;
}

/**
 * Render a topology as an ASCII graph suitable for terminal display.
 *
 * Output format:
 *   cellName    ──→ target1
 *               ──→ target2
 *   otherCell   ──→ target3
 *
 * For stigmergy (no direct routes):
 *   (stigmergy — communication via blackboard only)
 */
export function renderTopology(
  topology: TopologySpec,
  cells: CellTemplate[],
): string {
  const routes = generateRouteTable(topology, cells);
  const allNames = expandCellNames(cells);
  const lines: string[] = [];

  // Header
  lines.push(`Topology: ${topology.type}`);
  lines.push('');

  if (topology.type === 'stigmergy') {
    lines.push('  (stigmergy — communication via blackboard only)');
    if (topology.blackboard) {
      lines.push(`  Blackboard decay: ${topology.blackboard.decayMinutes} minutes`);
    }
    return lines.join('\n');
  }

  // Find max cell name length for alignment
  const maxNameLen = Math.max(...allNames.map((n) => n.length));

  for (const name of allNames) {
    const targets = routes[name] ?? [];
    if (targets.length === 0) {
      lines.push(`  ${name.padEnd(maxNameLen)}  (no routes)`);
    } else {
      // First target on the same line as the cell name
      lines.push(`  ${name.padEnd(maxNameLen)} ──→ ${targets[0]}`);
      // Subsequent targets indented
      for (let i = 1; i < targets.length; i++) {
        lines.push(`  ${' '.repeat(maxNameLen)} ──→ ${targets[i]}`);
      }
    }
  }

  return lines.join('\n');
}
