import { describe, expect, it } from 'vitest';
import type { CompletionCheck } from '@kais/core';

import { resolveJsonPath, runCheck } from '../check-runner.js';
import type { CommandExecutor, FileSystem } from '../types.js';

// --- Helpers ---

function createMockExecutor(
  results: Record<string, { stdout: string; stderr: string; exitCode: number }> = {},
): CommandExecutor {
  return {
    async exec(command: string, _cwd: string) {
      const result = results[command];
      if (!result) {
        return { stdout: '', stderr: 'command not found', exitCode: 127 };
      }
      return result;
    },
  };
}

function createMockFs(existingPaths: Set<string> = new Set()): FileSystem {
  return {
    async exists(path: string) {
      return existingPaths.has(path);
    },
  };
}

// --- resolveJsonPath ---

describe('resolveJsonPath', () => {
  it('resolves a simple path', () => {
    expect(resolveJsonPath({ total: { lines: { pct: 85 } } }, '$.total.lines.pct')).toBe(85);
  });

  it('resolves without $ prefix', () => {
    expect(resolveJsonPath({ a: { b: 42 } }, 'a.b')).toBe(42);
  });

  it('returns undefined for missing path', () => {
    expect(resolveJsonPath({ a: 1 }, '$.b.c')).toBeUndefined();
  });

  it('returns undefined for null in chain', () => {
    expect(resolveJsonPath({ a: null }, '$.a.b')).toBeUndefined();
  });
});

// --- fileExists checks ---

describe('runCheck - fileExists', () => {
  it('passes when all files exist', async () => {
    const check: CompletionCheck = {
      name: 'output-exists',
      type: 'fileExists',
      paths: ['result.json', 'README.md'],
    };
    const fs = createMockFs(new Set(['/workspace/result.json', '/workspace/README.md']));
    const executor = createMockExecutor();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.name).toBe('output-exists');
    expect(result.status).toBe('Passed');
  });

  it('fails when some files are missing', async () => {
    const check: CompletionCheck = {
      name: 'output-exists',
      type: 'fileExists',
      paths: ['result.json', 'missing.txt'],
    };
    const fs = createMockFs(new Set(['/workspace/result.json']));
    const executor = createMockExecutor();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Failed');
    expect(result.output).toContain('missing.txt');
  });

  it('errors when no paths specified', async () => {
    const check: CompletionCheck = {
      name: 'empty-check',
      type: 'fileExists',
      paths: [],
    };
    const fs = createMockFs();
    const executor = createMockExecutor();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Error');
    expect(result.output).toContain('at least one path');
  });

  it('errors when paths field is missing', async () => {
    const check: CompletionCheck = {
      name: 'no-paths',
      type: 'fileExists',
    };
    const fs = createMockFs();
    const executor = createMockExecutor();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Error');
  });
});

// --- command checks ---

describe('runCheck - command', () => {
  it('passes when command succeeds and matches success pattern', async () => {
    const check: CompletionCheck = {
      name: 'tests-pass',
      type: 'command',
      command: 'npm test',
      successPattern: 'All tests passed',
    };
    const executor = createMockExecutor({
      'npm test': { stdout: 'All tests passed', stderr: '', exitCode: 0 },
    });
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Passed');
  });

  it('fails when success pattern does not match', async () => {
    const check: CompletionCheck = {
      name: 'tests-pass',
      type: 'command',
      command: 'npm test',
      successPattern: 'All tests passed',
    };
    const executor = createMockExecutor({
      'npm test': { stdout: '3 tests failed', stderr: '', exitCode: 0 },
    });
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Failed');
    expect(result.output).toContain('did not match success pattern');
  });

  it('fails when fail pattern matches', async () => {
    const check: CompletionCheck = {
      name: 'tests-pass',
      type: 'command',
      command: 'npm test',
      failPattern: 'FAIL',
    };
    const executor = createMockExecutor({
      'npm test': { stdout: 'FAIL some_test.ts', stderr: '', exitCode: 0 },
    });
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Failed');
    expect(result.output).toContain('matched fail pattern');
  });

  it('fails on non-zero exit code', async () => {
    const check: CompletionCheck = {
      name: 'build',
      type: 'command',
      command: 'npm run build',
    };
    const executor = createMockExecutor({
      'npm run build': { stdout: '', stderr: 'compilation error', exitCode: 1 },
    });
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Failed');
    expect(result.output).toContain('exited with code 1');
  });

  it('passes on zero exit code with no patterns', async () => {
    const check: CompletionCheck = {
      name: 'build',
      type: 'command',
      command: 'npm run build',
    };
    const executor = createMockExecutor({
      'npm run build': { stdout: 'Build complete', stderr: '', exitCode: 0 },
    });
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Passed');
  });

  it('errors when command is missing', async () => {
    const check: CompletionCheck = {
      name: 'no-command',
      type: 'command',
    };
    const executor = createMockExecutor();
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Error');
    expect(result.output).toContain('requires a command');
  });

  it('fail pattern takes precedence even when exit code is 0', async () => {
    const check: CompletionCheck = {
      name: 'mixed',
      type: 'command',
      command: 'npm test',
      successPattern: 'passed',
      failPattern: 'ERROR',
    };
    const executor = createMockExecutor({
      'npm test': { stdout: 'tests passed but ERROR in logs', stderr: '', exitCode: 0 },
    });
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Failed');
    expect(result.output).toContain('matched fail pattern');
  });
});

// --- coverage checks ---

