import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProtocolSession,
  ProtocolEnforcer,
  CONTRACT_PROTOCOL,
  DELIBERATION_PROTOCOL,
  AUCTION_PROTOCOL,
  type Protocol,
} from '../protocol.js';

describe('ProtocolSession', () => {
  it('starts in the first non-terminal state', () => {
    const session = new ProtocolSession(CONTRACT_PROTOCOL, 'alice', 'bob');
    expect(session.currentState).toBe('idle');
  });

  it('advances state on valid transition', () => {
    const session = new ProtocolSession(CONTRACT_PROTOCOL, 'alice', 'bob');
    const t = session.findTransition('propose');
    expect(t).toBeDefined();
    session.advance(t!);
    expect(session.currentState).toBe('proposed');
  });

  it('records history on each advance', () => {
    const session = new ProtocolSession(CONTRACT_PROTOCOL, 'alice', 'bob');
    session.advance(session.findTransition('propose')!);
    session.advance(session.findTransition('accept')!);
    expect(session.history).toHaveLength(2);
    expect(session.history[0]!.trigger).toBe('propose');
    expect(session.history[1]!.trigger).toBe('accept');
  });

  it('returns undefined for invalid transition', () => {
    const session = new ProtocolSession(CONTRACT_PROTOCOL, 'alice', 'bob');
    const t = session.findTransition('deliver');
    expect(t).toBeUndefined();
  });

  it('lists allowed transitions from current state', () => {
    const session = new ProtocolSession(CONTRACT_PROTOCOL, 'alice', 'bob');
    expect(session.allowedTransitions()).toEqual(['propose']);
    session.advance(session.findTransition('propose')!);
    const allowed = session.allowedTransitions().sort();
    expect(allowed).toEqual(['accept', 'negotiate', 'reject']);
  });

  it('detects terminal state', () => {
    const session = new ProtocolSession(CONTRACT_PROTOCOL, 'alice', 'bob');
    expect(session.isComplete()).toBe(false);

    // Walk to terminal: idle → proposed → rejected
    session.advance(session.findTransition('propose')!);
    session.advance(session.findTransition('reject')!);
    expect(session.currentState).toBe('rejected');
    expect(session.isComplete()).toBe(true);
  });

  it('detects timeout', async () => {
    const shortProtocol: Protocol = {
      name: 'test',
      roles: ['a', 'b'],
      states: [{ name: 's1' }, { name: 's2', terminal: true }],
      transitions: [{ from: 's1', to: 's2', trigger: 'go', role: 'a' }],
      timeout: 10, // 10ms
    };
    const session = new ProtocolSession(shortProtocol, 'a', 'b');
    expect(session.isTimedOut()).toBe(false);
    await new Promise((r) => setTimeout(r, 15));
    expect(session.isTimedOut()).toBe(true);
  });

  it('serializes to JSON', () => {
    const session = new ProtocolSession(CONTRACT_PROTOCOL, 'alice', 'bob');
    session.advance(session.findTransition('propose')!);
    const json = session.toJSON();
    expect(json.protocol).toBe('contract');
    expect(json.fromCell).toBe('alice');
    expect(json.toCell).toBe('bob');
    expect(json.currentState).toBe('proposed');
    expect(json.history).toHaveLength(1);
  });
});

