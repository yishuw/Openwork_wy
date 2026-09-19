import { describe, it, expect } from 'vitest';
import { ListDirTool } from '../src/tools/list-dir';
import { FileReadTool } from '../src/tools/file-read';
import { BashTool } from '../src/tools/bash';
import { FileWriteTool } from '../src/tools/file-write';
import { MISSING_WORKSPACE_TOOL_ERROR } from '../src/tools/_shared/workspace-gate';
import { resolveEffectiveSystemPrompt } from '../src/runtime';

const ctxNoWs = {
  workspaceRoot: '',
  readFileState: new Set<string>(),
};

const ctxUndefined = {
  workspaceRoot: undefined as unknown as string,
  readFileState: new Set<string>(),
};

describe('no-workspace tool gate', () => {
  it('list_dir returns friendly error without workspace', async () => {
    const tool = new ListDirTool();
    const r = await tool.execute({ path: '.' }, ctxNoWs as any);
    expect(r).toContain('未打开工作区');
    expect(r).toBe(MISSING_WORKSPACE_TOOL_ERROR);
  });

  it('read_file returns friendly error without workspace', async () => {
    const tool = new FileReadTool();
    const r = await tool.execute({ path: 'a.txt' }, ctxNoWs as any);
    expect(r).toContain('未打开工作区');
  });

  it('bash returns friendly error without workspace', async () => {
    const tool = new BashTool();
    const r = await tool.execute({ command: 'echo hi' }, ctxNoWs as any);
    expect(r).toContain('未打开工作区');
  });

  it('file_write returns friendly error without workspace', async () => {
    const tool = new FileWriteTool();
    const r = await tool.execute({ path: 'x.txt', content: 'hi' }, ctxUndefined as any);
    expect(r).toContain('未打开工作区');
  });

  it('system prompt notes missing workspace when root empty', () => {
    const p = resolveEffectiveSystemPrompt('BASE', '');
    expect(p).toContain('No workspace is open');
    expect(p).toContain('未打开工作区');
    expect(resolveEffectiveSystemPrompt('BASE', '/tmp/ws')).toBe('BASE');
  });

  it('resolveEffectiveSystemPrompt treats whitespace root as no workspace', () => {
    expect(resolveEffectiveSystemPrompt('BASE', '   ')).toContain('No workspace is open');
  });
});
