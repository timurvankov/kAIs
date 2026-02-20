/**
 * read_file tool — read a file from the workspace.
 */
import type { Tool } from './tool-executor.js';

const MAX_FILE_LENGTH = 10000;

export interface FileSystem {
  readFile(path: string, encoding: 'utf-8'): Promise<string>;
}

export interface ReadFileConfig {
  cellName: string;
  fs: FileSystem;
}

export function createReadFileTool(config: ReadFileConfig): Tool {
  return {
    name: 'read_file',
    description: 'Read a file from the workspace. Paths can reference shared files or your private workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace (e.g., "shared/data.txt" or "private/notes.txt")' },
      },
      required: ['path'],
    },
    async execute(input: unknown): Promise<string> {
      const { path } = input as { path: string };

      if (!path) {
        throw new Error('"path" is required');
      }

      // Resolve the path: if it starts with 'private/', use the cell's private area
      // Otherwise, treat as shared workspace
      let resolvedPath: string;
      if (path.startsWith('private/')) {
        resolvedPath = `/workspace/private/${config.cellName}/${path.slice('private/'.length)}`;
      } else if (path.startsWith('shared/')) {
        resolvedPath = `/workspace/shared/${path.slice('shared/'.length)}`;
      } else {
        // Default to shared workspace
        resolvedPath = `/workspace/shared/${path}`;
      }

      const content = await config.fs.readFile(resolvedPath, 'utf-8');

      if (content.length > MAX_FILE_LENGTH) {
        return content.substring(0, MAX_FILE_LENGTH) + '\n[truncated]';
      }

      return content;
    },
  };
}
