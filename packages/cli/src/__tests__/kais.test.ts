import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../kais.js';

// ---------------------------------------------------------------------------
// Mock child_process.execSync
// ---------------------------------------------------------------------------
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock fs for init command
// ---------------------------------------------------------------------------
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Helpers
async function runProgram(args: string[]): Promise<void> {
  const program = createProgram();
  program.exitOverride(); // Throw instead of process.exit
  await program.parseAsync(['node', 'kais', ...args]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('kais CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ----- Kubectl passthrough -----

  describe('kubectl passthrough', () => {
    it('apply passes through to kubectl', async () => {
      const { execSync } = await import('node:child_process');
      const mockedExec = vi.mocked(execSync);

      await runProgram(['apply', '-f', 'cell.yaml']);

      expect(mockedExec).toHaveBeenCalledWith('kubectl apply -f cell.yaml', { stdio: 'inherit' });
    });

    it('get passes through to kubectl', async () => {
      const { execSync } = await import('node:child_process');
      const mockedExec = vi.mocked(execSync);

      await runProgram(['get', 'cells']);

      expect(mockedExec).toHaveBeenCalledWith('kubectl get cells', { stdio: 'inherit' });
    });

    it('describe passes through to kubectl', async () => {
      const { execSync } = await import('node:child_process');
      const mockedExec = vi.mocked(execSync);

      await runProgram(['describe', 'cell', 'researcher']);

      expect(mockedExec).toHaveBeenCalledWith('kubectl describe cell researcher', {
        stdio: 'inherit',
      });
    });

    it('delete passes through to kubectl', async () => {
      const { execSync } = await import('node:child_process');
      const mockedExec = vi.mocked(execSync);

      await runProgram(['delete', 'cell', 'researcher']);

      expect(mockedExec).toHaveBeenCalledWith('kubectl delete cell researcher', {
        stdio: 'inherit',
      });
    });
  });

  // ----- exec command -----

  describe('exec command', () => {
    it('calls API with correct URL and body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, messageId: 'msg-123' }),
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runProgram([
        'exec',
        'researcher',
        'Hello world',
        '--api-url',
        'http://test:3000',
        '-n',
        'demo',
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:3000/api/v1/cells/researcher/exec',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Hello world', namespace: 'demo' }),
        },
      );

      expect(consoleSpy).toHaveBeenCalledWith('Message sent (id: msg-123)');
      consoleSpy.mockRestore();
    });

    it('uses default namespace and API URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, messageId: 'msg-456' }),
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runProgram(['exec', 'myagent', 'test message']);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/cells/myagent/exec',
        expect.objectContaining({
          body: JSON.stringify({ message: 'test message', namespace: 'default' }),
        }),
      );

      consoleSpy.mockRestore();
    });
  });

  // ----- logs command -----

  describe('logs command', () => {
    it('calls API and formats output', async () => {
      const logData = {
        logs: [
          {
            created_at: '2025-01-15T10:30:00Z',
            event_type: 'message_received',
            payload: { content: 'hello' },
          },
          {
            created_at: '2025-01-15T10:30:05Z',
            event_type: 'tool_call',
            payload: { tool: 'web_search' },
          },
        ],
        total: 2,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => logData,
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runProgram(['logs', 'researcher', '--api-url', 'http://test:3000', '--limit', '10']);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('http://test:3000/api/v1/cells/researcher/logs'),
      );

      // Verify that log output was formatted
      expect(consoleSpy).toHaveBeenCalledTimes(2);
      const firstCallArg = consoleSpy.mock.calls[0]![0] as string;
      expect(firstCallArg).toContain('message_received');
      expect(firstCallArg).toContain('"content":"hello"');

      consoleSpy.mockRestore();
    });
  });

  // ----- usage command -----

  describe('usage command', () => {
    it('calls API and formats output', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          totalCost: 1.2345,
          totalTokens: 15000,
          events: 42,
        }),
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runProgram(['usage', 'researcher', '--api-url', 'http://test:3000', '-n', 'prod']);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('http://test:3000/api/v1/cells/researcher/usage'),
      );

      expect(consoleSpy).toHaveBeenCalledWith('Cost:   $1.2345');
      expect(consoleSpy).toHaveBeenCalledWith('Tokens: 15000');
      expect(consoleSpy).toHaveBeenCalledWith('Events: 42');

      consoleSpy.mockRestore();
    });
  });

  // ----- up command -----

  describe('up command', () => {
    it('runs minikube + helmfile + kubectl', async () => {
      const { execSync } = await import('node:child_process');
      const mockedExec = vi.mocked(execSync);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runProgram(['up']);

      expect(mockedExec).toHaveBeenCalledWith(
        'minikube start --cpus=4 --memory=8g --driver=docker',
        { stdio: 'inherit' },
      );
      expect(mockedExec).toHaveBeenCalledWith('helmfile apply', { stdio: 'inherit' });
      expect(mockedExec).toHaveBeenCalledWith('kubectl apply -f crds/', { stdio: 'inherit' });
      expect(consoleSpy).toHaveBeenCalledWith('kAIs platform is up!');

      consoleSpy.mockRestore();
    });
  });

  // ----- down command -----

  describe('down command', () => {
    it('runs minikube stop', async () => {
      const { execSync } = await import('node:child_process');
      const mockedExec = vi.mocked(execSync);

      await runProgram(['down']);

      expect(mockedExec).toHaveBeenCalledWith('minikube stop', { stdio: 'inherit' });
    });
  });

  // ----- init command -----

  describe('init command', () => {
    it('scaffolds project files', async () => {
      const { existsSync, writeFileSync, mkdirSync } = await import('node:fs');
      const mockedExists = vi.mocked(existsSync);
      const mockedWrite = vi.mocked(writeFileSync);
      const mockedMkdir = vi.mocked(mkdirSync);

      mockedExists.mockReturnValue(false);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runProgram(['init']);

      expect(consoleSpy).toHaveBeenCalledWith('Scaffolding kAIs project...');

      // Should write researcher.yaml
      expect(mockedWrite).toHaveBeenCalledWith(
        expect.stringContaining('researcher.yaml'),
        expect.stringContaining('kind: Cell'),
        'utf-8',
      );

      // Should create cells/ directory
      expect(mockedMkdir).toHaveBeenCalledWith(
        expect.stringContaining('cells'),
        { recursive: true },
      );

      consoleSpy.mockRestore();
    });

    it('skips file creation if already exists', async () => {
      const { existsSync, writeFileSync } = await import('node:fs');
      const mockedExists = vi.mocked(existsSync);
      const mockedWrite = vi.mocked(writeFileSync);

      // Everything already exists
      mockedExists.mockReturnValue(true);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runProgram(['init']);

      // Should NOT write researcher.yaml
      expect(mockedWrite).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