describe('runCheck - coverage', () => {
  it('passes when coverage meets threshold', async () => {
    const check: CompletionCheck = {
      name: 'coverage-check',
      type: 'coverage',
      command: 'npm run coverage -- --json',
      jsonPath: '$.total.lines.pct',
      operator: '>=',
      value: 80,
    };
    const executor = createMockExecutor({
      'npm run coverage -- --json': {
        stdout: JSON.stringify({ total: { lines: { pct: 85 } } }),
        stderr: '',
        exitCode: 0,
      },
    });
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Passed');
    expect(result.output).toContain('85 >= 80');
  });

  it('fails when coverage is below threshold', async () => {
    const check: CompletionCheck = {
      name: 'coverage-check',
      type: 'coverage',
      command: 'npm run coverage -- --json',
      jsonPath: '$.total.lines.pct',
      operator: '>=',
      value: 80,
    };
    const executor = createMockExecutor({
      'npm run coverage -- --json': {
        stdout: JSON.stringify({ total: { lines: { pct: 60 } } }),
        stderr: '',
        exitCode: 0,
      },
    });
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Failed');
    expect(result.output).toContain('60 >= 80');
    expect(result.output).toContain('false');
  });

  it('supports == operator', async () => {
    const check: CompletionCheck = {
      name: 'exact-check',
      type: 'coverage',
      command: 'check-value',
      jsonPath: '$.count',
      operator: '==',
      value: 42,
    };
    const executor = createMockExecutor({
      'check-value': {
        stdout: JSON.stringify({ count: 42 }),
        stderr: '',
        exitCode: 0,
      },
    });
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Passed');
  });

  it('supports < operator', async () => {
    const check: CompletionCheck = {
      name: 'less-check',
      type: 'coverage',
      command: 'check-value',
      jsonPath: '$.errors',
      operator: '<',
      value: 5,
    };
    const executor = createMockExecutor({
      'check-value': {
        stdout: JSON.stringify({ errors: 3 }),
        stderr: '',
        exitCode: 0,
      },
    });
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Passed');
  });

  it('supports <= operator', async () => {
    const check: CompletionCheck = {
      name: 'lte-check',
      type: 'coverage',
      command: 'check-value',
      jsonPath: '$.warnings',
      operator: '<=',
      value: 10,
    };
    const executor = createMockExecutor({
      'check-value': {
        stdout: JSON.stringify({ warnings: 10 }),
        stderr: '',
        exitCode: 0,
      },
    });
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Passed');
  });

  it('supports > operator', async () => {
    const check: CompletionCheck = {
      name: 'gt-check',
      type: 'coverage',
      command: 'check-value',
      jsonPath: '$.score',
      operator: '>',
      value: 90,
    };
    const executor = createMockExecutor({
      'check-value': {
        stdout: JSON.stringify({ score: 95 }),
        stderr: '',
        exitCode: 0,
      },
    });
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Passed');
  });

  it('errors on non-JSON output', async () => {
    const check: CompletionCheck = {
      name: 'bad-json',
      type: 'coverage',
      command: 'npm run coverage',
      jsonPath: '$.total',
      operator: '>=',
      value: 80,
    };
    const executor = createMockExecutor({
      'npm run coverage': {
        stdout: 'not json at all',
        stderr: '',
        exitCode: 0,
      },
    });
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Error');
    expect(result.output).toContain('Failed to parse');
  });

  it('errors when jsonPath resolves to non-number', async () => {
    const check: CompletionCheck = {
      name: 'string-value',
      type: 'coverage',
      command: 'check-value',
      jsonPath: '$.name',
      operator: '>=',
      value: 80,
    };
    const executor = createMockExecutor({
      'check-value': {
        stdout: JSON.stringify({ name: 'hello' }),
        stderr: '',
        exitCode: 0,
      },
    });
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Error');
    expect(result.output).toContain('not a number');
  });

  it('fails on non-zero exit code', async () => {
    const check: CompletionCheck = {
      name: 'exit-fail',
      type: 'coverage',
      command: 'npm run coverage',
      jsonPath: '$.total',
      operator: '>=',
      value: 80,
    };
    const executor = createMockExecutor({
      'npm run coverage': {
        stdout: '',
        stderr: 'Error running coverage',
        exitCode: 1,
      },
    });
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Failed');
    expect(result.output).toContain('exited with code 1');
  });

  it('errors when missing required fields', async () => {
    const check: CompletionCheck = {
      name: 'missing-fields',
      type: 'coverage',
      command: 'npm run coverage',
    };
    const executor = createMockExecutor();
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Error');
    expect(result.output).toContain('requires jsonPath');
  });

  it('errors when command is missing for coverage check', async () => {
    const check: CompletionCheck = {
      name: 'no-cmd',
      type: 'coverage',
      jsonPath: '$.total',
      operator: '>=',
      value: 80,
    };
    const executor = createMockExecutor();
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Error');
    expect(result.output).toContain('requires a command');
  });
});

// --- exception handling ---

describe('runCheck - error handling', () => {
  it('catches exceptions from executor and returns Error', async () => {
    const check: CompletionCheck = {
      name: 'throws',
      type: 'command',
      command: 'blow-up',
    };
    const executor: CommandExecutor = {
      async exec() {
        throw new Error('Connection refused');
      },
    };
    const fs = createMockFs();

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Error');
    expect(result.output).toContain('Connection refused');
  });

  it('catches exceptions from fs and returns Error', async () => {
    const check: CompletionCheck = {
      name: 'fs-throws',
      type: 'fileExists',
      paths: ['test.txt'],
    };
    const executor = createMockExecutor();
    const fs: FileSystem = {
      async exists() {
        throw new Error('Permission denied');
      },
    };

    const result = await runCheck(check, '/workspace', executor, fs);

    expect(result.status).toBe('Error');
    expect(result.output).toContain('Permission denied');
  });
});
