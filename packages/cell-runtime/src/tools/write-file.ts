/**
 * write_file tool — write a file to the Cell's private workspace.
 */
import type { Tool } from './tool-executor.js';

export interface WriteFileSystem {
  writeFile(path: string, content: string, encoding: 'utf-8'): Promise<void>;
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
}

export interface WriteFileConfig {
  cellName: string;
  fs: WriteFileSystem;
}

export function createWriteFileTool(config: WriteFileConfig): Tool {
  return {
    name: 'write_file',
    description: 'Write a file to your private workspace area.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to your private workspace' },
        content: { type: 'string', description: 'The content to write to the file' },
      },
      required: ['path', 'content'],
    },
    async execute(input: unknown): Promise<string> {
      const { path, content } = input as { path: string; content: string };

      if (!path || content === undefined) {
        throw new Error('Both "path" and "content" are required');
      }

      const resolvedPath = `/workspace/private/${config.cellName}/${path}`;

      // Ensure directory exists
      const dirPath = resolvedPath.substring(0, resolvedPath.lastIndexOf('/'));
      await config.fs.mkdir(dirPath, { recursive: true });

      await config.fs.writeFile(resolvedPath, content, 'utf-8');

      return `File written to ${path} (${content.length} bytes)`;
    },
  };
}
