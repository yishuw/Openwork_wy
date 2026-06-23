import { readFileSync } from 'fs';
import * as path from 'path';
import type { ITool, ToolInputSchema, ToolExecutionContext, ToolAnnotations } from '../../types/tool';
import { createLogger } from '../../logger';
import { LOG_CATEGORY } from '../../log-categories';
import {
  FILE_READ_TOOL_NAME,
  FILE_READ_TOOL_DESCRIPTION,
  FILE_READ_TOOL_USAGE,
  DEFAULT_MAX_LINES,
  MAX_OUTPUT_CHARS,
} from './prompt';

const log = createLogger(LOG_CATEGORY.FILE_OPS);

const inputSchema: ToolInputSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path to the file to read (resolved against workspace root)' },
    offset: {
      type: 'string',
      description: `1-based line number to start reading from (default: 1). Useful for paging through large files.`,
    },
    limit: {
      type: 'string',
      description: `Maximum number of lines to read (default: ${DEFAULT_MAX_LINES}).`,
    },
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

/** 给每一行加上 "  N→\t" 形式的行号前缀(cat -n style) */
function addLineNumbers(lines: string[], startLine: number): string {
  const width = String(startLine + lines.length - 1).length;
  return lines
    .map((line, i) => `${String(startLine + i).padStart(width, ' ')}\t${line}`)
    .join('\n');
}

export class FileReadTool implements ITool {
  readonly name = FILE_READ_TOOL_NAME;
  readonly description = FILE_READ_TOOL_DESCRIPTION;
  readonly usage = FILE_READ_TOOL_USAGE;
  readonly inputSchema = inputSchema;
  readonly annotations = annotations;

  async execute(params: Record<string, string>, context: ToolExecutionContext): Promise<string> {
    const startMs = Date.now();

    const offset = Math.max(1, parseInt(params.offset || '1', 10) || 1);
    const limit = Math.max(1, parseInt(params.limit || String(DEFAULT_MAX_LINES), 10) || DEFAULT_MAX_LINES);

    try {
      const absPath = resolvePath(context.workspaceRoot, params.path);
      const content = readFileSync(absPath, 'utf-8');
      const allLines = content.split('\n');

      // 1-based offset → 0-based slice
      const startIdx = offset - 1;
      const endIdx = Math.min(startIdx + limit, allLines.length);
      const slice = allLines.slice(startIdx, endIdx);

      if (slice.length === 0) {
        log.info(`read_file done: empty range`, { path: params.path, offset, limit, totalLines: allLines.length });
        return `## File: ${params.path}\n*(no lines in requested range; file has ${allLines.length} line(s))*`;
      }

      const numbered = addLineNumbers(slice, offset);

      let body = numbered;
      let truncated = false;
      if (body.length > MAX_OUTPUT_CHARS) {
        // 按字符截断,同时尽量回到行边界
        const cut = body.lastIndexOf('\n', MAX_OUTPUT_CHARS);
        body = cut > 0 ? body.slice(0, cut) : body.slice(0, MAX_OUTPUT_CHARS);
        truncated = true;
      }

      const totalLines = allLines.length;
      const readLines = slice.length;
      const header = `## File: ${params.path} (lines ${offset}-${offset + readLines - 1} of ${totalLines})`;
      const tail = truncated
        ? `\n\n... [output truncated at ${MAX_OUTPUT_CHARS} chars — narrow your offset/limit or use search_code to locate specific content] ...`
        : '';

      log.info(`read_file done: ${readLines} lines, ${body.length} chars, ${Date.now() - startMs}ms`, {
        path: params.path,
        offset,
        limit,
        readLines,
        totalLines,
        truncated,
      });

      return `${header}\n\`\`\`\n${body}\n\`\`\`${tail}`;
    } catch (e: any) {
      log.warn(`read_file failed: ${e.message}`, { path: params.path, error: e.message });
      return `Error reading ${params.path}: ${e.message}`;
    }
  }
}
