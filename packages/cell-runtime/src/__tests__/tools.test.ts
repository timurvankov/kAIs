import { describe, expect, it, beforeEach } from 'vitest';

import { createSendMessageTool } from '../tools/send-message.js';
import { createReadFileTool } from '../tools/read-file.js';
import { createWriteFileTool } from '../tools/write-file.js';
import { createBashTool } from '../tools/bash.js';
import type { TopologyEnforcer } from '../topology/topology-enforcer.js';
import { MockNatsConnection, MockFileSystem, MockCommandExecutor } from './helpers.js';

describe('send_message tool', () => {
  let nats: MockNatsConnection;

  beforeEach(() => {
    nats = new MockNatsConnection();
  });

  it('publishes an envelope to the target cell inbox', async () => {
    const tool = createSendMessageTool({
      cellName: 'sender-cell',
      namespace: 'default',
      nats,
    });

    const result = await tool.execute({ to: 'receiver-cell', message: 'Hello there!' });

    expect(result).toBe('Message sent to receiver-cell');
    expect(nats.published).toHaveLength(1);
    expect(nats.published[0]!.subject).toBe('cell.default.receiver-cell.inbox');

    const envelope = JSON.parse(nats.published[0]!.data);
    expect(envelope.from).toBe('sender-cell');
    expect(envelope.to).toBe('receiver-cell');
    expect(envelope.type).toBe('message');
    expect(envelope.payload).toEqual({ content: 'Hello there!' });
  });

  it('throws when required fields are missing', async () => {
    const tool = createSendMessageTool({
      cellName: 'sender',
      namespace: 'default',
      nats,
    });

    await expect(tool.execute({ to: '', message: 'hi' })).rejects.toThrow();
    await expect(tool.execute({ to: 'target', message: '' })).rejects.toThrow();
  });

  it('throws on malformed input (I3)', async () => {
    const tool = createSendMessageTool({
      cellName: 'sender',
      namespace: 'default',
      nats,
    });

    // null input
    await expect(tool.execute(null)).rejects.toThrow();
    // missing fields
    await expect(tool.execute({})).rejects.toThrow();
    // wrong types
    await expect(tool.execute({ to: 123, message: true })).rejects.toThrow();
    // undefined input
    await expect(tool.execute(undefined)).rejects.toThrow();
  });

  describe('with topology enforcement', () => {
    function makeEnforcer(allowed: string[]): TopologyEnforcer {
      return {
        canSendTo(target: string): boolean {
          return allowed.includes(target);
        },
        getAllowedTargets(): string[] {
          return [...allowed];
        },
      };
    }

    it('allows messages to permitted targets', async () => {
      const enforcer = makeEnforcer(['receiver-cell', 'other-cell']);
      const tool = createSendMessageTool({
        cellName: 'sender',
        namespace: 'default',
        nats,
        topologyEnforcer: enforcer,
      });

      const result = await tool.execute({ to: 'receiver-cell', message: 'Hello!' });
      expect(result).toBe('Message sent to receiver-cell');
      expect(nats.published).toHaveLength(1);
    });

    it('throws on topology violation with descriptive error', async () => {
      const enforcer = makeEnforcer(['allowed-cell']);
      const tool = createSendMessageTool({
        cellName: 'sender',
        namespace: 'default',
        nats,
        topologyEnforcer: enforcer,
      });

      await expect(tool.execute({ to: 'blocked-cell', message: 'Hello!' })).rejects.toThrow(
        'Topology violation: sender cannot send messages to blocked-cell. Allowed targets: [allowed-cell]',
      );
      // No message should have been published
      expect(nats.published).toHaveLength(0);
    });

    it('includes multiple allowed targets in error message', async () => {
      const enforcer = makeEnforcer(['cell-a', 'cell-b']);
      const tool = createSendMessageTool({
        cellName: 'my-cell',
        namespace: 'default',
        nats,
        topologyEnforcer: enforcer,
      });

      await expect(tool.execute({ to: 'cell-c', message: 'test' })).rejects.toThrow(
        'Allowed targets: [cell-a, cell-b]',
      );
    });

    it('works normally without topology enforcer', async () => {
      const tool = createSendMessageTool({
        cellName: 'sender',
        namespace: 'default',
        nats,
        // no topologyEnforcer
      });

      const result = await tool.execute({ to: 'any-cell', message: 'Hello!' });
      expect(result).toBe('Message sent to any-cell');
    });
  });
});

