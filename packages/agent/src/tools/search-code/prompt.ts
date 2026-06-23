/** SearchCodeTool 提示词与常量 */

export const SEARCH_CODE_TOOL_NAME = 'search_code';

export const SEARCH_CODE_TOOL_DESCRIPTION = 'Search code with regex pattern';

export const SEARCH_CODE_TOOL_USAGE = '<search_code pattern="regex" [path="dir" maxResults="20"/>';

export const SEARCH_CODE_TOOL_PROMPT = `Search code with a regex pattern.

Usage:
- Recursively searches files under the given path (default: workspace root).
- Skips common noise directories: node_modules, .git, dist, .vibeeditor.
- Results are formatted as \`relative/path:line: matched-line\` (line truncated to 120 chars).
- Use maxResults to cap the number of matches (default 20).`;
