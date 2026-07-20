import { describe, it, expect } from 'vitest';
import { THEME, applyUITheme } from '../src/theme';

const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

function collectHexStrings(value: unknown, path = 'THEME', out: [string, string][] = []): [string, string][] {
  if (typeof value === 'string') {
    if (value.startsWith('#')) out.push([path, value]);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectHexStrings(v, `${path}.${k}`, out);
  }
  return out;
}

describe('THEME tokens', () => {
  it('所有 # 開頭字串皆為合法 hex 色票', () => {
    const found = collectHexStrings(THEME);
    expect(found.length).toBeGreaterThan(20);
    for (const [path, hex] of found) expect(hex, path).toMatch(HEX);
  });

  it('emphasis.dim 在 (0,1]', () => {
    expect(THEME.emphasis.dim).toBeGreaterThan(0);
    expect(THEME.emphasis.dim).toBeLessThanOrEqual(1);
  });

  it('applyUITheme 寫入全部 ui vars', () => {
    const calls: Record<string, string> = {};
    applyUITheme({ style: { setProperty: (k: string, v: string) => { calls[k] = v; } } });
    expect(calls).toEqual({ ...THEME.ui });
  });
});
