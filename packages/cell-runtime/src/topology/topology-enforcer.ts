/**
 * TopologyEnforcer — validates that a Cell can send messages to a target Cell
 * based on a route table loaded from a ConfigMap-mounted JSON file.
 *
 * If no route table file exists (standalone cell, not in a formation),
 * the enforcer allows all targets.
 */

const DEFAULT_ROUTE_TABLE_PATH = '/etc/kais/topology/routes.json';

export interface TopologyEnforcer {
  /** Check if this cell can send to the target cell */
  canSendTo(targetCell: string): boolean;
  /** Get list of allowed targets for this cell */
  getAllowedTargets(): string[];
}

export interface TopologyFs {
  readFile(path: string): Promise<string>;
}

/**
 * Create a TopologyEnforcer that loads the route table from a JSON file.
 *
 * Route table format:
 * ```json
 * {
 *   "architect-0": ["developer-0", "developer-1", "reviewer-0"],
 *   "developer-0": ["architect-0", "reviewer-0"]
 * }
 * ```
 *
 * If the route table file doesn't exist, all targets are allowed.
 */
export async function createTopologyEnforcer(
  cellName: string,
  routeTablePath?: string,
  fs?: TopologyFs,
): Promise<TopologyEnforcer> {
  const filePath = routeTablePath ?? DEFAULT_ROUTE_TABLE_PATH;
  let allowedTargets: string[] | null = null;

  try {
    const reader = fs ?? { readFile: defaultReadFile };
    const content = await reader.readFile(filePath);
    const routeTable = JSON.parse(content) as Record<string, unknown>;
    const targets = routeTable[cellName];
    if (targets !== undefined && Array.isArray(targets)) {
      allowedTargets = targets as string[];
    }
    // If cellName is not in the route table, no targets are allowed.
    // (A cell listed in the file but with no entry has no outbound routes.)
    if (allowedTargets === null) {
      allowedTargets = [];
    }
  } catch {
    // Route table file doesn't exist or is invalid — allow all targets.
    allowedTargets = null;
  }

  return {
    canSendTo(targetCell: string): boolean {
      // null = no route table loaded → allow all
      if (allowedTargets === null) {
        return true;
      }
      return allowedTargets.includes(targetCell);
    },
    getAllowedTargets(): string[] {
      // null = no route table → empty (conceptually "all", but we return [])
      if (allowedTargets === null) {
        return [];
      }
      return [...allowedTargets];
    },
  };
}

async function defaultReadFile(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(path, 'utf-8');
}
