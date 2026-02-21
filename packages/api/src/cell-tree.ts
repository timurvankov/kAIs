/**
 * CellTree — queryable cell hierarchy tracking.
 *
 * Supplements K8s ownerReferences with a Postgres-backed tree
 * using materialized paths for efficient ancestor/descendant queries.
 */
import type { CellTreeNode } from '@kais/core';

import type { DbClient } from './clients.js';

export interface CellTreeService {
  /** Insert a root Cell (no parent). */
  insertRoot(cellId: string, namespace: string): Promise<void>;
  /** Insert a child Cell under a parent. */
  insertChild(cellId: string, parentId: string, namespace: string): Promise<void>;
  /** Remove a Cell from the tree (children cascade via FK). */
  remove(cellId: string): Promise<void>;
  /** Get the depth of a Cell in the tree. */
  getDepth(cellId: string): Promise<number>;
  /** Count all descendants of a Cell (all levels). */
  countDescendants(cellId: string): Promise<number>;
  /** Get the ancestor chain from a Cell up to root. */
  getAncestors(cellId: string): Promise<CellTreeNode[]>;
  /** Get a single node. */
  getNode(cellId: string): Promise<CellTreeNode | null>;
  /** Get the full tree starting from a root Cell. */
  getTree(rootId: string): Promise<CellTreeNode[]>;
  /** Update descendant counts for a node and all ancestors. */
  refreshDescendantCounts(cellId: string): Promise<void>;
}

export function createCellTree(db: DbClient): CellTreeService {
  function rowToNode(row: Record<string, unknown>): CellTreeNode {
    return {
      cellId: row.cell_id as string,
      parentId: (row.parent_id as string) ?? null,
      rootId: row.root_id as string,
      depth: Number(row.depth),
      path: row.path as string,
      descendantCount: Number(row.descendant_count),
      namespace: row.namespace as string,
    };
  }

  return {
    async insertRoot(cellId: string, namespace: string): Promise<void> {
      await db.query(
        `INSERT INTO cell_tree (cell_id, parent_id, root_id, depth, path, descendant_count, namespace)
         VALUES ($1, NULL, $1, 0, $1, 0, $2)
         ON CONFLICT (cell_id) DO NOTHING`,
        [cellId, namespace],
      );
    },

    async insertChild(cellId: string, parentId: string, namespace: string): Promise<void> {
      // Get parent node to compute path and depth
      const parentResult = await db.query(
        'SELECT root_id, depth, path FROM cell_tree WHERE cell_id = $1',
        [parentId],
      );
      const parent = parentResult.rows[0] as
        | { root_id: string; depth: number; path: string }
        | undefined;

      if (!parent) {
        throw new Error(`Parent cell ${parentId} not found in cell tree`);
      }

      const childDepth = Number(parent.depth) + 1;
      const childPath = `${parent.path}/${cellId}`;

      await db.query(
        `INSERT INTO cell_tree (cell_id, parent_id, root_id, depth, path, descendant_count, namespace)
         VALUES ($1, $2, $3, $4, $5, 0, $6)
         ON CONFLICT (cell_id) DO NOTHING`,
        [cellId, parentId, parent.root_id, childDepth, childPath, namespace],
      );

      // Increment descendant counts for all ancestors
      await db.query(
        `UPDATE cell_tree SET descendant_count = descendant_count + 1
         WHERE $1 LIKE path || '/%' OR cell_id = $2`,
        [childPath, parentId],
      );
    },

    async remove(cellId: string): Promise<void> {
      // Get the node first so we can update ancestor counts
      const nodeResult = await db.query(
        'SELECT parent_id, path, descendant_count FROM cell_tree WHERE cell_id = $1',
        [cellId],
      );
      const node = nodeResult.rows[0] as
        | { parent_id: string | null; path: string; descendant_count: number }
        | undefined;

      if (!node) return;

      // Count nodes being removed (self + descendants)
      const removedCount = Number(node.descendant_count) + 1;

      // Decrement ancestor counts
      if (node.parent_id) {
        // Get all ancestors from the path
        const pathParts = (node.path as string).split('/');
        pathParts.pop(); // remove self
        if (pathParts.length > 0) {
          await db.query(
            `UPDATE cell_tree SET descendant_count = GREATEST(descendant_count - $1, 0)
             WHERE cell_id = ANY($2)`,
            [removedCount, pathParts],
          );
        }
      }

      // Delete node (children cascade via FK)
      await db.query('DELETE FROM cell_tree WHERE cell_id = $1', [cellId]);
    },

    async getDepth(cellId: string): Promise<number> {
      const result = await db.query(
        'SELECT depth FROM cell_tree WHERE cell_id = $1',
        [cellId],
      );
      const row = result.rows[0] as { depth: number } | undefined;
      return row ? Number(row.depth) : 0;
    },

    async countDescendants(cellId: string): Promise<number> {
      const result = await db.query(
        'SELECT descendant_count FROM cell_tree WHERE cell_id = $1',
        [cellId],
      );
      const row = result.rows[0] as { descendant_count: number } | undefined;
      return row ? Number(row.descendant_count) : 0;
    },

    async getAncestors(cellId: string): Promise<CellTreeNode[]> {
      // Get the path, then fetch all nodes in the path
      const nodeResult = await db.query(
        'SELECT path FROM cell_tree WHERE cell_id = $1',
        [cellId],
      );
      const node = nodeResult.rows[0] as { path: string } | undefined;
      if (!node) return [];

      const pathParts = (node.path as string).split('/');
      // Remove self from path
      pathParts.pop();

      if (pathParts.length === 0) return [];

      const result = await db.query(
        'SELECT * FROM cell_tree WHERE cell_id = ANY($1) ORDER BY depth ASC',
        [pathParts],
      );
      return result.rows.map(r => rowToNode(r));
    },

    async getNode(cellId: string): Promise<CellTreeNode | null> {
      const result = await db.query(
        'SELECT * FROM cell_tree WHERE cell_id = $1',
        [cellId],
      );
      if (result.rows.length === 0) return null;
      return rowToNode(result.rows[0]!);
    },

    async getTree(rootId: string): Promise<CellTreeNode[]> {
      const result = await db.query(
        'SELECT * FROM cell_tree WHERE root_id = $1 ORDER BY depth ASC, cell_id ASC',
        [rootId],
      );
      return result.rows.map(r => rowToNode(r));
    },

    async refreshDescendantCounts(cellId: string): Promise<void> {
      // Recompute descendant count from actual children
      const result = await db.query(
        `WITH RECURSIVE subtree AS (
           SELECT cell_id FROM cell_tree WHERE parent_id = $1
           UNION ALL
           SELECT ct.cell_id FROM cell_tree ct JOIN subtree s ON ct.parent_id = s.cell_id
         )
         SELECT COUNT(*) as cnt FROM subtree`,
        [cellId],
      );
      const count = Number((result.rows[0] as { cnt: string })?.cnt ?? '0');
      await db.query(
        'UPDATE cell_tree SET descendant_count = $2 WHERE cell_id = $1',
        [cellId, count],
      );
    },
  };
}
