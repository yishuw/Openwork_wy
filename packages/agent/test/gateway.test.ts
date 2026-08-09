import { describe, it, expect } from 'vitest';
import { maskApiKey } from '../src/llm/gateway';

describe('maskApiKey', () => {
  it('keeps first 4 and last 4 chars, stars the middle', () => {
    const key = 'sk-abcdef1234567890';
    const masked = maskApiKey(key);
    expect(masked).toHaveLength(key.length);
    expect(masked.slice(0, 4)).toBe(key.slice(0, 4));
    expect(masked.slice(-4)).toBe(key.slice(-4));
    expect(masked.slice(4, -4)).toBe('*'.repeat(key.length - 8));
    expect(masked).not.toContain('abcdef1234567890');
  });

  it('returns short keys unmasked', () => {
    expect(maskApiKey('sk')).toBe('sk');
    expect(maskApiKey('12345678')).toBe('12345678');
  });

  it('returns falsy input as-is', () => {
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey(undefined as unknown as string)).toBeUndefined();
  });
});
