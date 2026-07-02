import type { ITool } from '../types/tool';
import { BashTool } from './bash';
import { ListDirTool } from './list-dir';
import { SearchCodeTool } from './search-code';
import { DelegateTool } from './delegate';
import { FileReadTool } from './file-read';
import { FileWriteTool } from './file-write';
import { FileEditTool } from './file-edit';

export { BashTool } from './bash';
export { ListDirTool } from './list-dir';
export { SearchCodeTool } from './search-code';
export { DelegateTool } from './delegate';
export { FileReadTool } from './file-read';
export { FileWriteTool } from './file-write';
export { FileEditTool } from './file-edit';

/** 创建 Agent 默认工具集。
 *
 * 工具顺序即注册顺序,也是 ToolRegistry.buildSystemPromptSection()
 * 渲染给 LLM 的顺序——靠前的工具被 LLM 优先采用。
 * 因此把高频/首选工具放前面:
 *   1. file_edit   —— 改文件的首选(只发 diff)
 *   2. file_write  —— 仅用于新建或整文件重写(默认场景禁用)
 *   3. read_file   —— 编辑前必读(支撑 file_edit/file_write 的前置校验)
 *   4-7. 其余探索 / 执行 / 委托工具
 */
export function createDefaultTools(): ITool[] {
  return [
    new FileEditTool(),
    new FileWriteTool(),
    new FileReadTool(),
    new ListDirTool(),
    new SearchCodeTool(),
    new BashTool(),
    new DelegateTool(),
  ];
}
