import { describe, it, expect, beforeEach } from 'vitest';
import type { DbClient, DbQueryResult } from '../clients.js';
import { createCellTree, type CellTreeService } from '../cell-tree.js';

/**
 * In-memory Postgres mock for cell_tree table.
 */
function createMockDb(): DbClient {
  const nodes = new Map<string, {
    cell_id: string;
    parent_id: string | null;
    root_id: string;
    depth: number;
    path: string;
    descendant_count: number;
    namespace: string;
  }>();

  return {
    async query(text: string, params?: unknown[]): Promise<DbQueryResult> {
      // INSERT INTO cell_tree ... ON CONFLICT DO NOTHING
      if (text.includes('INSERT INTO cell_tree') && text.includes('ON CONFLICT')) {
        const cellId = params![0] as string;
        if (!nodes.has(cellId)) {
          // insertRoot uses 2 params: ($1=cellId, $2=namespace)
          // insertChild uses 6 params: ($1=cellId, $2=parentId, $3=rootId, $4=depth, $5=path, $6=namespace)
          const isRoot = params!.length === 2;
          nodes.set(cellId, {
            cell_id: cellId,
            parent_id: isRoot ? null : (params![1] as string | null),
            root_id: isRoot ? cellId : (params![2] as string),
            depth: isRoot ? 0 : (params![3] as number),
            path: isRoot ? cellId : (params![4] as string),
            descendant_count: 0,
            namespace: isRoot ? (params![1] as string) : (params![5] as string),
          });
        }
        return { rows: [] };
      }

      // SELECT root_id, depth, path FROM cell_tree WHERE cell_id = $1
      if (text.includes('SELECT root_id, depth, path FROM cell_tree')) {
        const cellId = params![0] as string;
        const node = nodes.get(cellId);
        if (!node) return { rows: [] };
        return { rows: [{ root_id: node.root_id, depth: node.depth, path: node.path }] };
      }

      // UPDATE cell_tree SET descendant_count = descendant_count + 1 WHERE ... LIKE ... OR cell_id = $2
      if (text.includes('descendant_count = descendant_count + 1')) {
        const childPath = params![0] as string;
        const parentId = params![1] as string;
        for (const node of nodes.values()) {
          if (childPath.startsWith(node.path + '/') || node.cell_id === parentId) {
            node.descendant_count++;
          }
        }
        return { rows: [] };
      }

      // UPDATE cell_tree SET descendant_count = GREATEST(descendant_count - $1, 0) WHERE cell_id = ANY($2)
      if (text.includes('GREATEST(descendant_count -')) {
        const count = params![0] as number;
        const cellIds = params![1] as string[];
        for (const id of cellIds) {
          const node = nodes.get(id);
          if (node) node.descendant_count = Math.max(node.descendant_count - count, 0);
        }
        return { rows: [] };
      }

      // SELECT depth FROM cell_tree WHERE cell_id = $1
      if (text.includes('SELECT depth FROM cell_tree')) {
        const cellId = params![0] as string;
        const node = nodes.get(cellId);
        if (!node) return { rows: [] };
        return { rows: [{ depth: node.depth }] };
      }

      // SELECT descendant_count FROM cell_tree WHERE cell_id = $1
      if (text.includes('SELECT descendant_count FROM cell_tree')) {
        const cellId = params![0] as string;
        const node = nodes.get(cellId);
        if (!node) return { rows: [] };
        return { rows: [{ descendant_count: node.descendant_count }] };
      }

      // SELECT path FROM cell_tree WHERE cell_id = $1
      if (text.includes('SELECT path FROM cell_tree WHERE cell_id')) {
        const cellId = params![0] as string;
        const node = nodes.get(cellId);
        if (!node) return { rows: [] };
        return { rows: [{ path: node.path }] };
      }

      // SELECT * FROM cell_tree WHERE cell_id = ANY($1) ORDER BY depth ASC
      if (text.includes('cell_id = ANY($1)') && text.includes('ORDER BY depth ASC')) {
        const cellIds = params![0] as string[];
        const results = cellIds
          .map(id => nodes.get(id))
          .filter(Boolean)
          .sort((a, b) => a!.depth - b!.depth);
        return { rows: results as Record<string, unknown>[] };
      }

      // SELECT * FROM cell_tree WHERE cell_id = $1
      if (text.includes('SELECT * FROM cell_tree WHERE cell_id = $1')) {
        const cellId = params![0] as string;
        const node = nodes.get(cellId);
        if (!node) return { rows: [] };
        return { rows: [node as unknown as Record<string, unknown>] };
      }

      // SELECT * FROM cell_tree WHERE root_id = $1 ORDER BY depth
      if (text.includes('WHERE root_id = $1') && text.includes('ORDER BY depth')) {
        const rootId = params![0] as string;
        const results = Array.from(nodes.values())
          .filter(n => n.root_id === rootId)
          .sort((a, b) => a.depth - b.depth || a.cell_id.localeCompare(b.cell_id));
        return { rows: results as unknown as Record<string, unknown>[] };
      }

      // SELECT parent_id, path, descendant_count FROM cell_tree WHERE cell_id = $1
      if (text.includes('parent_id, path, descendant_count')) {
        const cellId = params![0] as string;
        const node = nodes.get(cellId);
        if (!node) return { rows: [] };
        return { rows: [{ parent_id: node.parent_id, path: node.path, descendant_count: node.descendant_count }] };
      }

      // DELETE FROM cell_tree WHERE cell_id = $1
      if (text.includes('DELETE FROM cell_tree')) {
        const cellId = params![0] as string;
        // Also delete descendants (simulating CASCADE)
        const node = nodes.get(cellId);
        if (node) {
          const prefix = node.path + '/';
          for (const [id, n] of nodes.entries()) {
            if (n.path.startsWith(prefix)) {
              nodes.delete(id);
            }
          }
          nodes.delete(cellId);
        }
        return { rows: [] };
      }

      // WITH RECURSIVE subtree ... COUNT
      if (text.includes('WITH RECURSIVE subtree')) {
        const cellId = params![0] as string;
        let count = 0;
        const countChildren = (parentId: string) => {
          for (const node of nodes.values()) {
            if (node.parent_id === parentId) {
              count++;
              countChildren(node.cell_id);
            }
          }
        };
        countChildren(cellId);
        return { rows: [{ cnt: String(count) }] };
      }

      // UPDATE cell_tree SET descendant_count = $2
      if (text.includes('UPDATE cell_tree SET descendant_count = $2')) {
        const cellId = params![0] as string;
        const count = params![1] as number;
        const node = nodes.get(cellId);
        if (node) node.descendant_count = count;
        return { rows: [] };
      }

      return { rows: [] };
    },
  };
}

