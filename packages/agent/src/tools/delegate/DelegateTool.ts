import type { ITool, ToolInputSchema, ToolExecutionContext } from '../../types/tool';
import { hasWorkspaceRoot, missingWorkspaceToolError } from '../_shared/workspace-gate';
import {
  DELEGATE_TOOL_NAME,
  DELEGATE_TOOL_DESCRIPTION,
  DELEGATE_TOOL_USAGE,
} from './prompt';

const inputSchema: ToolInputSchema = {
  type: 'object',
  properties: {
    agent: { type: 'string', description: 'Sub-agent ID to delegate to' },
    task: { type: 'string', description: 'Task description for the sub-agent' },
  },
  required: ['agent', 'task'],
};

export class DelegateTool implements ITool {
  readonly name = DELEGATE_TOOL_NAME;
  readonly description = DELEGATE_TOOL_DESCRIPTION;
  readonly usage = DELEGATE_TOOL_USAGE;
  readonly inputSchema = inputSchema;

  /** Session 会拦截委托并在后置处理中真正启动子 Agent */
  async execute(params: Record<string, string>, context: ToolExecutionContext): Promise<string> {
    if (!hasWorkspaceRoot(context.workspaceRoot)) return missingWorkspaceToolError();
    return `[Delegation to "${params.agent}" recorded — Session will handle it]`;
  }
}
