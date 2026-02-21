import type { CompletionCheck } from '@kais/core';
import * as path from 'node:path';

import type { CommandExecutor, FileSystem } from './types.js';

/**
 * Result of running a single completion check.
 */
export interface CheckResult {
  name: string;
  status: 'Passed' | 'Failed' | 'Error';
  output?: string;
}

/**
 * Resolve a simple JSONPath expression like "$.total.lines.pct" against a parsed object.
 * Supports only dot-notation property access (no array indexing, wildcards, etc.).
 */
export function resolveJsonPath(obj: unknown, jsonPath: string): unknown {
  // Strip leading "$." prefix
  const cleanPath = jsonPath.startsWith('$.') ? jsonPath.slice(2) : jsonPath;
  const parts = cleanPath.split('.');

  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Compare two numbers using the given operator string.
 */
function compare(actual: number, operator: string, expected: number): boolean {
  switch (operator) {
    case '>=':
      return actual >= expected;
    case '<=':
      return actual <= expected;
    case '==':
      return actual === expected;
    case '>':
      return actual > expected;
    case '<':
      return actual < expected;
    default:
      throw new Error(`Unknown comparison operator: "${operator}"`);
  }
}

/**
 * Run a single completion check and return the result.
 *
 * @param check - The check specification from the Mission CRD
 * @param workspacePath - The workspace directory to run checks in
 * @param executor - Command executor abstraction
 * @param fs - Filesystem abstraction
 */
export async function runCheck(
  check: CompletionCheck,
  workspacePath: string,
  executor: CommandExecutor,
  fs: FileSystem,
): Promise<CheckResult> {
  try {
    switch (check.type) {
      case 'fileExists':
        return await runFileExistsCheck(check, workspacePath, fs);
      case 'command':
        return await runCommandCheck(check, workspacePath, executor);
      case 'coverage':
        return await runCoverageCheck(check, workspacePath, executor);
      default:
        return {
          name: check.name,
          status: 'Error',
          output: `Unknown check type: "${check.type as string}"`,
        };
    }
  } catch (err) {
    return {
      name: check.name,
      status: 'Error',
      output: `Check threw an exception: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * fileExists check: verify all paths exist in the workspace.
 */
async function runFileExistsCheck(
  check: CompletionCheck,
  workspacePath: string,
  fs: FileSystem,
): Promise<CheckResult> {
  const paths = check.paths ?? [];
  if (paths.length === 0) {
    return {
      name: check.name,
      status: 'Error',
      output: 'fileExists check requires at least one path',
    };
  }

  const resolvedWorkspace = path.resolve(workspacePath);
  const missing: string[] = [];
  for (const p of paths) {
    const fullPath = path.resolve(workspacePath, p);
    if (!fullPath.startsWith(resolvedWorkspace + '/') && fullPath !== resolvedWorkspace) {
      missing.push(p + ' (path traversal blocked)');
      continue;
    }
    const fileExists = await fs.exists(fullPath);
    if (!fileExists) {
      missing.push(p);
    }
  }

  if (missing.length > 0) {
    return {
      name: check.name,
      status: 'Failed',
      output: `Missing files: ${missing.join(', ')}`,
    };
  }

  return { name: check.name, status: 'Passed' };
}

/**
 * command check: run a command and evaluate success/fail patterns + exit code.
 */
async function runCommandCheck(
  check: CompletionCheck,
  workspacePath: string,
  executor: CommandExecutor,
): Promise<CheckResult> {
  if (!check.command) {
    return {
      name: check.name,
      status: 'Error',
      output: 'command check requires a command',
    };
  }

  const result = await executor.exec(check.command, workspacePath);

  // Check failPattern first (if stdout matches fail pattern, it's a failure)
  if (check.failPattern) {
    const failRegex = new RegExp(check.failPattern);
    if (failRegex.test(result.stdout)) {
      return {
        name: check.name,
        status: 'Failed',
        output: `Output matched fail pattern "${check.failPattern}"`,
      };
    }
  }

  // Check successPattern (if specified, stdout must match)
  if (check.successPattern) {
    const successRegex = new RegExp(check.successPattern);
    if (!successRegex.test(result.stdout)) {
      return {
        name: check.name,
        status: 'Failed',
        output: `Output did not match success pattern "${check.successPattern}"`,
      };
    }
  }

  // Check exit code
  if (result.exitCode !== 0) {
    return {
      name: check.name,
      status: 'Failed',
      output: `Command exited with code ${result.exitCode}: ${result.stderr || result.stdout}`,
    };
  }

  return { name: check.name, status: 'Passed' };
}

/**
 * coverage check: run a command, parse JSON output, and compare a value.
 */
async function runCoverageCheck(
  check: CompletionCheck,
  workspacePath: string,
  executor: CommandExecutor,
): Promise<CheckResult> {
  if (!check.command) {
    return {
      name: check.name,
      status: 'Error',
      output: 'coverage check requires a command',
    };
  }

  if (!check.jsonPath || check.operator === undefined || check.value === undefined) {
    return {
      name: check.name,
      status: 'Error',
      output: 'coverage check requires jsonPath, operator, and value',
    };
  }

  const result = await executor.exec(check.command, workspacePath);

  if (result.exitCode !== 0) {
    return {
      name: check.name,
      status: 'Failed',
      output: `Command exited with code ${result.exitCode}: ${result.stderr || result.stdout}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return {
      name: check.name,
      status: 'Error',
      output: `Failed to parse command output as JSON: ${result.stdout.slice(0, 200)}`,
    };
  }

  const actual = resolveJsonPath(parsed, check.jsonPath);
  if (typeof actual !== 'number') {
    return {
      name: check.name,
      status: 'Error',
      output: `Value at jsonPath "${check.jsonPath}" is not a number: ${String(actual)}`,
    };
  }

  const passed = compare(actual, check.operator, check.value);
  return {
    name: check.name,
    status: passed ? 'Passed' : 'Failed',
    output: `${actual} ${check.operator} ${check.value} → ${passed ? 'true' : 'false'}`,
  };
}