describe('CellTree', () => {
  let db: DbClient;
  let tree: CellTreeService;

  beforeEach(() => {
    db = createMockDb();
    tree = createCellTree(db);
  });

  describe('insertRoot', () => {
    it('should insert a root cell with depth 0', async () => {
      await tree.insertRoot('root-cell', 'default');
      const node = await tree.getNode('root-cell');
      expect(node).not.toBeNull();
      expect(node!.depth).toBe(0);
      expect(node!.path).toBe('root-cell');
      expect(node!.rootId).toBe('root-cell');
      expect(node!.parentId).toBeNull();
    });
  });

  describe('insertChild', () => {
    it('should insert a child at depth 1', async () => {
      await tree.insertRoot('root', 'default');
      await tree.insertChild('child-a', 'root', 'default');

      const node = await tree.getNode('child-a');
      expect(node).not.toBeNull();
      expect(node!.depth).toBe(1);
      expect(node!.path).toBe('root/child-a');
      expect(node!.rootId).toBe('root');
      expect(node!.parentId).toBe('root');
    });

    it('should insert a grandchild at depth 2', async () => {
      await tree.insertRoot('root', 'default');
      await tree.insertChild('child', 'root', 'default');
      await tree.insertChild('grandchild', 'child', 'default');

      const node = await tree.getNode('grandchild');
      expect(node!.depth).toBe(2);
      expect(node!.path).toBe('root/child/grandchild');
      expect(node!.rootId).toBe('root');
    });

    it('should increment ancestor descendant counts', async () => {
      await tree.insertRoot('root', 'default');
      await tree.insertChild('child', 'root', 'default');

      const rootNode = await tree.getNode('root');
      expect(rootNode!.descendantCount).toBe(1);

      await tree.insertChild('grandchild', 'child', 'default');

      const rootAfter = await tree.getNode('root');
      expect(rootAfter!.descendantCount).toBe(2);
    });

    it('should throw for non-existent parent', async () => {
      await expect(tree.insertChild('child', 'nonexistent', 'default')).rejects.toThrow('not found');
    });
  });

  describe('getDepth', () => {
    it('should return 0 for root', async () => {
      await tree.insertRoot('root', 'default');
      expect(await tree.getDepth('root')).toBe(0);
    });

    it('should return correct depth for nested nodes', async () => {
      await tree.insertRoot('root', 'default');
      await tree.insertChild('l1', 'root', 'default');
      await tree.insertChild('l2', 'l1', 'default');
      await tree.insertChild('l3', 'l2', 'default');

      expect(await tree.getDepth('l1')).toBe(1);
      expect(await tree.getDepth('l2')).toBe(2);
      expect(await tree.getDepth('l3')).toBe(3);
    });
  });

  describe('countDescendants', () => {
    it('should return 0 for leaf node', async () => {
      await tree.insertRoot('root', 'default');
      expect(await tree.countDescendants('root')).toBe(0);
    });

    it('should count all descendants', async () => {
      await tree.insertRoot('root', 'default');
      await tree.insertChild('child-a', 'root', 'default');
      await tree.insertChild('child-b', 'root', 'default');
      await tree.insertChild('grandchild', 'child-a', 'default');

      expect(await tree.countDescendants('root')).toBe(3);
      expect(await tree.countDescendants('child-a')).toBe(1);
      expect(await tree.countDescendants('child-b')).toBe(0);
    });
  });

  describe('getAncestors', () => {
    it('should return empty for root', async () => {
      await tree.insertRoot('root', 'default');
      const ancestors = await tree.getAncestors('root');
      expect(ancestors).toHaveLength(0);
    });

    it('should return ancestor chain', async () => {
      await tree.insertRoot('root', 'default');
      await tree.insertChild('l1', 'root', 'default');
      await tree.insertChild('l2', 'l1', 'default');

      const ancestors = await tree.getAncestors('l2');
      expect(ancestors).toHaveLength(2);
      expect(ancestors[0]!.cellId).toBe('root');
      expect(ancestors[1]!.cellId).toBe('l1');
    });
  });

  describe('getTree', () => {
    it('should return all nodes for a root', async () => {
      await tree.insertRoot('root', 'default');
      await tree.insertChild('a', 'root', 'default');
      await tree.insertChild('b', 'root', 'default');
      await tree.insertChild('a1', 'a', 'default');

      const nodes = await tree.getTree('root');
      expect(nodes).toHaveLength(4);
      expect(nodes[0]!.cellId).toBe('root');
    });
  });

  describe('remove', () => {
    it('should remove a leaf node', async () => {
      await tree.insertRoot('root', 'default');
      await tree.insertChild('leaf', 'root', 'default');

      await tree.remove('leaf');
      const node = await tree.getNode('leaf');
      expect(node).toBeNull();
    });

    it('should cascade delete children', async () => {
      await tree.insertRoot('root', 'default');
      await tree.insertChild('parent', 'root', 'default');
      await tree.insertChild('child', 'parent', 'default');

      await tree.remove('parent');
      expect(await tree.getNode('parent')).toBeNull();
      expect(await tree.getNode('child')).toBeNull();
    });
  });

  describe('refreshDescendantCounts', () => {
    it('should recompute descendant count', async () => {
      await tree.insertRoot('root', 'default');
      await tree.insertChild('a', 'root', 'default');
      await tree.insertChild('b', 'root', 'default');

      await tree.refreshDescendantCounts('root');
      const rootNode = await tree.getNode('root');
      expect(rootNode!.descendantCount).toBe(2);
    });
  });
});
