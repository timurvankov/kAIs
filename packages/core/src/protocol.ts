/**
 * Protocol System — Formal state machines for Cell-to-Cell interactions.
 *
 * Protocols define structured communication patterns between Cells,
 * enforcing message ordering and allowed transitions.
 */

/** An action to execute on state entry. */
export interface ProtocolAction {
  type: 'notify' | 'timeout' | 'log';
  payload?: Record<string, unknown>;
}

/** A state in the protocol state machine. */
export interface ProtocolState {
  name: string;
  terminal?: boolean;
  onEnter?: ProtocolAction;
}

/** A transition between states, triggered by a message type from a specific role. */
export interface ProtocolTransition {
  from: string;
  to: string;
  trigger: string;
  role: string;
  guard?: string;
}

/** A protocol definition — a named state machine with roles and transitions. */
export interface Protocol {
  name: string;
  roles: string[];
  states: ProtocolState[];
  transitions: ProtocolTransition[];
  timeout: number;
}

/** Result of validating a message against the protocol. */
export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  protocolState?: string;
}

/** A live protocol session tracking current state and history. */
export class ProtocolSession {
  public currentState: string;
  public readonly history: Array<{ from: string; to: string; trigger: string; timestamp: number }> = [];
  private readonly startedAt: number;

  constructor(
    public readonly protocol: Protocol,
    public readonly fromCell: string,
    public readonly toCell: string,
  ) {
    // Find initial state (first non-terminal state, or first state)
    const initial = protocol.states.find((s) => !s.terminal) ?? protocol.states[0];
    if (!initial) throw new Error(`Protocol '${protocol.name}' has no states`);
    this.currentState = initial.name;
    this.startedAt = Date.now();
  }

  /** Find a valid transition for the given message type from the current state. */
  findTransition(trigger: string): ProtocolTransition | undefined {
    return this.protocol.transitions.find(
      (t) => t.from === this.currentState && t.trigger === trigger,
    );
  }

  /** Get all allowed transition triggers from the current state. */
  allowedTransitions(): string[] {
    return this.protocol.transitions
      .filter((t) => t.from === this.currentState)
      .map((t) => t.trigger);
  }

  /** Advance the session to the next state via a transition. */
  advance(transition: ProtocolTransition): void {
    this.history.push({
      from: transition.from,
      to: transition.to,
      trigger: transition.trigger,
      timestamp: Date.now(),
    });
    this.currentState = transition.to;
  }

  /** Check if the session is in a terminal state. */
  isComplete(): boolean {
    const state = this.protocol.states.find((s) => s.name === this.currentState);
    return state?.terminal === true;
  }

  /** Check if the session has exceeded its timeout. */
  isTimedOut(): boolean {
    return Date.now() - this.startedAt > this.protocol.timeout;
  }

  /** Serialize to JSON for persistence. */
  toJSON(): Record<string, unknown> {
    return {
      protocol: this.protocol.name,
      fromCell: this.fromCell,
      toCell: this.toCell,
      currentState: this.currentState,
      history: this.history,
    };
  }
}

/**
 * ProtocolEnforcer validates outgoing messages against protocol state machines.
 *
 * When a Cell sends a message, the enforcer checks if the message type
 * is allowed by the current protocol state. If not, the message is rejected
 * with an explanation of what transitions are allowed.
 */
export class ProtocolEnforcer {
  private sessions = new Map<string, ProtocolSession>();
  private protocols = new Map<string, Protocol>();

  /** Register a protocol definition. */
  registerProtocol(protocol: Protocol): void {
    this.protocols.set(protocol.name, protocol);
  }

  /** Get or create a session for a Cell-to-Cell route. */
  getOrCreateSession(
    fromCell: string,
    toCell: string,
    protocolName: string,
  ): ProtocolSession | undefined {
    const key = `${fromCell}->${toCell}`;
    let session = this.sessions.get(key);

    if (!session || session.isComplete()) {
      const protocol = this.protocols.get(protocolName);
      if (!protocol) return undefined;
      session = new ProtocolSession(protocol, fromCell, toCell);
      this.sessions.set(key, session);
    }

    return session;
  }

  /** Get an existing session (without creating). */
  getSession(fromCell: string, toCell: string): ProtocolSession | undefined {
    return this.sessions.get(`${fromCell}->${toCell}`);
  }

