/**
 * commit_file tool — copy a file from the cell's private workspace to the shared workspace.
 */
import { resolve, dirname } from 'node:path';

import { z } from 'zod';

import type { Tool } from './tool-executor.js';

export interface CommitFileFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export interface CommitFileConfig {
  fs: CommitFileFs;
  privatePath: string;   // /workspace/private/{cellName}
  sharedPath: string;    // /workspace/shared
}

export function createCommitFileTool(config: CommitFileConfig): Tool {
  return {
    name: 'commit_file',
    description: 'Copy a file from your private workspace to the shared workspace, making it available to other Cells.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Path relative to private workspace' },
        destination: { type: 'string', description: 'Path relative to shared workspace (defaults to same as source)' },
      },
      required: ['source'],
    },
    async execute(input: unknown): Promise<string> {
      const CommitFileInput = z.object({
        source: z.string().min(1, '"source" must be a non-empty string'),
        destination: z.string().optional(),
      });
      const parsed = CommitFileInput.parse(input);

      const dest = parsed.destination ?? parsed.source;

      // 1. Resolve paths
      const sourcePath = resolve(config.privatePath, parsed.source);
      const destPath = resolve(config.sharedPath, dest);

      // 2. Path traversal protection for source
      if (!sourcePath.startsWith(config.privatePath + '/') && sourcePath !== config.privatePath) {
        throw new Error('Path traversal not allowed: source must be within private workspace');
      }

      // 3. Path traversal protection for destination
      if (!destPath.startsWith(config.sharedPath + '/') && destPath !== config.sharedPath) {
        throw new Error('Path traversal not allowed: destination must be within shared workspace');
      }

      // 4. Read source file from private workspace
      const content = await config.fs.readFile(sourcePath);

      // 5. Create destination directory if needed
      const destDir = dirname(destPath);
      await config.fs.mkdir(destDir);

      // 6. Write to shared workspace
      await config.fs.writeFile(destPath, content);

      // 7. Return result
      return JSON.stringify({
        status: 'committed',
        source: parsed.source,
        destination: dest,
      });
    },
  };
}
