import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../kais.js';

// ---------------------------------------------------------------------------
// Mock child_process.execSync
// ---------------------------------------------------------------------------
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
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

      await runProgram(['logs', 'cell', 'researcher', '--api-url', 'http://test:3000', '--limit', '10']);

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

  // ----- Formation scale command -----

  describe('scale formation command', () => {
    it('generates correct kubectl patch for scaling', async () => {
      const { execFileSync } = await import('node:child_process');
      const mockedExecFile = vi.mocked(execFileSync);

      // First call returns the formation JSON
      const formationJson = JSON.stringify({
        spec: {
          cells: [
            { name: 'architect', replicas: 1 },
            { name: 'developer', replicas: 2 },
            { name: 'reviewer', replicas: 1 },
          ],
        },
      });
      mockedExecFile.mockReturnValueOnce(formationJson as any);
      // Second call is the patch (stdio: inherit returns void)
      mockedExecFile.mockReturnValueOnce(undefined as any);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runProgram(['scale', 'formation', 'my-team', '--cell', 'developer', '--replicas', '5', '-n', 'prod']);

      // First call: get formation
      expect(mockedExecFile).toHaveBeenCalledWith(
        'kubectl',
        ['get', 'formation', 'my-team', '-n', 'prod', '-o', 'json'],
        { encoding: 'utf-8' },
      );

      // Second call: patch with correct index (developer is index 1)
      const expectedPatch = JSON.stringify([
        { op: 'replace', path: '/spec/cells/1/replicas', value: 5 },
      ]);
      expect(mockedExecFile).toHaveBeenCalledWith(
        'kubectl',
        ['patch', 'formation', 'my-team', '-n', 'prod', '--type=json', '-p', expectedPatch],
        { stdio: 'inherit' },
      );

      expect(consoleSpy).toHaveBeenCalledWith('Scaled developer in formation my-team to 5 replicas');
      consoleSpy.mockRestore();
    });

    it('errors when cell template not found', async () => {
      const { execFileSync } = await import('node:child_process');
      const mockedExecFile = vi.mocked(execFileSync);

      const formationJson = JSON.stringify({
        spec: {
          cells: [{ name: 'architect', replicas: 1 }],
        },
      });
      mockedExecFile.mockReturnValueOnce(formationJson as any);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await runProgram(['scale', 'formation', 'my-team', '--cell', 'nonexistent', '--replicas', '3']);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error: cell template "nonexistent" not found in formation "my-team"',
      );
      consoleSpy.mockRestore();
    });

    it('errors when --cell is missing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await runProgram(['scale', 'formation', 'my-team', '--replicas', '3']);

      expect(consoleSpy).toHaveBeenCalledWith('Error: --cell is required');
      consoleSpy.mockRestore();
    });

    it('errors when --replicas is missing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await runProgram(['scale', 'formation', 'my-team', '--cell', 'worker']);

      expect(consoleSpy).toHaveBeenCalledWith('Error: --replicas is required');
      consoleSpy.mockRestore();
    });

    it('errors when --replicas is not a valid number', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await runProgram(['scale', 'formation', 'my-team', '--cell', 'worker', '--replicas', 'abc']);
      expect(consoleSpy).toHaveBeenCalledWith('Error: --replicas must be a non-negative integer');
      consoleSpy.mockRestore();
    });
  });

  // ----- Formation logs command -----

  describe('logs formation command', () => {
    it('fetches logs for all cells and interleaves by timestamp', async () => {
      const { execFileSync } = await import('node:child_process');
      const mockedExecFile = vi.mocked(execFileSync);

      const formationJson = JSON.stringify({
        spec: {
          cells: [
            { name: 'architect', replicas: 1 },
            { name: 'developer', replicas: 2 },
          ],
        },
      });
      mockedExecFile.mockReturnValueOnce(formationJson as any);

      // Mock fetch for each cell's logs
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            logs: [
              { created_at: '2025-01-15T10:30:00Z', event_type: 'message_received', payload: { from: 'user' } },
              { created_at: '2025-01-15T10:30:10Z', event_type: 'tool_call', payload: { tool: 'code_review' } },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            logs: [
              { created_at: '2025-01-15T10:30:05Z', event_type: 'message_sent', payload: { to: 'architect' } },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            logs: [
              { created_at: '2025-01-15T10:30:03Z', event_type: 'message_received', payload: { from: 'architect' } },
            ],
          }),
        });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runProgram(['logs', 'formation', 'my-team', '--api-url', 'http://test:3000', '-n', 'prod']);

      // Should have fetched logs for all 3 cells
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('http://test:3000/api/v1/cells/architect-0/logs'),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('http://test:3000/api/v1/cells/developer-0/logs'),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('http://test:3000/api/v1/cells/developer-1/logs'),
      );

      // Should have logged 4 entries total, sorted by timestamp
      expect(consoleSpy).toHaveBeenCalledTimes(4);

      // Verify ordering: 10:30:00, 10:30:03, 10:30:05, 10:30:10
      const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
      expect(calls[0]).toContain('architect-0');
      expect(calls[0]).toContain('message_received');
      expect(calls[1]).toContain('developer-1');
      expect(calls[1]).toContain('message_received');
      expect(calls[2]).toContain('developer-0');
      expect(calls[2]).toContain('message_sent');
      expect(calls[3]).toContain('architect-0');
      expect(calls[3]).toContain('tool_call');

      consoleSpy.mockRestore();
    });
  });

  // ----- Mission commands -----

  describe('mission status command', () => {
    it('formats mission status output correctly', async () => {
      const { execFileSync } = await import('node:child_process');
      const mockedExecFile = vi.mocked(execFileSync);

      const missionJson = JSON.stringify({
        metadata: { name: 'build-feature', namespace: 'default' },
        spec: {
          formationRef: 'dev-team',
          objective: 'Build the login feature',
          completion: {
            checks: [
              { name: 'tests-pass', type: 'command' },
              { name: 'lint-clean', type: 'command' },
            ],
            maxAttempts: 3,
            timeout: '30m',
          },
          entrypoint: { cell: 'architect', message: 'Start building' },
          budget: { maxCost: 5.0 },
        },
        status: {
          phase: 'Running',
          attempt: 1,
          startedAt: new Date(Date.now() - 323000).toISOString(), // ~5m 23s ago
          cost: 0.1234,
          checks: [
            { name: 'tests-pass', status: 'Passed' },
            { name: 'lint-clean', status: 'Failed' },
          ],
        },
      });
      mockedExecFile.mockReturnValueOnce(missionJson as any);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runProgram(['mission', 'status', 'build-feature']);

      expect(mockedExecFile).toHaveBeenCalledWith(
        'kubectl',
        ['get', 'mission', 'build-feature', '-n', 'default', '-o', 'json'],
        { encoding: 'utf-8' },
      );

      const output = consoleSpy.mock.calls[0]![0] as string;
      expect(output).toContain('Name:      build-feature');
      expect(output).toContain('Status:    Running');
      expect(output).toContain('Attempt:   1/3');
      expect(output).toContain('Cost:      $0.1234');
      expect(output).toContain('Objective: Build the login feature');
      expect(output).toContain('tests-pass');
      expect(output).toContain('\u2713');  // checkmark
      expect(output).toContain('lint-clean');
      expect(output).toContain('\u2717');  // X mark

      consoleSpy.mockRestore();
    });
  });

  describe('mission retry command', () => {
    it('generates correct kubectl patch', async () => {
      const { execFileSync } = await import('node:child_process');
      const mockedExecFile = vi.mocked(execFileSync);
      mockedExecFile.mockReturnValueOnce(undefined as any);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runProgram(['mission', 'retry', 'build-feature', '-n', 'prod']);

      const expectedPatch = JSON.stringify({ status: { phase: 'Pending' } });
      expect(mockedExecFile).toHaveBeenCalledWith(
        'kubectl',
        ['patch', 'mission', 'build-feature', '-n', 'prod', '--type=merge', '--subresource=status', '-p', expectedPatch],
        { stdio: 'inherit' },
      );

      expect(consoleSpy).toHaveBeenCalledWith('Mission build-feature set to Pending for retry');
      consoleSpy.mockRestore();
    });

    it('uses default namespace', async () => {
      const { execFileSync } = await import('node:child_process');
      const mockedExecFile = vi.mocked(execFileSync);
      mockedExecFile.mockReturnValueOnce(undefined as any);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runProgram(['mission', 'retry', 'my-mission']);

      expect(mockedExecFile).toHaveBeenCalledWith(
        'kubectl',
        expect.arrayContaining(['-n', 'default']),
        { stdio: 'inherit' },
      );
      consoleSpy.mockRestore();
    });
  });

  describe('mission abort command', () => {
    it('generates correct kubectl patch', async () => {
      const { execFileSync } = await import('node:child_process');
      const mockedExecFile = vi.mocked(execFileSync);
      mockedExecFile.mockReturnValueOnce(undefined as any);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runProgram(['mission', 'abort', 'build-feature', '-n', 'staging']);

      const expectedPatch = JSON.stringify({ status: { phase: 'Failed', message: 'UserAborted' } });
      expect(mockedExecFile).toHaveBeenCalledWith(
        'kubectl',
        ['patch', 'mission', 'build-feature', '-n', 'staging', '--type=merge', '--subresource=status', '-p', expectedPatch],
        { stdio: 'inherit' },
      );

      expect(consoleSpy).toHaveBeenCalledWith('Mission build-feature aborted');
      consoleSpy.mockRestore();
    });
  });

  // ----- Topology commands -----

  describe('topology show command', () => {
    it('renders topology ASCII graph from kubectl output', async () => {
      const { execFileSync } = await import('node:child_process');
      const mockedExecFile = vi.mocked(execFileSync);

      const formationJson = JSON.stringify({
        spec: {
          cells: [
            { name: 'architect', replicas: 1, spec: {} },
            { name: 'developer', replicas: 2, spec: {} },
            { name: 'reviewer', replicas: 1, spec: {} },
          ],
          topology: {
            type: 'custom',
            routes: [
              { from: 'architect', to: ['developer', 'reviewer'] },
              { from: 'developer', to: ['architect', 'reviewer'] },
              { from: 'reviewer', to: ['architect'] },
            ],
          },
        },
      });
      mockedExecFile.mockReturnValueOnce(formationJson as any);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runProgram(['topology', 'show', 'my-team', '-n', 'prod']);

      expect(mockedExecFile).toHaveBeenCalledWith(
        'kubectl',
        ['get', 'formation', 'my-team', '-n', 'prod', '-o', 'json'],
        { encoding: 'utf-8' },
      );

      const output = consoleSpy.mock.calls[0]![0] as string;
      expect(output).toContain('architect-0');
      expect(output).toContain('developer-0');
      expect(output).toContain('developer-1');
      expect(output).toContain('reviewer-0');
      expect(output).toContain('\u2500\u2500\u2192'); // ──→

      consoleSpy.mockRestore();
    });
  });
});
