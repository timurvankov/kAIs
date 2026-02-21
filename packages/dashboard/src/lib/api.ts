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

// ---------- Formations ----------

export interface FormationCellStatus {
  name: string;
  phase: string;
  cost: number;
}

export interface TopologySpec {
  type: string;
  root?: string;
  hub?: string;
  routes?: Array<{ from: string; to: string[]; protocol?: string }>;
  broadcast?: { enabled: boolean; from: string[] };
  blackboard?: { decayMinutes: number };
}

export interface FormationBudget {
  maxTotalCost?: number;
  maxCostPerHour?: number;
  allocation?: Record<string, string>;
}

export interface CellTemplate {
  name: string;
  replicas: number;
  spec: {
    mind: { provider: string; model: string; systemPrompt: string };
    tools?: Array<{ name: string }>;
    resources?: Record<string, unknown>;
  };
}

export interface Formation {
  name: string;
  namespace: string;
  spec: {
    cells: CellTemplate[];
    topology: TopologySpec;
    budget?: FormationBudget;
  };
  status: {
    phase: string;
    readyCells: number;
    totalCells: number;
    totalCost: number;
    cells?: FormationCellStatus[];
    message?: string;
  };
}

export async function fetchFormations(opts?: { namespace?: string }) {
  const params = new URLSearchParams();
  if (opts?.namespace) params.set('namespace', opts.namespace);
  return fetchJson<{ formations: Formation[] }>(
    `${BASE}/formations?${params.toString()}`,
  );
}

export async function fetchFormation(name: string, namespace?: string) {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  return fetchJson<Formation>(
    `${BASE}/formations/${encodeURIComponent(name)}?${params.toString()}`,
  );
}

// ---------- Missions ----------

export interface MissionCheckResult {
  name: string;
  status: string;
}

export interface MissionHistoryEntry {
  attempt: number;
  startedAt: string;
  result: string;
}

export interface Mission {
  name: string;
  namespace: string;
  spec: {
    formationRef?: string;
    cellRef?: string;
    objective: string;
    completion: {
      checks: Array<{ name: string; type: string }>;
      maxAttempts: number;
      timeout: string;
    };
    entrypoint: { cell: string; message: string };
    budget?: { maxCost: number };
  };
  status: {
    phase: string;
    attempt: number;
    startedAt?: string;
    cost: number;
    checks?: MissionCheckResult[];
    history?: MissionHistoryEntry[];
    message?: string;
  };
}

export async function fetchMissions(opts?: { namespace?: string }) {
  const params = new URLSearchParams();
  if (opts?.namespace) params.set('namespace', opts.namespace);
  return fetchJson<{ missions: Mission[] }>(
    `${BASE}/missions?${params.toString()}`,
  );
}

export async function fetchMission(name: string, namespace?: string) {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  return fetchJson<Mission>(
    `${BASE}/missions/${encodeURIComponent(name)}?${params.toString()}`,
  );
}

// ---------- Experiments ----------

export interface ExperimentRun {
  id: string;
  variables: Record<string, unknown>;
  repeat: number;
  phase: string;
  cost?: number;
}

export interface Experiment {
  name: string;
  namespace: string;
  spec: {
    variables: Array<{ name: string; values: unknown[] }>;
    repeats: number;
    metrics: Array<{ name: string; type: string; description?: string }>;
    runtime: string;
    budget: { maxTotalCost: number; abortOnOverBudget: boolean };
    parallel: number;
  };
  status: {
    phase: string;
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    estimatedCost?: number;
    actualCost: number;
    estimatedTimeRemaining?: string;
    currentRuns?: ExperimentRun[];
    analysis?: unknown;
    message?: string;
    suggestions?: string[];
  };
}

export async function fetchExperiments(opts?: { namespace?: string }) {
  const params = new URLSearchParams();
  if (opts?.namespace) params.set('namespace', opts.namespace);
  return fetchJson<{ experiments: Experiment[] }>(
    `${BASE}/experiments?${params.toString()}`,
  );
}

export async function fetchExperiment(name: string, namespace?: string) {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  return fetchJson<Experiment>(
    `${BASE}/experiments/${encodeURIComponent(name)}?${params.toString()}`,
  );
}

// ---------- Blueprints ----------

export interface BlueprintParameter {
  name: string;
  type: string;
  default?: unknown;
  description?: string;
  values?: unknown[];
  min?: number;
  max?: number;
}

export interface BlueprintEvidence {
  experiments?: Array<{ name: string; finding: string }>;
  successRate?: number;
  avgCompletionTime?: number;
  avgCost?: number;
}

