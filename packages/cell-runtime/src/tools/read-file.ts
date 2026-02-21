/**
 * read_file tool — read a file from the workspace.
 */
import { resolve } from 'node:path';

import { z } from 'zod';

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
      const ReadFileInput = z.object({
        path: z.string().min(1, '"path" must be a non-empty string'),
      });
      const { path } = ReadFileInput.parse(input);

      // Resolve the path: if it starts with 'private/', use the cell's private area
      // Otherwise, treat as shared workspace
      let baseDir: string;
      let resolvedPath: string;
      if (path.startsWith('private/')) {
        baseDir = `/workspace/private/${config.cellName}`;
        resolvedPath = resolve(baseDir, path.slice('private/'.length));
      } else if (path.startsWith('shared/')) {
        baseDir = '/workspace/shared';
        resolvedPath = resolve(baseDir, path.slice('shared/'.length));
      } else {
        // Default to shared workspace
        baseDir = '/workspace/shared';
        resolvedPath = resolve(baseDir, path);
      }

      // I4: Path traversal protection
      if (!resolvedPath.startsWith(baseDir + '/') && resolvedPath !== baseDir) {
        throw new Error('Path traversal not allowed: path must be within workspace');
      }

      const content = await config.fs.readFile(resolvedPath, 'utf-8');

      if (content.length > MAX_FILE_LENGTH) {
        return content.substring(0, MAX_FILE_LENGTH) + '\n[truncated]';
      }

      return content;
    },
  };
}
