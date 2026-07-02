/** DelegateTool 提示词 — 告诉 LLM 如何委托子 Agent */

export const DELEGATE_TOOL_NAME = 'delegate';

export const DELEGATE_TOOL_DESCRIPTION = 'Delegate a task to a sub-agent';

export const DELEGATE_TOOL_USAGE = '<delegate agent="sub-agent-id" task="task description"/>';

export const DELEGATE_TOOL_PROMPT = `Delegate a task to a registered sub-agent.

Usage:
- Use this tool when a task benefits from being handled by a specialized sub-agent.
- Provide the sub-agent ID and a clear task description.
- The Session orchestrator will route the task to the sub-agent after the main agent returns.
- This tool only records the delegation request; actual execution happens post-turn.`;
