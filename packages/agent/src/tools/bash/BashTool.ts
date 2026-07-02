import { exec } from 'child_process';
import type { ITool, ToolInputSchema, ToolExecutionContext, ToolAnnotations } from '../../types/tool';
import { createLogger } from '../../logger';
import { LOG_CATEGORY } from '../../log-categories';
import {
  BASH_TOOL_NAME,
  BASH_TOOL_DESCRIPTION,
  BASH_TOOL_USAGE,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MAX_OUTPUT_LENGTH,
} from './prompt';

const log = createLogger(LOG_CATEGORY.FILE_OPS);

const inputSchema: ToolInputSchema = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'The command to execute' },
    timeout: {
      type: 'string',
      description: `Optional timeout in milliseconds (max ${MAX_TIMEOUT_MS}, default ${DEFAULT_TIMEOUT_MS})`,
    },
    description: { type: 'string', description: 'Description of what this command does (for logging)' },
  },
  required: ['command'],
};

const annotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export class BashTool implements ITool {
  readonly name = BASH_TOOL_NAME;
  readonly description = BASH_TOOL_DESCRIPTION;
  readonly usage = BASH_TOOL_USAGE;
  readonly inputSchema = inputSchema;
  readonly annotations = annotations;

  async execute(params: Record<string, string>, context: ToolExecutionContext): Promise<string> {
    const command = params.command.trim();
    if (!command) return 'Error: No command provided';

    const timeout = this.resolveTimeout(params.timeout);
    const description = params.description || '';
    const startMs = Date.now();
    const cmdPreview = command.length > 100 ? command.slice(0, 100) + '...' : command;

    return new Promise<string>(resolve => {
      const child = exec(command, {
        cwd: context.workspaceRoot,
        timeout,
        maxBuffer: 10 * 1024 * 1024,  // 10 MB stdout+stderr
        windowsHide: true,
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
      }, (error, stdout, stderr) => {
        const elapsed = Date.now() - startMs;
        if (child.killed) {
          log.warn(`bash timed out after ${elapsed}ms`, { command: cmdPreview, timeout });
          resolve(this.formatResult(command, description, '', 'Command timed out after timeout', true));
          return;
        }

        const exitCode = error?.code ?? 0;
        log.info(`bash done: exit=${exitCode}, stdout=${stdout.length} chars, stderr=${stderr.length} chars, ${elapsed}ms`, { command: cmdPreview, exitCode, stdoutLen: stdout.length, stderrLen: stderr.length });
        resolve(this.formatResult(command, description, stdout, stderr));
      });

      child.on('error', err => {
        log.warn(`bash error: ${err.message}`, { command: cmdPreview });
        resolve(`## Bash Error\nCommand: \`${command}\`\n\n${err.message}`);
      });
    });
  }

  private resolveTimeout(raw: string | undefined): number {
    if (!raw) return DEFAULT_TIMEOUT_MS;
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
    return Math.min(parsed, MAX_TIMEOUT_MS);
  }

  private formatResult(
    command: string,
    description: string,
    stdout: string,
    stderr: string,
    timedOut = false,
  ): string {
    const header = description
      ? `## Bash: ${description}\nCommand: \`${command}\``
      : `## Bash\nCommand: \`${command}\``;

    if (timedOut) {
      return `${header}\n\n**⚠ Command timed out**\n\n${this.truncate(stderr, 'stderr')}`;
    }

    const parts: string[] = [header];

    if (stdout) {
      parts.push(`### stdout\n\`\`\`\n${this.truncate(stdout, 'stdout')}\n\`\`\``);
    }
    if (stderr) {
      parts.push(`### stderr\n\`\`\`\n${this.truncate(stderr, 'stderr')}\n\`\`\``);
    }
    if (!stdout && !stderr) {
      parts.push('*(no output)*');
    }

    return parts.join('\n\n');
  }

  private truncate(content: string, label: string): string {
    if (content.length <= MAX_OUTPUT_LENGTH) return content;
    const omitted = content.length - MAX_OUTPUT_LENGTH;
    return content.slice(0, MAX_OUTPUT_LENGTH) +
      `\n\n... [${omitted} more characters of ${label} truncated] ...`;
  }
}