  /**
   * Validate whether a message is allowed by the protocol.
   *
   * @param fromCell - Sender cell name
   * @param toCell - Receiver cell name
   * @param messageType - The message type (e.g., 'propose', 'deliver')
   * @param protocolName - Optional protocol name for the route
   * @returns Validation result with allowed flag and reason
   */
  validateMessage(
    fromCell: string,
    toCell: string,
    messageType: string,
    protocolName?: string,
  ): ValidationResult {
    if (!protocolName) {
      // No protocol = free-form messaging
      return { allowed: true };
    }

    const session = this.getOrCreateSession(fromCell, toCell, protocolName);
    if (!session) {
      return { allowed: false, reason: `Unknown protocol '${protocolName}'` };
    }

    if (session.isTimedOut()) {
      return {
        allowed: false,
        reason: `Protocol '${protocolName}' session timed out`,
      };
    }

    const transition = session.findTransition(messageType);
    if (!transition) {
      const allowed = session.allowedTransitions();
      return {
        allowed: false,
        reason:
          `Protocol '${protocolName}' in state '${session.currentState}' ` +
          `does not allow message type '${messageType}'. ` +
          `Allowed: ${allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)'}`,
      };
    }

    session.advance(transition);
    return { allowed: true, protocolState: session.currentState };
  }

  /** Clear all sessions. */
  clearSessions(): void {
    this.sessions.clear();
  }

  /** Get all active (non-terminal) sessions. */
  getActiveSessions(): ProtocolSession[] {
    return [...this.sessions.values()].filter((s) => !s.isComplete());
  }
}

// --- Built-in Protocol Definitions ---

export const CONTRACT_PROTOCOL: Protocol = {
  name: 'contract',
  roles: ['requester', 'provider'],
  states: [
    { name: 'idle' },
    { name: 'proposed' },
    { name: 'negotiating' },
    { name: 'accepted' },
    { name: 'executing' },
    { name: 'delivered' },
    { name: 'evaluated', terminal: true },
    { name: 'rejected', terminal: true },
  ],
  transitions: [
    { from: 'idle', to: 'proposed', trigger: 'propose', role: 'requester' },
    { from: 'proposed', to: 'accepted', trigger: 'accept', role: 'provider' },
    { from: 'proposed', to: 'negotiating', trigger: 'negotiate', role: 'provider' },
    { from: 'proposed', to: 'rejected', trigger: 'reject', role: 'provider' },
    { from: 'negotiating', to: 'proposed', trigger: 'propose', role: 'requester' },
    { from: 'accepted', to: 'executing', trigger: 'confirm', role: 'requester' },
    { from: 'executing', to: 'delivered', trigger: 'deliver', role: 'provider' },
    { from: 'executing', to: 'executing', trigger: 'progress_update', role: 'provider' },
    { from: 'delivered', to: 'evaluated', trigger: 'evaluate', role: 'requester' },
  ],
  timeout: 600_000, // 10 minutes
};

export const DELIBERATION_PROTOCOL: Protocol = {
  name: 'deliberation',
  roles: ['facilitator', 'participant'],
  states: [
    { name: 'idle' },
    { name: 'proposing' },
    { name: 'discussing' },
    { name: 'voting' },
    { name: 'resolved', terminal: true },
  ],
  transitions: [
    { from: 'idle', to: 'proposing', trigger: 'propose', role: 'facilitator' },
    { from: 'proposing', to: 'discussing', trigger: 'open_discussion', role: 'facilitator' },
    { from: 'discussing', to: 'discussing', trigger: 'argument', role: 'participant' },
    { from: 'discussing', to: 'voting', trigger: 'call_vote', role: 'facilitator' },
    { from: 'voting', to: 'voting', trigger: 'vote', role: 'participant' },
    { from: 'voting', to: 'resolved', trigger: 'resolve', role: 'facilitator' },
  ],
  timeout: 300_000, // 5 minutes
};

export const AUCTION_PROTOCOL: Protocol = {
  name: 'auction',
  roles: ['auctioneer', 'bidder'],
  states: [
    { name: 'idle' },
    { name: 'announced' },
    { name: 'bidding' },
    { name: 'awarded', terminal: true },
  ],
  transitions: [
    { from: 'idle', to: 'announced', trigger: 'announce', role: 'auctioneer' },
    { from: 'announced', to: 'bidding', trigger: 'bid', role: 'bidder' },
    { from: 'bidding', to: 'bidding', trigger: 'bid', role: 'bidder' },
    { from: 'bidding', to: 'awarded', trigger: 'award', role: 'auctioneer' },
  ],
  timeout: 120_000, // 2 minutes
};
