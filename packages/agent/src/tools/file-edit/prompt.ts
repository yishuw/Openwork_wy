/** FileEditTool 提示词与常量 */

export const FILE_EDIT_TOOL_NAME = 'file_edit';

export const FILE_EDIT_TOOL_DESCRIPTION =
  'Edit an existing file by replacing an exact string. Supports single or all occurrences.';

export const FILE_EDIT_TOOL_USAGE = `
<file_edit path="path/to/file" [replace_all="false"]>
<old>
exact original text to find
</old>
<new>
replacement text
</new>
</file_edit>`.trim();

export const FILE_EDIT_TOOL_PROMPT = `Performs exact string replacements in an existing file.

Usage:
- Use \`read_file\` to read the file first. Edits without a prior read will fail.
- Place the original text inside <old>...</old> and the replacement inside <new>...</new> within the tool body.
- The <old> text must match EXACTLY — including whitespace, indentation, and newlines.
- The edit will FAIL if <old> is not unique in the file, unless replace_all="true" is set.
- Use replace_all="true" to replace every occurrence (e.g. renaming a variable).
- Prefer file_edit over file_write for small targeted changes — it only sends the diff.
- For creating new files or full rewrites, use \`file_write\` instead.`;
