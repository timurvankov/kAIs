import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryBus, InProcessRuntime, type Envelope } from '../index.js';
import { createEnvelope } from '../envelope.js';

function makeTestEnvelope(from: string, to: string, content: string): Envelope {
  return createEnvelope({
    type: 'message',
    from,
    to,
    payload: { content },
  });
}

describe('InMemoryBus', () => {
  let bus: InMemoryBus;

  beforeEach(() => {
    bus = new InMemoryBus();
  });

  it('delivers to exact match subscriber', async () => {
    const received: Envelope[] = [];
    bus.subscribe('cell.default.coder.inbox', (msg) => { received.push(msg); });

    const env = makeTestEnvelope('alice', 'coder', 'hello');
    await bus.publish('cell.default.coder.inbox', env);

    expect(received).toHaveLength(1);
    expect(received[0]!.payload.content).toBe('hello');
  });

  it('does not deliver to non-matching subscriber', async () => {
    const received: Envelope[] = [];
    bus.subscribe('cell.default.other.inbox', (msg) => { received.push(msg); });

    await bus.publish('cell.default.coder.inbox', makeTestEnvelope('a', 'b', 'x'));
    expect(received).toHaveLength(0);
  });

  it('supports * wildcard for single token', async () => {
    const received: Envelope[] = [];
    bus.subscribe('cell.*.coder.inbox', (msg) => { received.push(msg); });

    await bus.publish('cell.default.coder.inbox', makeTestEnvelope('a', 'b', 'x'));
    await bus.publish('cell.prod.coder.inbox', makeTestEnvelope('a', 'b', 'y'));
    expect(received).toHaveLength(2);
  });

  it('* wildcard does not match multiple tokens', async () => {
    const received: Envelope[] = [];
    bus.subscribe('cell.*.inbox', (msg) => { received.push(msg); });

    // cell.default.coder.inbox has 4 tokens, pattern has 3
    await bus.publish('cell.default.coder.inbox', makeTestEnvelope('a', 'b', 'x'));
    expect(received).toHaveLength(0);
  });

  it('supports > wildcard for remaining tokens', async () => {
    const received: Envelope[] = [];
    bus.subscribe('cell.>', (msg) => { received.push(msg); });

    await bus.publish('cell.default.coder.inbox', makeTestEnvelope('a', 'b', 'x'));
    await bus.publish('cell.prod.reviewer.inbox', makeTestEnvelope('a', 'b', 'y'));
    expect(received).toHaveLength(2);
  });

  it('supports multiple subscribers on same subject', async () => {
    let count = 0;
    bus.subscribe('test', () => { count++; });
    bus.subscribe('test', () => { count++; });

    await bus.publish('test', makeTestEnvelope('a', 'b', 'x'));
    expect(count).toBe(2);
  });

  it('unsubscribe removes handler', async () => {
    let count = 0;
    const sub = bus.subscribe('test', () => { count++; });

    await bus.publish('test', makeTestEnvelope('a', 'b', 'x'));
    expect(count).toBe(1);

    sub.unsubscribe();
    await bus.publish('test', makeTestEnvelope('a', 'b', 'y'));
    expect(count).toBe(1);
  });

  it('tracks message count', async () => {
    expect(bus.getMessageCount()).toBe(0);
    await bus.publish('test', makeTestEnvelope('a', 'b', 'x'));
    await bus.publish('test', makeTestEnvelope('a', 'b', 'y'));
    expect(bus.getMessageCount()).toBe(2);
  });

  it('tracks subscription count', () => {
    expect(bus.getSubscriptionCount()).toBe(0);
    const s1 = bus.subscribe('a', () => {});
    const s2 = bus.subscribe('b', () => {});
    expect(bus.getSubscriptionCount()).toBe(2);
    s1.unsubscribe();
    expect(bus.getSubscriptionCount()).toBe(1);
  });

  it('clear removes all subscriptions and resets counter', async () => {
    bus.subscribe('a', () => {});
    await bus.publish('a', makeTestEnvelope('a', 'b', 'x'));
    bus.clear();
    expect(bus.getSubscriptionCount()).toBe(0);
    expect(bus.getMessageCount()).toBe(0);
  });
});

describe('InProcessRuntime', () => {
  let runtime: InProcessRuntime;

  beforeEach(() => {
    runtime = new InProcessRuntime();
  });

  it('spawns a cell and returns RunningCell', async () => {
    const cell = await runtime.spawn('coder', { mind: {} });
    expect(cell.name).toBe('coder');
    expect(cell.status).toBe('running');
    expect(cell.id).toContain('cell-coder-');
  });

  it('lists spawned cells', async () => {
    await runtime.spawn('coder', {});
    await runtime.spawn('reviewer', {});
    const cells = await runtime.list();
    expect(cells).toHaveLength(2);
    expect(cells.map((c) => c.name).sort()).toEqual(['coder', 'reviewer']);
  });

  it('kills a cell', async () => {
    const cell = await runtime.spawn('coder', {});
    await runtime.kill(cell.id);
    const cells = await runtime.list();
    expect(cells).toHaveLength(0);
  });

  it('sends message to a cell', async () => {
    const cell = await runtime.spawn('coder', {});
    const env = makeTestEnvelope('alice', 'coder', 'hello');
    // Should not throw
    await runtime.send(cell.id, env);
  });

  it('throws when sending to non-existent cell', async () => {
    const env = makeTestEnvelope('alice', 'coder', 'hello');
    await expect(runtime.send('nonexistent', env)).rejects.toThrow('not found');
  });

  it('shutdown cleans up all cells', async () => {
    await runtime.spawn('a', {});
    await runtime.spawn('b', {});
    await runtime.shutdown();
    const cells = await runtime.list();
    expect(cells).toHaveLength(0);
  });

  it('uses provided message bus', async () => {
    const bus = new InMemoryBus();
    const rt = new InProcessRuntime(bus);
    await rt.spawn('coder', {});
    expect(bus.getSubscriptionCount()).toBe(1);
    await rt.shutdown();
    expect(bus.getSubscriptionCount()).toBe(0);
  });
});
