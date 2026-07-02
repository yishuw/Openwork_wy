/** FileEditTool 提示词与常量 */

export const FILE_EDIT_TOOL_NAME = 'file_edit';

export const FILE_EDIT_TOOL_DESCRIPTION =
  'Edit an existing file by replacing an exact string. PREFERRED over file_write for any partial change. Supports single or all occurrences.';

export const FILE_EDIT_TOOL_USAGE = `
<file_edit path="path/to/file" [replace_all="false"]>
<old>
exact original text to find
</old>
<new>
replacement text
</new>
</file_edit>`.trim();

export const FILE_EDIT_TOOL_PROMPT = `Performs exact string replacements in an existing file. This is the DEFAULT tool for modifying files.

When to use this tool:
- Modifying one or more lines of an existing file. Sends only the diff, so it is cheap.

When NOT to use this tool:
- Creating a new file → use \`file_write\`.
- A complete rewrite where the change touches the majority of the file → use \`file_write\`.

Usage:
- A prior \`read_file\` of the same path in this session is REQUIRED (the tool will refuse otherwise).
- Place the original text inside <old>...</old> and the replacement inside <new>...</new> within the tool body.
- The <old> text must match EXACTLY — including whitespace, indentation, and newlines.
- The edit will FAIL if <old> is not unique in the file, unless replace_all="true" is set.
- Use replace_all="true" to replace every occurrence (e.g. renaming a variable).`;
