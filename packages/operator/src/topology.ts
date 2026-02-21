import type * as k8s from '@kubernetes/client-node';
import type { CellTemplate, TopologySpec } from '@kais/core';

/**
 * Expand cell templates into a flat list of cell names.
 * For a template with name "researcher" and replicas 3, generates:
 *   ["researcher-0", "researcher-1", "researcher-2"]
 */
export function expandCellNames(cells: CellTemplate[]): string[] {
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
 * e.g. for template "researcher" with replicas 2 returns ["researcher-0", "researcher-1"]
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
 * Topology types:
 * - full_mesh: every cell can message every other cell
 * - hierarchy: root → children (root specified in topology.root; all non-root cells are children)
 * - star: hub → all spokes, all spokes → hub (hub specified in topology.hub)
 * - ring: each cell → next cell in the ring (bidirectional)
 * - custom: use topology.routes directly
 * - stigmergy: no direct routes (communication via blackboard only)
 */
export function generateRouteTable(
  topology: TopologySpec,
  cells: CellTemplate[],
): Record<string, string[]> {
  const allNames = expandCellNames(cells);
  const routes: Record<string, string[]> = {};

  // Initialize empty routes for all cells
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
      // root can send to all children; children have no direct routes (except back to root)
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
      // hub can send to all spokes; all spokes can send to hub only
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
      // Each cell can send to next and previous in the ring
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
      // Use routes from topology spec directly, expanding template names to cell names
      if (topology.routes) {
        for (const route of topology.routes) {
          const fromNames = cellNamesForTemplate(route.from, cells);
          // If the from name doesn't match a template, try it as a direct cell name
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
 * Generate a K8s ConfigMap containing the topology route table.
 * The ConfigMap is mounted into each Cell Pod at /etc/kais/topology/routes.json.
 */
export function generateTopologyConfigMap(
  formationName: string,
  namespace: string,
  topology: TopologySpec,
  cells: CellTemplate[],
  ownerRef: { name: string; uid: string },
): k8s.V1ConfigMap {
  const routes = generateRouteTable(topology, cells);

  return {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: `topology-${formationName}`,
      namespace,
      ownerReferences: [
        {
          apiVersion: 'kais.io/v1',
          kind: 'Formation',
          name: ownerRef.name,
          uid: ownerRef.uid,
          controller: true,
          blockOwnerDeletion: true,
        },
      ],
    },
    data: {
      'routes.json': JSON.stringify(routes, null, 2),
    },
  };
}
