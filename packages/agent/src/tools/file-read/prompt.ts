/** FileReadTool 提示词与常量 */

export const FILE_READ_TOOL_NAME = 'read_file';

export const FILE_READ_TOOL_DESCRIPTION = 'Read a file from the local filesystem.';

export const FILE_READ_TOOL_USAGE = '<read_file path="path/to/file" [offset="1" limit="2000"/>';

/** 默认单次最大读取行数,与 open-claude FileReadTool 对齐 */
export const DEFAULT_MAX_LINES = 2000;

/** 单次返回字符上限,防止超大文件把上下文打爆 */
export const MAX_OUTPUT_CHARS = 256 * 1024;

export const FILE_READ_TOOL_PROMPT = `Reads a file from the local filesystem.

Usage:
- The path is resolved against the workspace root and must stay inside it.
- Output is prefixed with line numbers (cat -n style, starting at 1).
- By default reads up to ${DEFAULT_MAX_LINES} lines from the beginning of the file.
- For large files, provide offset (1-based line number to start from) and limit (number of lines to read) to page through the file.
- Total output is capped at ${MAX_OUTPUT_CHARS} characters; longer reads are truncated with a marker.
- If the file does not exist, returns a clear error message.`;
