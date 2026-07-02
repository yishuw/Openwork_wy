/** ListDirTool 提示词与常量 */

export const LIST_DIR_TOOL_NAME = 'list_dir';

export const LIST_DIR_TOOL_DESCRIPTION = 'List directory contents';

export const LIST_DIR_TOOL_USAGE = '<list_dir path="path/to/dir"/>';

export const LIST_DIR_TOOL_PROMPT = `List directory contents.

Usage:
- Returns a sorted listing of the directory (directories first, then files, alphabetically).
- Directories are suffixed with "/" and a folder icon; files get a file icon.
- The path is resolved against the workspace root and must stay inside it.`;
