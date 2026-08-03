import { describe, it, expect } from 'vitest';
import { createDefaultTools } from '../src/tools/index';

describe('createDefaultTools', () => {
  it('registers 7 tools by default', () => {
    const tools = createDefaultTools();
    expect(tools.map(t => t.name)).toEqual([
      'file_edit',
      'file_write',
      'read_file',
      'list_dir',
      'search_code',
      'bash',
      'delegate',
    ]);
  });

  it('excludes bash tool when enableBash is false', () => {
    const tools = createDefaultTools({ enableBash: false });
    expect(tools.some(t => t.name === 'bash')).toBe(false);
    expect(tools.map(t => t.name)).toEqual([
      'file_edit',
      'file_write',
      'read_file',
      'list_dir',
      'search_code',
      'delegate',
    ]);
  });

  it('keeps bash enabled by default', () => {
    expect(createDefaultTools({}).some(t => t.name === 'bash')).toBe(true);
  });
});
