import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import * as path from 'path';
import type { ITool, ToolInputSchema, ToolExecutionContext, ToolAnnotations } from '../../types/tool';
import { createLogger } from '../../logger';
import { LOG_CATEGORY } from '../../log-categories';
import {
  FILE_WRITE_TOOL_NAME,
  FILE_WRITE_TOOL_DESCRIPTION,
  FILE_WRITE_TOOL_USAGE,
} from './prompt';

const log = createLogger(LOG_CATEGORY.FILE_OPS);

const inputSchema: ToolInputSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path to the file to write (resolved against workspace root)' },
    content: {
      type: 'string',
      description: 'Full file content. Passed as the tag body, not as an attribute.',
    },
  },
  required: ['path', 'content'],
};

const annotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

function resolvePath(root: string, target: string): string {
  const abs = path.resolve(root, target);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error(`Path traversal not allowed: ${target}`);
  }
  return abs;
}

export class FileWriteTool implements ITool {
  readonly name = FILE_WRITE_TOOL_NAME;
  readonly description = FILE_WRITE_TOOL_DESCRIPTION;
  readonly usage = FILE_WRITE_TOOL_USAGE;
  readonly inputSchema = inputSchema;
  readonly annotations = annotations;
  /** Tool body carries the full file content; see parser.ts body-kind handling. */
  readonly body = 'content' as const;

  async execute(params: Record<string, string>, context: ToolExecutionContext): Promise<string> {
    const startMs = Date.now();
    const target = params.path;
    // body 内容由 parser 注入到 params.content,这里保证它是字符串(空串也是合法)
    const content = params.content ?? '';

    try {
      const absPath = resolvePath(context.workspaceRoot, target);
      const existed = existsSync(absPath);
      const oldBytes = existed ? readFileSync(absPath, 'utf-8').length : 0;

      // 确保父目录存在
      const parent = path.dirname(absPath);
      if (!existsSync(parent)) {
        mkdirSync(parent, { recursive: true });
      }

      writeFileSync(absPath, content, 'utf-8');

      const newBytes = Buffer.byteLength(content, 'utf-8');
      const newLines = content === '' ? 0 : content.split('\n').length;
      const kind = existed ? 'overwritten' : 'created';

      log.info(`file_write ${kind}: ${newBytes} bytes, ${newLines} lines, ${Date.now() - startMs}ms`, {
        path: target,
        kind,
        oldBytes,
        newBytes,
        newLines,
      });

      return `## File ${kind}: ${target}\n- size: ${newBytes} bytes\n- lines: ${newLines}${existed ? `\n- previous size: ${oldBytes} bytes (overwritten)` : ''}`;
    } catch (e: any) {
      log.warn(`file_write failed: ${e.message}`, { path: target, error: e.message });
      return `Error writing ${target}: ${e.message}`;
    }
  }
}
