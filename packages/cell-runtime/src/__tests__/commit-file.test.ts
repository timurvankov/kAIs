import { describe, expect, it, beforeEach } from 'vitest';

import { createCommitFileTool } from '../tools/commit-file.js';
import type { CommitFileFs, CommitFileConfig } from '../tools/commit-file.js';

class MockCommitFs implements CommitFileFs {
  private files: Map<string, string> = new Map();
  public writtenFiles: Array<{ path: string; content: string }> = [];
  public createdDirs: string[] = [];

  setFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.writtenFiles.push({ path, content });
  }

  async mkdir(path: string, _options?: { recursive: boolean }): Promise<void> {
    this.createdDirs.push(path);
  }
}

function makeConfig(fs: MockCommitFs): CommitFileConfig {
  return {
    fs,
    privatePath: '/workspace/private/test-cell',
    sharedPath: '/workspace/shared',
  };
}

describe('commit_file tool', () => {
  let fs: MockCommitFs;

  beforeEach(() => {
    fs = new MockCommitFs();
  });

  it('copies a file from private to shared workspace', async () => {
    fs.setFile('/workspace/private/test-cell/output.txt', 'Hello world');
    const tool = createCommitFileTool(makeConfig(fs));

    const resultStr = await tool.execute({ source: 'output.txt' });
    const result = JSON.parse(resultStr);

    expect(result.status).toBe('committed');
    expect(result.source).toBe('output.txt');
    expect(result.destination).toBe('output.txt');

    expect(fs.writtenFiles).toHaveLength(1);
    expect(fs.writtenFiles[0]!.path).toBe('/workspace/shared/output.txt');
    expect(fs.writtenFiles[0]!.content).toBe('Hello world');
  });

  it('uses destination when provided', async () => {
    fs.setFile('/workspace/private/test-cell/draft.txt', 'Draft content');
    const tool = createCommitFileTool(makeConfig(fs));

    const resultStr = await tool.execute({ source: 'draft.txt', destination: 'final/output.txt' });
    const result = JSON.parse(resultStr);

    expect(result.source).toBe('draft.txt');
    expect(result.destination).toBe('final/output.txt');
    expect(fs.writtenFiles[0]!.path).toBe('/workspace/shared/final/output.txt');
  });

  it('defaults destination to same as source', async () => {
    fs.setFile('/workspace/private/test-cell/sub/data.json', '{}');
    const tool = createCommitFileTool(makeConfig(fs));

    const resultStr = await tool.execute({ source: 'sub/data.json' });
    const result = JSON.parse(resultStr);

    expect(result.destination).toBe('sub/data.json');
    expect(fs.writtenFiles[0]!.path).toBe('/workspace/shared/sub/data.json');
  });

  it('creates destination directory', async () => {
    fs.setFile('/workspace/private/test-cell/file.txt', 'content');
    const tool = createCommitFileTool(makeConfig(fs));

    await tool.execute({ source: 'file.txt', destination: 'deep/nested/file.txt' });

    expect(fs.createdDirs).toContain('/workspace/shared/deep/nested');
  });

  it('rejects source path traversal attempts', async () => {
    const tool = createCommitFileTool(makeConfig(fs));

    await expect(tool.execute({ source: '../../etc/passwd' })).rejects.toThrow('Path traversal');
    await expect(tool.execute({ source: '../../../etc/shadow' })).rejects.toThrow('Path traversal');
  });

  it('rejects destination path traversal attempts', async () => {
    fs.setFile('/workspace/private/test-cell/file.txt', 'content');
    const tool = createCommitFileTool(makeConfig(fs));

    await expect(
      tool.execute({ source: 'file.txt', destination: '../../etc/passwd' }),
    ).rejects.toThrow('Path traversal');

    await expect(
      tool.execute({ source: 'file.txt', destination: '../../../etc/shadow' }),
    ).rejects.toThrow('Path traversal');
  });

  it('throws when source file does not exist', async () => {
    const tool = createCommitFileTool(makeConfig(fs));

    await expect(tool.execute({ source: 'missing.txt' })).rejects.toThrow('ENOENT');
  });

  it('throws on malformed input', async () => {
    const tool = createCommitFileTool(makeConfig(fs));

    await expect(tool.execute(null)).rejects.toThrow();
    await expect(tool.execute({})).rejects.toThrow();
    await expect(tool.execute({ source: '' })).rejects.toThrow();
    await expect(tool.execute({ source: 123 })).rejects.toThrow();
    await expect(tool.execute(undefined)).rejects.toThrow();
  });

  it('handles nested source paths correctly', async () => {
    fs.setFile('/workspace/private/test-cell/src/components/Button.tsx', 'export default Button;');
    const tool = createCommitFileTool(makeConfig(fs));

    const resultStr = await tool.execute({ source: 'src/components/Button.tsx' });
    const result = JSON.parse(resultStr);

    expect(result.status).toBe('committed');
    expect(fs.writtenFiles[0]!.path).toBe('/workspace/shared/src/components/Button.tsx');
  });
});
