/**
 * HTTP client for the kAIs API server.
 * The MCP Gateway delegates all operations to kais-api.
 */

export interface KaisClientOptions {
  /** Base URL of the kAIs API (e.g. http://localhost:8080). */
  baseUrl: string;
  /** Bearer token for authentication. */
  authToken?: string;
}

export interface LaunchTeamParams {
  blueprint: string;
  objective: string;
  budget?: number;
  params?: Record<string, unknown>;
  namespace?: string;
}

export interface LaunchTeamResult {
  missionId: string;
  formationId: string;
  namespace: string;
}

export interface MissionStatusResult {
  phase: string;
  attempt: number;
  cost: number;
  checks?: Array<{ name: string; status: string }>;
  message?: string;
}

export interface RecallResult {
  facts: Array<{
    id: string;
    content: string;
    scope: string;
    confidence: number;
  }>;
}

export interface BlueprintSummary {
  name: string;
  description: string;
  namespace?: string;
}

export interface MissionResult {
  phase: string;
  artifacts: Array<{
    path: string;
    type: string;
  }>;
  summary?: string;
  cost: number;
}

/**
 * Thin HTTP client wrapping kais-api endpoints.
 * Designed to be easily testable with a mock or stub.
 */
export class KaisClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(opts: KaisClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
    };
    if (opts.authToken) {
      this.headers['Authorization'] = `Bearer ${opts.authToken}`;
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const resp = await fetch(url, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`kAIs API ${method} ${path} failed (${resp.status}): ${text}`);
    }

    return resp.json() as Promise<T>;
  }

  /**
   * Launch a team from a Blueprint.
   * Creates a Formation + Mission via the API.
   */
  async launchTeam(params: LaunchTeamParams): Promise<LaunchTeamResult> {
    const namespace = params.namespace ?? 'default';
    return this.request<LaunchTeamResult>('POST', `/api/v1/teams/launch`, {
      blueprint: params.blueprint,
      objective: params.objective,
      budget: params.budget,
      params: params.params,
      namespace,
    });
  }

  /**
   * Get mission status.
   */
  async getMissionStatus(mission: string, namespace?: string): Promise<MissionStatusResult> {
    const ns = namespace ?? 'default';
    return this.request<MissionStatusResult>('GET', `/api/v1/missions/${encodeURIComponent(mission)}/status?namespace=${encodeURIComponent(ns)}`);
  }

  /**
   * Search the knowledge graph.
   */
  async recall(query: string, scope?: string): Promise<RecallResult> {
    return this.request<RecallResult>('POST', `/api/v1/knowledge/search`, {
      query,
      scope: scope ?? 'platform',
    });
  }

  /**
   * List available blueprints.
   */
  async listBlueprints(namespace?: string): Promise<BlueprintSummary[]> {
    const ns = namespace ?? 'default';
    return this.request<BlueprintSummary[]>('GET', `/api/v1/blueprints?namespace=${encodeURIComponent(ns)}`);
  }

  /**
   * Send a message to a running Cell.
   */
  async sendMessage(cell: string, message: string, namespace?: string): Promise<{ ok: boolean; messageId: string }> {
    const ns = namespace ?? 'default';
    return this.request<{ ok: boolean; messageId: string }>('POST', `/api/v1/cells/${encodeURIComponent(cell)}/exec`, {
      message,
      namespace: ns,
    });
  }

  /**
   * Get results from a completed mission.
   */
  async getResults(mission: string, namespace?: string): Promise<MissionResult> {
    const ns = namespace ?? 'default';
    return this.request<MissionResult>('GET', `/api/v1/missions/${encodeURIComponent(mission)}/results?namespace=${encodeURIComponent(ns)}`);
  }
}