describe('ProtocolEnforcer', () => {
  let enforcer: ProtocolEnforcer;

  beforeEach(() => {
    enforcer = new ProtocolEnforcer();
    enforcer.registerProtocol(CONTRACT_PROTOCOL);
    enforcer.registerProtocol(DELIBERATION_PROTOCOL);
    enforcer.registerProtocol(AUCTION_PROTOCOL);
  });

  it('allows messages with no protocol (free-form)', () => {
    const result = enforcer.validateMessage('alice', 'bob', 'anything');
    expect(result.allowed).toBe(true);
  });

  it('allows valid transitions and returns new state', () => {
    const r1 = enforcer.validateMessage('alice', 'bob', 'propose', 'contract');
    expect(r1.allowed).toBe(true);
    expect(r1.protocolState).toBe('proposed');
  });

  it('rejects invalid transitions with explanation', () => {
    const r1 = enforcer.validateMessage('alice', 'bob', 'deliver', 'contract');
    expect(r1.allowed).toBe(false);
    expect(r1.reason).toContain('does not allow');
    expect(r1.reason).toContain("'idle'");
    expect(r1.reason).toContain("'deliver'");
    expect(r1.reason).toContain('propose');
  });

  it('tracks session state across multiple messages', () => {
    enforcer.validateMessage('alice', 'bob', 'propose', 'contract');
    enforcer.validateMessage('alice', 'bob', 'accept', 'contract');
    enforcer.validateMessage('alice', 'bob', 'confirm', 'contract');

    // Now in 'executing' — deliver is allowed
    const r = enforcer.validateMessage('alice', 'bob', 'deliver', 'contract');
    expect(r.allowed).toBe(true);
    expect(r.protocolState).toBe('delivered');
  });

  it('allows progress_update during executing state', () => {
    enforcer.validateMessage('alice', 'bob', 'propose', 'contract');
    enforcer.validateMessage('alice', 'bob', 'accept', 'contract');
    enforcer.validateMessage('alice', 'bob', 'confirm', 'contract');

    const r = enforcer.validateMessage('alice', 'bob', 'progress_update', 'contract');
    expect(r.allowed).toBe(true);
    expect(r.protocolState).toBe('executing');
  });

  it('creates new session for different cell pairs', () => {
    enforcer.validateMessage('alice', 'bob', 'propose', 'contract');
    // Different pair should have independent session
    const r = enforcer.validateMessage('charlie', 'dave', 'propose', 'contract');
    expect(r.allowed).toBe(true);
  });

  it('returns error for unknown protocol', () => {
    const r = enforcer.validateMessage('alice', 'bob', 'go', 'nonexistent');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('Unknown protocol');
  });

  it('creates new session after terminal state', () => {
    // Complete a contract
    enforcer.validateMessage('alice', 'bob', 'propose', 'contract');
    enforcer.validateMessage('alice', 'bob', 'reject', 'contract');

    // Session is terminal — next message should start new session
    const r = enforcer.validateMessage('alice', 'bob', 'propose', 'contract');
    expect(r.allowed).toBe(true);
    expect(r.protocolState).toBe('proposed');
  });

  it('clears all sessions', () => {
    enforcer.validateMessage('alice', 'bob', 'propose', 'contract');
    expect(enforcer.getActiveSessions()).toHaveLength(1);
    enforcer.clearSessions();
    expect(enforcer.getActiveSessions()).toHaveLength(0);
  });

  describe('deliberation protocol', () => {
    it('supports full deliberation flow', () => {
      const r1 = enforcer.validateMessage('f', 'p', 'propose', 'deliberation');
      expect(r1.allowed).toBe(true);

      const r2 = enforcer.validateMessage('f', 'p', 'open_discussion', 'deliberation');
      expect(r2.allowed).toBe(true);

      const r3 = enforcer.validateMessage('f', 'p', 'argument', 'deliberation');
      expect(r3.allowed).toBe(true);

      const r4 = enforcer.validateMessage('f', 'p', 'call_vote', 'deliberation');
      expect(r4.allowed).toBe(true);

      const r5 = enforcer.validateMessage('f', 'p', 'vote', 'deliberation');
      expect(r5.allowed).toBe(true);

      const r6 = enforcer.validateMessage('f', 'p', 'resolve', 'deliberation');
      expect(r6.allowed).toBe(true);
      expect(r6.protocolState).toBe('resolved');
    });
  });

  describe('auction protocol', () => {
    it('supports full auction flow', () => {
      enforcer.validateMessage('a', 'b', 'announce', 'auction');
      enforcer.validateMessage('a', 'b', 'bid', 'auction');
      enforcer.validateMessage('a', 'b', 'bid', 'auction');
      const r = enforcer.validateMessage('a', 'b', 'award', 'auction');
      expect(r.allowed).toBe(true);
      expect(r.protocolState).toBe('awarded');
    });

    it('rejects announce after bidding started', () => {
      enforcer.validateMessage('a', 'b', 'announce', 'auction');
      enforcer.validateMessage('a', 'b', 'bid', 'auction');
      const r = enforcer.validateMessage('a', 'b', 'announce', 'auction');
      expect(r.allowed).toBe(false);
    });
  });
});

describe('Built-in protocols structure', () => {
  it('CONTRACT_PROTOCOL has correct roles', () => {
    expect(CONTRACT_PROTOCOL.roles).toEqual(['requester', 'provider']);
  });

  it('CONTRACT_PROTOCOL has terminal states', () => {
    const terminals = CONTRACT_PROTOCOL.states.filter((s) => s.terminal);
    expect(terminals.map((s) => s.name).sort()).toEqual(['evaluated', 'rejected']);
  });

  it('DELIBERATION_PROTOCOL has resolved as terminal', () => {
    const terminals = DELIBERATION_PROTOCOL.states.filter((s) => s.terminal);
    expect(terminals).toHaveLength(1);
    expect(terminals[0]!.name).toBe('resolved');
  });

  it('AUCTION_PROTOCOL has awarded as terminal', () => {
    const terminals = AUCTION_PROTOCOL.states.filter((s) => s.terminal);
    expect(terminals).toHaveLength(1);
    expect(terminals[0]!.name).toBe('awarded');
  });
});
