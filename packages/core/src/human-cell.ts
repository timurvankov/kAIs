import type { HumanCellSpec } from './types.js';

export interface PendingMessage {
  id: string;
  from: string;
  content: string;
  receivedAt: string;
  respondedAt?: string;
  response?: string;
}

export interface HumanNotification {
  type: 'slack' | 'email' | 'dashboard';
  messageId: string;
  content: string;
  sentAt: string;
}

/**
 * Runtime for human-as-cell. Messages go to an inbox, human responds via dashboard/notifications.
 * Supports escalation: if human doesn't respond within timeout, fallback to LLM or skip.
 */
export class HumanCellRuntime {
  private inbox: PendingMessage[] = [];
  private notifications: HumanNotification[] = [];

  constructor(
    private readonly cellName: string,
    private readonly spec: HumanCellSpec,
  ) {}

  async receiveMessage(id: string, from: string, content: string): Promise<void> {
    this.inbox.push({ id, from, content, receivedAt: new Date().toISOString() });
    await this.sendNotifications(id, content);
  }

  async respond(messageId: string, response: string): Promise<boolean> {
    const msg = this.inbox.find(m => m.id === messageId);
    if (!msg || msg.respondedAt) return false;
    msg.response = response;
    msg.respondedAt = new Date().toISOString();
    return true;
  }

  getPending(): PendingMessage[] {
    return this.inbox.filter(m => !m.respondedAt);
  }

  getAll(): PendingMessage[] {
    return [...this.inbox];
  }

  async checkEscalation(): Promise<{ messageId: string; action: string }[]> {
    const escalations: { messageId: string; action: string }[] = [];
    const timeoutMs = (this.spec.escalation?.timeoutMinutes ?? 30) * 60 * 1000;
    const action = this.spec.escalation?.action ?? 'reminder';
    const now = Date.now();

    for (const msg of this.getPending()) {
      const age = now - new Date(msg.receivedAt).getTime();
      if (age > timeoutMs) {
        escalations.push({ messageId: msg.id, action });
      }
    }
    return escalations;
  }

  private async sendNotifications(messageId: string, content: string): Promise<void> {
    const notifSpec = this.spec.notifications;
    const now = new Date().toISOString();
    if (notifSpec.dashboard) {
      this.notifications.push({ type: 'dashboard', messageId, content, sentAt: now });
    }
    if (notifSpec.slack) {
      this.notifications.push({ type: 'slack', messageId, content, sentAt: now });
    }
    if (notifSpec.email) {
      this.notifications.push({ type: 'email', messageId, content, sentAt: now });
    }
  }

  getNotifications(): HumanNotification[] {
    return [...this.notifications];
  }
}