export interface BlueprintVersion {
  version: number;
  createdAt: string;
  changes?: string;
}

export interface Blueprint {
  name: string;
  namespace: string;
  spec: {
    description?: string;
    parameters: BlueprintParameter[];
    formation: unknown;
    mission?: unknown;
    evidence?: BlueprintEvidence;
  };
  status: {
    usageCount: number;
    lastUsed?: string;
    avgSuccessRate?: number;
    versions?: BlueprintVersion[];
  };
}

export async function fetchBlueprints(opts?: { namespace?: string }) {
  const params = new URLSearchParams();
  if (opts?.namespace) params.set('namespace', opts.namespace);
  return fetchJson<{ blueprints: Blueprint[] }>(
    `${BASE}/blueprints?${params.toString()}`,
  );
}

export async function fetchBlueprint(name: string, namespace?: string) {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  return fetchJson<Blueprint>(
    `${BASE}/blueprints/${encodeURIComponent(name)}?${params.toString()}`,
  );
}

// ---------- Knowledge ----------

export interface Fact {
  id: string;
  content: string;
  scope: {
    level: string;
    realmId?: string;
    formationId?: string;
    cellId?: string;
  };
  source: {
    type: string;
    missionId?: string;
    experimentId?: string;
  };
  confidence: number;
  validFrom: string;
  validUntil?: string;
  tags: string[];
}

