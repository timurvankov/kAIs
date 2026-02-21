/**
 * API client for the kAIs dashboard.
 * Uses relative URLs — Vite proxy forwards /api to the kAIs API server.
 */

const BASE = '/api/v1';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('kais_token');
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (init?.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ---------- Types ----------

export interface BudgetBalance {
  cellId: string;
  allocated: number;
  spent: number;
  delegated: number;
  available: number;
}

export interface BudgetTreeNode {
  cellId: string;
  balance: BudgetBalance;
  children: BudgetTreeNode[];
}

export interface CellTreeNode {
  cellId: string;
  parentId: string | null;
  rootId: string;
  depth: number;
  path: string;
  descendantCount: number;
  namespace: string;
}

export interface SpawnRequest {
  id: number;
  name: string;
  namespace: string;
  requestorCellId: string;
  requestedSpec: {
    name: string;
    systemPrompt: string;
    model?: string;
    provider?: string;
    tools?: string[];
    budget?: number;
    canSpawnChildren?: boolean;
    maxDepth?: number;
  };
  reason?: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  decidedBy?: string;
  decidedAt?: string;
  rejectionReason?: string;
  createdAt: string;
}

export interface Role {
  name: string;
  namespace?: string;
  spec: {
    rules: Array<{
      resources: string[];
      verbs: string[];
      maxAllocation?: number;
    }>;
  };
}

export interface AuthUser {
  name: string;
  roles: string[];
}

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  namespace: string;
  outcome: string;
  statusCode: number;
  timestamp: string;
}

// ---------- Tree ----------

export async function fetchCellTree(cellId: string) {
  return fetchJson<{ root: string; nodes: CellTreeNode[] }>(
    `${BASE}/tree/${encodeURIComponent(cellId)}`,
  );
}

export async function fetchCellAncestors(cellId: string) {
  return fetchJson<{ ancestors: CellTreeNode[] }>(
    `${BASE}/tree/${encodeURIComponent(cellId)}/ancestors`,
  );
}

// ---------- Budget ----------

export async function fetchBudget(cellId: string) {
  return fetchJson<BudgetBalance>(`${BASE}/budgets/${encodeURIComponent(cellId)}`);
}

export async function fetchBudgetTree(cellId: string) {
  return fetchJson<{ tree: BudgetTreeNode[] }>(
    `${BASE}/budgets/${encodeURIComponent(cellId)}/tree`,
  );
}

export async function topUpBudget(parentCellId: string, childCellId: string, amount: number) {
  return fetchJson<{ ok: boolean }>(
    `${BASE}/budgets/${encodeURIComponent(parentCellId)}/top-up`,
    {
      method: 'POST',
      body: JSON.stringify({ childCellId, amount }),
    },
  );
}

// ---------- Spawn Requests ----------

export async function fetchSpawnRequests(opts?: { status?: string; namespace?: string }) {
  const params = new URLSearchParams();
  if (opts?.status) params.set('status', opts.status);
  if (opts?.namespace) params.set('namespace', opts.namespace);
  return fetchJson<{ requests: SpawnRequest[] }>(
    `${BASE}/spawn-requests?${params.toString()}`,
  );
}

export async function approveSpawnRequest(id: number) {
  return fetchJson<SpawnRequest>(`${BASE}/spawn-requests/${id}/approve`, {
    method: 'POST',
  });
}

export async function rejectSpawnRequest(id: number, reason?: string) {
  return fetchJson<SpawnRequest>(`${BASE}/spawn-requests/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

// ---------- RBAC ----------

export async function fetchRoles() {
  return fetchJson<{ roles: Role[] }>(`${BASE}/roles`);
}

export async function fetchRole(name: string) {
  return fetchJson<Role>(`${BASE}/roles/${encodeURIComponent(name)}`);
}

export async function fetchWhoami() {
  return fetchJson<{ user: AuthUser | null }>(`${BASE}/auth/whoami`);
}

// ---------- Audit Log ----------

export async function fetchAuditLog(opts?: {
  actor?: string;
  action?: string;
  resourceType?: string;
  namespace?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (opts?.actor) params.set('actor', opts.actor);
  if (opts?.action) params.set('action', opts.action);
  if (opts?.resourceType) params.set('resourceType', opts.resourceType);
  if (opts?.namespace) params.set('namespace', opts.namespace);
  if (opts?.limit) params.set('limit', String(opts.limit));
  return fetchJson<{ entries: AuditEntry[]; total: number }>(
    `${BASE}/audit-log?${params.toString()}`,
  );
}
