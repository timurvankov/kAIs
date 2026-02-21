import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRecallTool, createRememberTool, createCorrectTool } from '../tools/recall.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('recall tool', () => {
  it('calls knowledge service and returns facts', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'f1', content: 'Use strict mode', confidence: 0.9, tags: ['ts'] },
      ],
    });

    const tool = createRecallTool({
      knowledgeUrl: 'http://knowledge:8000',
      cellName: 'arch-0',
      namespace: 'default',
    });

    const result = await tool.execute({ query: 'typescript config', scope: 'all' });
    expect(result).toContain('Use strict mode');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://knowledge:8000/recall',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns message when no facts found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const tool = createRecallTool({
      knowledgeUrl: 'http://knowledge:8000',
      cellName: 'arch-0',
      namespace: 'default',
    });

    const result = await tool.execute({ query: 'nonexistent' });
    expect(result).toContain('No relevant knowledge found');
  });

  it('handles service errors', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const tool = createRecallTool({
      knowledgeUrl: 'http://knowledge:8000',
      cellName: 'arch-0',
      namespace: 'default',
    });

    const result = await tool.execute({ query: 'test' });
    expect(result).toContain('error');
  });

  it('includes graph_id in recall request when configured', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const tool = createRecallTool({
      knowledgeUrl: 'http://knowledge:8000',
      cellName: 'test',
      namespace: 'default',
      graphId: 'trading-kg',
    });

    await tool.execute({ query: 'test' });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://knowledge:8000/recall',
      expect.objectContaining({
        body: expect.stringContaining('"graph_id":"trading-kg"'),
      }),
    );
  });
});

describe('remember tool', () => {
  it('sends fact to knowledge service', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ factId: 'f-new' }),
    });

    const tool = createRememberTool({
      knowledgeUrl: 'http://knowledge:8000',
      cellName: 'arch-0',
      namespace: 'default',
    });

    const result = await tool.execute({
      fact: 'Always validate email input',
      tags: ['security'],
      confidence: 0.9,
    });
    expect(result).toContain('f-new');
  });
});

describe('correct tool', () => {
  it('invalidates fact via knowledge service', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });

    const tool = createCorrectTool({
      knowledgeUrl: 'http://knowledge:8000',
    });

    const result = await tool.execute({ factId: 'f1', reason: 'Wrong' });
    expect(result).toContain('invalidated');
  });
});