export async function searchKnowledge(opts: {
  query: string;
  scope?: string;
  maxResults?: number;
  minConfidence?: number;
  tags?: string[];
}) {
  return fetchJson<{ facts: Fact[] }>(`${BASE}/knowledge/search`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

// ---------- Evolution ----------

export interface EvolutionIndividual {
  id: string;
  genes: Record<string, unknown>;
  fitness?: number;
  generation: number;
}

export interface Evolution {
  name: string;
  namespace: string;
  spec: {
    populationSize: number;
    selection: string;
    crossover: string;
    mutation: { rate: number; perGene: boolean };
    elitism: number;
    stopping: {
      maxGenerations: number;
      stagnationLimit?: number;
      fitnessThreshold?: number;
      budgetLimit?: number;
    };
    genes: Array<{
      name: string;
      type: string;
      values?: unknown[];
      min?: number;
      max?: number;
    }>;
    fitness: { metrics: string[]; weights?: Record<string, number> };
    runtime: string;
    budget: { maxTotalCost: number; abortOnOverBudget: boolean };
    parallel: number;
  };
  status: {
    phase: string;
    generation: number;
    bestFitness?: number;
    bestIndividual?: EvolutionIndividual;
    populationSize: number;
    totalCost: number;
    geneImportance?: Record<string, number>;
    message?: string;
  };
}

export async function fetchEvolutions(opts?: { namespace?: string }) {
  const params = new URLSearchParams();
  if (opts?.namespace) params.set('namespace', opts.namespace);
  return fetchJson<{ evolutions: Evolution[] }>(
    `${BASE}/evolutions?${params.toString()}`,
  );
}

export async function fetchEvolution(name: string, namespace?: string) {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  return fetchJson<Evolution>(
    `${BASE}/evolutions/${encodeURIComponent(name)}?${params.toString()}`,
  );
}

// ---------- Swarms ----------

export interface SwarmScalingEvent {
  timestamp: string;
  fromReplicas: number;
  toReplicas: number;
  triggerValue?: number;
  reason?: string;
}

export interface Swarm {
  name: string;
  namespace: string;
  spec: {
    cellTemplate: string;
    formationRef: string;
    trigger: {
      type: string;
      threshold?: number;
      metricName?: string;
      schedule?: string;
      above?: number;
      below?: number;
    };
    scaling: {
      minReplicas: number;
      maxReplicas: number;
      step: number;
      cooldownSeconds: number;
      stabilizationSeconds: number;
    };
    budget?: { maxCostPerHour?: number };
    drainGracePeriodSeconds: number;
  };
  status: {
    phase: string;
    currentReplicas: number;
    desiredReplicas: number;
    lastScaleTime?: string;
    lastTriggerValue?: number;
    message?: string;
    history?: SwarmScalingEvent[];
  };
}

export async function fetchSwarms(opts?: { namespace?: string }) {
  const params = new URLSearchParams();
  if (opts?.namespace) params.set('namespace', opts.namespace);
  return fetchJson<{ swarms: Swarm[] }>(
    `${BASE}/swarms?${params.toString()}`,
  );
}

export async function fetchSwarm(name: string, namespace?: string) {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  return fetchJson<Swarm>(
    `${BASE}/swarms/${encodeURIComponent(name)}?${params.toString()}`,
  );
}

// ---------- Human Inbox (Phase 9) ----------

export interface HumanMessage {
  id: string;
  fromCell: string;
  namespace: string;
  content: string;
  context?: string;
  priority: string;
  status: 'pending' | 'replied' | 'expired';
  createdAt: string;
  repliedAt?: string;
  reply?: string;
  escalation?: {
    timeoutMinutes: number;
    action: string;
  };
}

export async function fetchHumanMessages(opts?: { status?: string }) {
  const params = new URLSearchParams();
  if (opts?.status) params.set('status', opts.status);
  return fetchJson<{ messages: HumanMessage[] }>(
    `${BASE}/human/messages?${params.toString()}`,
  );
}

export async function replyToHumanMessage(id: string, reply: string) {
  return fetchJson<{ ok: boolean }>(
    `${BASE}/human/messages/${encodeURIComponent(id)}/reply`,
    {
      method: 'POST',
      body: JSON.stringify({ reply }),
    },
  );
}

// ---------- Marketplace (Phase 9) ----------

export interface MarketplaceBlueprint {
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  rating?: number;
  downloads: number;
  publishedAt: string;
}

export async function searchMarketplace(opts?: {
  query?: string;
  tags?: string[];
  sortBy?: string;
}) {
  const params = new URLSearchParams();
  if (opts?.query) params.set('q', opts.query);
  if (opts?.tags?.length) params.set('tags', opts.tags.join(','));
  if (opts?.sortBy) params.set('sortBy', opts.sortBy);
  return fetchJson<{ blueprints: MarketplaceBlueprint[] }>(
    `${BASE}/marketplace/blueprints?${params.toString()}`,
  );
}

export async function installMarketplaceBlueprint(name: string, version: string) {
  return fetchJson<{ ok: boolean }>(
    `${BASE}/marketplace/blueprints/${encodeURIComponent(name)}/install`,
    {
      method: 'POST',
      body: JSON.stringify({ version }),
    },
  );
}

// ---------- Federation (Phase 9) ----------

export interface FederationCluster {
  name: string;
  endpoint: string;
  labels?: Record<string, string>;
  capacity?: {
    maxCells: number;
    availableCells: number;
  };
  lastHeartbeat?: string;
}

export interface Federation {
  name: string;
  namespace: string;
  spec: {
    clusters: FederationCluster[];
    scheduling: {
      labelSelector?: Record<string, string>;
      strategy: string;
    };
    natsLeafnodePort: number;
  };
  status: {
    phase: string;
    readyClusters: number;
    totalClusters: number;
    scheduledCells: number;
    message?: string;
  };
}

export async function fetchFederations(opts?: { namespace?: string }) {
  const params = new URLSearchParams();
  if (opts?.namespace) params.set('namespace', opts.namespace);
  return fetchJson<{ federations: Federation[] }>(
    `${BASE}/federations?${params.toString()}`,
  );
}

export async function fetchFederation(name: string, namespace?: string) {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  return fetchJson<Federation>(
    `${BASE}/federations/${encodeURIComponent(name)}?${params.toString()}`,
  );
}

// ---------- Channels (Phase 9) ----------

export interface ChannelMessage {
  id: string;
  from: string;
  payload: unknown;
  timestamp: string;
}

export interface Channel {
  name: string;
  namespace: string;
  spec: {
    formations: string[];
    schema?: unknown;
    maxMessageSize: number;
    retentionMinutes: number;
  };
  status: {
    phase: string;
    messageCount: number;
    subscriberCount: number;
    lastMessageAt?: string;
  };
}

export async function fetchChannels(opts?: { namespace?: string }) {
  const params = new URLSearchParams();
  if (opts?.namespace) params.set('namespace', opts.namespace);
  return fetchJson<{ channels: Channel[] }>(
    `${BASE}/channels?${params.toString()}`,
  );
}

export async function fetchChannel(name: string, namespace?: string) {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  return fetchJson<Channel>(
    `${BASE}/channels/${encodeURIComponent(name)}?${params.toString()}`,
  );
}

export async function fetchChannelMessages(name: string, opts?: { namespace?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (opts?.namespace) params.set('namespace', opts.namespace);
  if (opts?.limit) params.set('limit', String(opts.limit));
  return fetchJson<{ messages: ChannelMessage[] }>(
    `${BASE}/channels/${encodeURIComponent(name)}/messages?${params.toString()}`,
  );
}
