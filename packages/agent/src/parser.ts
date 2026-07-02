import type { ToolRegistry } from './tool-registry';

/** 从 LLM 回复中解析出的工具调用 */
export interface ParsedTool {
  type: string;
  params: Record<string, string>;
}

/**
 * 从 LLM 回复文本中解析工具调用标签。
 *
 * 支持三种语法形：
 *   1. 自闭标签：<read_file path="src/app.ts"/>
 *   2. content body：<file_write path="src/foo.ts">full file here</file_write>
 *   3. children body：<file_edit path="x"><old>...</old><new>...</new></file_edit>
 *
 * 哪种语法有效取决于工具本身的 `body` 声明（通过 ToolRegistry.getBodyMode 查询）。
 * 解析策略：先尝试匹配带闭合标签的形式，再回退到自闭合形式。
 */
export function parseToolCalls(text: string, registry: ToolRegistry): ParsedTool[] {
  const tools: ParsedTool[] = [];
  const seen = new Set<number>();

  // 先匹配带 body 的标签：<tag attrs>...</tag>
  // body 支持跨多行;[\\s\\S]*? 非贪婪避免一次吃到文件结尾
  const bodyRe = /<(\w+)([^>]*?)>([\s\S]*?)<\/\1\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = bodyRe.exec(text)) !== null) {
    const tag = m[1];
    const attrStr = m[2] || '';
    const body = m[3] ?? '';
    const bodyMode = registry.getBodyMode(tag);
    if (!bodyMode) {
      // 工具不支持 body —— 跳过,留给自闭合扫描处理
      continue;
    }
    const params = parseAttrs(attrStr);
    if (bodyMode === 'content') {
      params.content = body;
    } else {
      // children 模式:从 body 中提取所有 <key>value</key>
      const childRe = /<(\w+)>([\s\S]*?)<\/\1\s*>/g;
      let cm: RegExpExecArray | null;
      while ((cm = childRe.exec(body)) !== null) {
        params[cm[1]] = cm[2] ?? '';
      }
    }
    // 用整体匹配的索引去重,防止自闭合再扫一次产生重复
    seen.add(m.index);
    tools.push({ type: tag, params });
  }

  // 再匹配自闭合标签:<tag attr="..." />
  // 避开已识别为带 body 的位置
  const selfRe = /<(\w+)([^>]*?)\s*\/>/g;
  while ((m = selfRe.exec(text)) !== null) {
    if (seen.has(m.index)) continue;
    const tag = m[1];
    if (!registry.has(tag)) continue;
    const params = parseAttrs(m[2] || '');
    tools.push({ type: tag, params });
  }

  return tools;
}

/** 解析属性字符串 `path="x" max="3"` 为 {path:"x",max:"3"} */
function parseAttrs(attrStr: string): Record<string, string> {
  const params: Record<string, string> = {};
  const attrRe = /(\w+)="([^"]*)"/g;
  let am: RegExpExecArray | null;
  while ((am = attrRe.exec(attrStr)) !== null) {
    params[am[1]] = am[2];
  }
  return params;
}

