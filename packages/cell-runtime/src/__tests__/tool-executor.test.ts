import { describe, expect, it, beforeEach } from 'vitest';

import { ToolExecutor } from '../tools/tool-executor.js';
import type { Tool } from '../tools/tool-executor.js';

function makeSimpleTool(name: string, response: string): Tool {
  return {
    name,
    description: `Tool: ${name}`,
    inputSchema: { type: 'object', properties: {} },
    async execute(_input: unknown): Promise<string> {
      return response;
    },
  };
}

function makeFailingTool(name: string, errorMessage: string): Tool {
  return {
    name,
    description: `Failing tool: ${name}`,
    inputSchema: { type: 'object', properties: {} },
    async execute(_input: unknown): Promise<string> {
      throw new Error(errorMessage);
    },
  };
}

describe('ToolExecutor', () => {
  let executor: ToolExecutor;

  beforeEach(() => {
    executor = new ToolExecutor();
  });

  describe('register and execute', () => {
    it('executes a registered tool', async () => {
      executor.register(makeSimpleTool('greet', 'Hello, world!'));

      const result = await executor.execute({ id: 'tc-1', name: 'greet', input: {} });
      expect(result.content).toBe('Hello, world!');
      expect(result.isError).toBe(false);
    });

    it('passes input to tool execute function', async () => {
      const tool: Tool = {
        name: 'echo',
        description: 'Echoes input',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        async execute(input: unknown): Promise<string> {
          return `Echo: ${(input as { text: string }).text}`;
        },
      };

      executor.register(tool);
      const result = await executor.execute({ id: 'tc-1', name: 'echo', input: { text: 'hi' } });
      expect(result.content).toBe('Echo: hi');
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool', async () => {
      const result = await executor.execute({ id: 'tc-1', name: 'nonexistent', input: {} });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Unknown tool: nonexistent');
    });
  });

  describe('tool execution error', () => {
    it('catches errors and returns as isError', async () => {
      executor.register(makeFailingTool('broken', 'Something went wrong'));

      const result = await executor.execute({ id: 'tc-1', name: 'broken', input: {} });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Tool error: Something went wrong');
    });

    it('handles non-Error throws', async () => {
      const tool: Tool = {
        name: 'thrower',
        description: 'Throws a string',
        inputSchema: { type: 'object', properties: {} },
        async execute(): Promise<string> {
          throw 'raw string error'; // eslint-disable-line no-throw-literal
        },
      };

      executor.register(tool);
      const result = await executor.execute({ id: 'tc-1', name: 'thrower', input: {} });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('raw string error');
    });
  });

  describe('getDefinitions', () => {
    it('returns definitions for all registered tools', () => {
      executor.register(makeSimpleTool('tool_a', 'a'));
      executor.register(makeSimpleTool('tool_b', 'b'));

      const defs = executor.getDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs.map(d => d.name)).toEqual(['tool_a', 'tool_b']);
      expect(defs[0]!.description).toBe('Tool: tool_a');
      expect(defs[0]!.inputSchema).toEqual({ type: 'object', properties: {} });
    });

    it('returns empty array when no tools registered', () => {
      expect(executor.getDefinitions()).toEqual([]);
    });
  });
});
