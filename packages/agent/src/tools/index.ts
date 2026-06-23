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

/** 创建 Agent 默认工具集 */
export function createDefaultTools(): ITool[] {
  return [
    new FileReadTool(),
    new FileWriteTool(),
    new FileEditTool(),
    new ListDirTool(),
    new SearchCodeTool(),
    new BashTool(),
    new DelegateTool(),
  ];
}
