import { readdirSync } from 'fs';
import * as path from 'path';
import type { ITool, ToolInputSchema, ToolExecutionContext, ToolAnnotations } from '../../types/tool';
import { createLogger } from '../../logger';
import { LOG_CATEGORY } from '../../log-categories';
import {
  LIST_DIR_TOOL_NAME,
  LIST_DIR_TOOL_DESCRIPTION,
  LIST_DIR_TOOL_USAGE,
} from './prompt';

const log = createLogger(LOG_CATEGORY.FILE_OPS);

const inputSchema: ToolInputSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Absolute path to the directory to list' },
  },
  required: ['path'],
};

const annotations: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
};

function resolvePath(root: string, target: string): string {
  const abs = path.resolve(root, target);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error(`Path traversal not allowed: ${target}`);
  }
  return abs;
}

export class ListDirTool implements ITool {
  readonly name = LIST_DIR_TOOL_NAME;
  readonly description = LIST_DIR_TOOL_DESCRIPTION;
  readonly usage = LIST_DIR_TOOL_USAGE;
  readonly inputSchema = inputSchema;
  readonly annotations = annotations;

  async execute(params: Record<string, string>, context: ToolExecutionContext): Promise<string> {
    const startMs = Date.now();
    try {
      const absPath = resolvePath(context.workspaceRoot, params.path);
      const entries = readdirSync(absPath, { withFileTypes: true });

      if (entries.length === 0) {
        log.info(`list_dir done: empty`, { path: params.path });
        return `## Directory: ${params.path} (empty)`;
      }

      const lines = entries
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
        .map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}${e.isDirectory() ? '/' : ''}`);

      log.info(`list_dir done: ${entries.length} entries, ${Date.now() - startMs}ms`, { path: params.path, entries: entries.length });
      return `## Directory: ${params.path}\n${lines.join('\n')}`;
    } catch (e: any) {
      log.warn(`list_dir failed: ${e.message}`, { path: params.path, error: e.message });
      return `Error listing ${params.path}: ${e.message}`;
    }
  }
}