describe('read_file tool', () => {
  let fs: MockFileSystem;

  beforeEach(() => {
    fs = new MockFileSystem();
  });

  it('reads a file from the shared workspace', async () => {
    fs.setFile('/workspace/shared/data.txt', 'Hello from shared!');

    const tool = createReadFileTool({ cellName: 'test-cell', fs });
    const result = await tool.execute({ path: 'data.txt' });

    expect(result).toBe('Hello from shared!');
  });

  it('reads a file from the shared workspace with explicit prefix', async () => {
    fs.setFile('/workspace/shared/info.txt', 'Shared content');

    const tool = createReadFileTool({ cellName: 'test-cell', fs });
    const result = await tool.execute({ path: 'shared/info.txt' });

    expect(result).toBe('Shared content');
  });

  it('reads a file from the private workspace', async () => {
    fs.setFile('/workspace/private/test-cell/notes.txt', 'Private notes');

    const tool = createReadFileTool({ cellName: 'test-cell', fs });
    const result = await tool.execute({ path: 'private/notes.txt' });

    expect(result).toBe('Private notes');
  });

  it('truncates files longer than 10000 chars', async () => {
    const longContent = 'x'.repeat(15000);
    fs.setFile('/workspace/shared/big.txt', longContent);

    const tool = createReadFileTool({ cellName: 'test-cell', fs });
    const result = await tool.execute({ path: 'big.txt' });

    expect(result.length).toBeLessThan(15000);
    expect(result).toContain('[truncated]');
  });

  it('throws when file does not exist', async () => {
    const tool = createReadFileTool({ cellName: 'test-cell', fs });
    await expect(tool.execute({ path: 'missing.txt' })).rejects.toThrow('ENOENT');
  });

  it('throws on malformed input (I3)', async () => {
    const tool = createReadFileTool({ cellName: 'test-cell', fs });

    await expect(tool.execute(null)).rejects.toThrow();
    await expect(tool.execute({})).rejects.toThrow();
    await expect(tool.execute({ path: 123 })).rejects.toThrow();
    await expect(tool.execute(undefined)).rejects.toThrow();
  });

  it('rejects path traversal attempts (I4)', async () => {
    const tool = createReadFileTool({ cellName: 'test-cell', fs });

    await expect(tool.execute({ path: '../../etc/passwd' })).rejects.toThrow('Path traversal');
    await expect(tool.execute({ path: 'shared/../../etc/passwd' })).rejects.toThrow('Path traversal');
    await expect(tool.execute({ path: 'private/../../../etc/passwd' })).rejects.toThrow('Path traversal');
  });
});

describe('write_file tool', () => {
  let fs: MockFileSystem;

  beforeEach(() => {
    fs = new MockFileSystem();
  });

  it('writes a file to the private workspace', async () => {
    const tool = createWriteFileTool({ cellName: 'test-cell', fs });
    const result = await tool.execute({ path: 'output.txt', content: 'Written content' });

    expect(result).toContain('File written to output.txt');
    expect(result).toContain('15 bytes');
    expect(fs.writtenFiles).toHaveLength(1);
    expect(fs.writtenFiles[0]!.path).toBe('/workspace/private/test-cell/output.txt');
    expect(fs.writtenFiles[0]!.content).toBe('Written content');
  });

  it('creates parent directories', async () => {
    const tool = createWriteFileTool({ cellName: 'test-cell', fs });
    await tool.execute({ path: 'sub/dir/file.txt', content: 'nested' });

    expect(fs.createdDirs).toContain('/workspace/private/test-cell/sub/dir');
  });

  it('throws on malformed input (I3)', async () => {
    const tool = createWriteFileTool({ cellName: 'test-cell', fs });

    await expect(tool.execute(null)).rejects.toThrow();
    await expect(tool.execute({})).rejects.toThrow();
    await expect(tool.execute({ path: 'file.txt' })).rejects.toThrow(); // missing content
    await expect(tool.execute({ path: 123, content: 'hello' })).rejects.toThrow();
    await expect(tool.execute(undefined)).rejects.toThrow();
  });

  it('rejects path traversal attempts (I4)', async () => {
    const tool = createWriteFileTool({ cellName: 'test-cell', fs });

    await expect(tool.execute({ path: '../../etc/passwd', content: 'evil' })).rejects.toThrow('Path traversal');
    await expect(tool.execute({ path: '../../../etc/shadow', content: 'evil' })).rejects.toThrow('Path traversal');
  });
});

describe('bash tool', () => {
  let executor: MockCommandExecutor;

  beforeEach(() => {
    executor = new MockCommandExecutor();
  });

  it('executes a command and returns stdout', async () => {
    executor.setResponse({ stdout: 'hello world', stderr: '', exitCode: 0 });

    const tool = createBashTool({ executor });
    const result = await tool.execute({ command: 'echo hello world' });

    expect(result).toBe('hello world');
    expect(executor.executedCommands).toHaveLength(1);
    expect(executor.executedCommands[0]!.command).toBe('echo hello world');
    expect(executor.executedCommands[0]!.timeout).toBe(30000); // default timeout
  });

  it('includes stderr in output', async () => {
    executor.setResponse({ stdout: 'out', stderr: 'warning: something', exitCode: 0 });

    const tool = createBashTool({ executor });
    const result = await tool.execute({ command: 'cmd' });

    expect(result).toContain('out');
    expect(result).toContain('warning: something');
  });

  it('includes exit code for non-zero exit', async () => {
    executor.setResponse({ stdout: '', stderr: 'error', exitCode: 1 });

    const tool = createBashTool({ executor });
    const result = await tool.execute({ command: 'fail' });

    expect(result).toContain('[exit code: 1]');
  });

  it('uses custom timeout', async () => {
    executor.setResponse({ stdout: 'ok', stderr: '', exitCode: 0 });

    const tool = createBashTool({ executor });
    await tool.execute({ command: 'slow-cmd', timeout: 60000 });

    expect(executor.executedCommands[0]!.timeout).toBe(60000);
  });

  it('returns [no output] when command produces nothing', async () => {
    executor.setResponse({ stdout: '', stderr: '', exitCode: 0 });

    const tool = createBashTool({ executor });
    const result = await tool.execute({ command: 'true' });

    expect(result).toBe('[no output]');
  });

  it('throws on malformed input (I3)', async () => {
    const tool = createBashTool({ executor });

    await expect(tool.execute(null)).rejects.toThrow();
    await expect(tool.execute({})).rejects.toThrow();
    await expect(tool.execute({ command: 123 })).rejects.toThrow();
    await expect(tool.execute(undefined)).rejects.toThrow();
    await expect(tool.execute({ command: '' })).rejects.toThrow();
  });
});
