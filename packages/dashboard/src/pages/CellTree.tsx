import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCellTree, fetchBudgetTree, type CellTreeNode, type BudgetTreeNode } from '@/lib/api';

function BudgetBar({ spent, delegated, allocated }: { spent: number; delegated: number; allocated: number }) {
  if (allocated <= 0) return null;
  const spentPct = (spent / allocated) * 100;
  const delegatedPct = (delegated / allocated) * 100;
  return (
    <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden inline-flex ml-2" title={`$${spent.toFixed(2)} spent / $${delegated.toFixed(2)} delegated / $${allocated.toFixed(2)} total`}>
      <div className="bg-red-500 h-full" style={{ width: `${spentPct}%` }} />
      <div className="bg-yellow-500 h-full" style={{ width: `${delegatedPct}%` }} />
    </div>
  );
}

function TreeNode({
  node,
  budgetMap,
  expandedSet,
  onToggle,
}: {
  node: CellTreeNode;
  budgetMap: Map<string, BudgetTreeNode>;
  expandedSet: Set<string>;
  onToggle: (cellId: string) => void;
}) {
  const budget = budgetMap.get(node.cellId);
  const isExpanded = expandedSet.has(node.cellId);
  const hasChildren = node.descendantCount > 0;

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-800 cursor-pointer"
        onClick={() => hasChildren && onToggle(node.cellId)}
      >
        <span className="w-4 text-gray-500 text-xs">
          {hasChildren ? (isExpanded ? '\u25BC' : '\u25B6') : '\u00B7'}
        </span>
        <span className="font-mono text-sm text-blue-400">{node.cellId}</span>
        <span className="text-xs text-gray-500">[{node.namespace}]</span>
        <span className="text-xs text-gray-600">depth={node.depth}</span>
        {node.descendantCount > 0 && (
          <span className="text-xs text-gray-600">({node.descendantCount} desc)</span>
        )}
        {budget && (
          <>
            <span className="text-xs text-green-400 ml-auto">
              ${budget.balance.available.toFixed(2)} avail
            </span>
            <BudgetBar
              spent={budget.balance.spent}
              delegated={budget.balance.delegated}
              allocated={budget.balance.allocated}
            />
          </>
        )}
      </div>
    </div>
  );
}

function buildChildrenMap(nodes: CellTreeNode[]): Map<string | null, CellTreeNode[]> {
  const map = new Map<string | null, CellTreeNode[]>();
  for (const n of nodes) {
    const list = map.get(n.parentId) ?? [];
    list.push(n);
    map.set(n.parentId, list);
  }
  return map;
}

function flattenBudgetTree(node: BudgetTreeNode, map: Map<string, BudgetTreeNode>) {
  map.set(node.cellId, node);
  for (const child of node.children) {
    flattenBudgetTree(child, map);
  }
}

function RecursiveTree({
  parentId,
  childrenMap,
  budgetMap,
  expandedSet,
  onToggle,
  depth,
}: {
  parentId: string | null;
  childrenMap: Map<string | null, CellTreeNode[]>;
  budgetMap: Map<string, BudgetTreeNode>;
  expandedSet: Set<string>;
  onToggle: (cellId: string) => void;
  depth: number;
}) {
  const children = childrenMap.get(parentId) ?? [];
  if (children.length === 0) return null;

  return (
    <div style={{ marginLeft: depth > 0 ? 20 : 0 }}>
      {children.map((node) => (
        <div key={node.cellId}>
          <TreeNode
            node={node}
            budgetMap={budgetMap}
            expandedSet={expandedSet}
            onToggle={onToggle}
          />
          {expandedSet.has(node.cellId) && (
            <RecursiveTree
              parentId={node.cellId}
              childrenMap={childrenMap}
              budgetMap={budgetMap}
              expandedSet={expandedSet}
              onToggle={onToggle}
              depth={depth + 1}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function CellTree() {
  const [rootCellId, setRootCellId] = useState('');
  const [searchId, setSearchId] = useState('');

  const treeQuery = useQuery({
    queryKey: ['cellTree', searchId],
    queryFn: () => fetchCellTree(searchId),
    enabled: searchId.length > 0,
  });

  const budgetQuery = useQuery({
    queryKey: ['budgetTree', searchId],
    queryFn: () => fetchBudgetTree(searchId),
    enabled: searchId.length > 0,
  });

  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchId(rootCellId);
    setExpandedSet(new Set());
  };

  const onToggle = (cellId: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(cellId)) next.delete(cellId);
      else next.add(cellId);
      return next;
    });
  };

  const expandAll = () => {
    if (!treeQuery.data) return;
    setExpandedSet(new Set(treeQuery.data.nodes.map((n) => n.cellId)));
  };

  // Build budget lookup map
  const budgetMap = new Map<string, BudgetTreeNode>();
  if (budgetQuery.data) {
    for (const root of budgetQuery.data.tree) {
      flattenBudgetTree(root, budgetMap);
    }
  }

  // Build children map
  const childrenMap = treeQuery.data
    ? buildChildrenMap(treeQuery.data.nodes)
    : new Map();

  // Find roots (parentId === null)
  const rootParentId = treeQuery.data?.nodes.find((n) => n.parentId === null)?.parentId ?? null;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Cell Tree</h2>

      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          type="text"
          value={rootCellId}
          onChange={(e) => setRootCellId(e.target.value)}
          placeholder="Enter root cell ID..."
          className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white w-64 focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm"
        >
          Load Tree
        </button>
        {treeQuery.data && (
          <button
            type="button"
            onClick={expandAll}
            className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm"
          >
            Expand All
          </button>
        )}
      </form>

      {treeQuery.isLoading && <p className="text-gray-400">Loading tree...</p>}
      {treeQuery.error && (
        <p className="text-red-400">Error: {(treeQuery.error as Error).message}</p>
      )}

      {treeQuery.data && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-3">
            {treeQuery.data.nodes.length} nodes from root: {treeQuery.data.root}
          </div>
          <RecursiveTree
            parentId={rootParentId}
            childrenMap={childrenMap}
            budgetMap={budgetMap}
            expandedSet={expandedSet}
            onToggle={onToggle}
            depth={0}
          />
        </div>
      )}

      {budgetMap.size > 0 && (
        <div className="mt-4 text-xs text-gray-500 flex gap-4">
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 bg-red-500 rounded" /> Spent
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 bg-yellow-500 rounded" /> Delegated
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 bg-gray-700 rounded" /> Available
          </span>
        </div>
      )}
    </div>
  );
}
