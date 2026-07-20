import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { THEME } from '../src/theme';

describe('index.html :root fallback 與 THEME.ui 同步（防 first-paint 閃色）', () => {
  it('每個 ui var 的字面值出現在 :root 區塊', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const root = /:root\s*\{([^}]*)\}/.exec(html)?.[1] ?? '';
    for (const [k, v] of Object.entries(THEME.ui)) {
      expect(root, k).toContain(`${k}: ${v}`);
    }
  });
});
