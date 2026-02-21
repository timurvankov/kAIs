import type { A2AAgentCard } from './types.js';

export interface A2ATask {
  id: string;
  skill: string;
  input: unknown;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

/**
 * A2A (Agent-to-Agent) Gateway that exposes kAIs skills as A2A endpoints
 * and allows calling external A2A agents.
 */
export class A2AGateway {
  private agentCard: A2AAgentCard;
  private tasks = new Map<string, A2ATask>();
  private taskCounter = 0;

  constructor(card: A2AAgentCard) {
    this.agentCard = card;
  }

  getAgentCard(): A2AAgentCard {
    return this.agentCard;
  }

  async submitTask(skill: string, input: unknown): Promise<string> {
    const id = `task-${++this.taskCounter}`;
    this.tasks.set(id, {
      id, skill, input, status: 'pending',
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  async getTask(id: string): Promise<A2ATask | null> {
    return this.tasks.get(id) ?? null;
  }

  async completeTask(id: string, result: unknown): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'pending' && task.status !== 'running') return false;
    task.status = 'completed';
    task.result = result;
    task.completedAt = new Date().toISOString();
    return true;
  }

  async failTask(id: string, error: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.status = 'failed';
    task.error = error;
    task.completedAt = new Date().toISOString();
    return true;
  }

  listTasks(): A2ATask[] {
    return [...this.tasks.values()];
  }
}
