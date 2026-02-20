/**
 * bash tool — execute a shell command.
 */
import type { Tool } from './tool-executor.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface CommandExecutor {
  exec(
    command: string,
    options: { timeout: number },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface BashConfig {
  executor: CommandExecutor;
}

export function createBashTool(config: BashConfig): Tool {
  return {
    name: 'bash',
    description: 'Execute a shell command and return the output.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['command'],
    },
    async execute(input: unknown): Promise<string> {
      const { command, timeout } = input as { command: string; timeout?: number };

      if (!command) {
        throw new Error('"command" is required');
      }

      const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;

      const result = await config.executor.exec(command, { timeout: timeoutMs });

      let output = '';
      if (result.stdout) {
        output += result.stdout;
      }
      if (result.stderr) {
        if (output) output += '\n';
        output += result.stderr;
      }
      if (result.exitCode !== 0) {
        output += `\n[exit code: ${result.exitCode}]`;
      }

      return output || '[no output]';
    },
  };
}
