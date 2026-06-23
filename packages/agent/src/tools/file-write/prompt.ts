/** FileWriteTool 提示词与常量 */

export const FILE_WRITE_TOOL_NAME = 'file_write';

export const FILE_WRITE_TOOL_DESCRIPTION =
  'Write a file to the local filesystem. Creates a new file or overwrites an existing one. RESERVED for new files or full rewrites — use file_edit for partial changes.';

export const FILE_WRITE_TOOL_USAGE = '<file_write path="path/to/file">\nfull file content here\n</file_write>';

export const FILE_WRITE_TOOL_PROMPT = `Writes a file to the local filesystem, creating parent directories as needed.

**When to use this tool (strict):**
- Creating a NEW file that does not exist yet, OR
- A COMPLETE rewrite where the change touches the majority of the file's lines.

**When NOT to use this tool:**
- Modifying a few lines of an existing file → use \`file_edit\` instead (sends only the diff, much cheaper).

Usage:
- The path is resolved against the workspace root and must stay inside it.
- The tool body (between <file_write ...> and </file_write>) is the FULL file content. Do NOT wrap it in Markdown code fences.
- If the file already exists, it will be OVERWRITTEN — and a prior \`read_file\` of the same path in this session is REQUIRED (the tool will refuse otherwise).
- The body must be the exact final file content. Do not escape or CDATA-wrap it.`;
