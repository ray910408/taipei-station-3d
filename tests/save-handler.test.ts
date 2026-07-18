import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// @ts-expect-error -- 專案未安裝 @types/node，但 Vitest runtime 提供 Node API
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
// @ts-expect-error -- 專案未安裝 @types/node，但 Vitest runtime 提供 Node API
import { tmpdir } from 'node:os';
// @ts-expect-error -- 專案未安裝 @types/node，但 Vitest runtime 提供 Node API
import path from 'node:path';
import { applySave } from '../tools/save-handler.mjs';
import { formatDataJson } from '../tools/format-data.mjs';

let root: string;
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const readDoc = (rel: string) => JSON.parse(read(rel));

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'tracer-save-'));
  cpSync('tests/fixtures/mini', root, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('applySave', () => {
  it('合法修改：寫入且為 canonical 格式', () => {
    const hall = readDoc('data/floors/hall-b1.json');
    hall.slab.outline[0] = [-11, -5];
    const r = applySave(root, [{ file: 'data/floors/hall-b1.json', doc: hall }]);
    expect(r).toEqual({ ok: true, errors: [], written: ['data/floors/hall-b1.json'] });
    const after = read('data/floors/hall-b1.json');
    expect(JSON.parse(after).slab.outline[0]).toEqual([-11, -5]);
    expect(after).toBe(formatDataJson(JSON.parse(after)));
  });

  it('驗證失敗不寫檔（outline 反繞向）', () => {
    const before = read('data/floors/plat-b2.json');
    const plat = JSON.parse(before);
    plat.slab.outline.reverse();
    const r = applySave(root, [{ file: 'data/floors/plat-b2.json', doc: plat }]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e: string) => e.includes('逆時針'))).toBe(true);
    expect(read('data/floors/plat-b2.json')).toBe(before);
  });

  it('多檔整批：任一檔壞 → 全部不寫', () => {
    const hall = readDoc('data/floors/hall-b1.json');
    hall.slab.outline[0] = [-12, -5];
    const plat = readDoc('data/floors/plat-b2.json');
    plat.slab.outline.reverse();
    const before = read('data/floors/hall-b1.json');
    const r = applySave(root, [
      { file: 'data/floors/hall-b1.json', doc: hall },
      { file: 'data/floors/plat-b2.json', doc: plat },
    ]);
    expect(r.ok).toBe(false);
    expect(read('data/floors/hall-b1.json')).toBe(before);
  });

  it('路徑白名單：repo 外與非資料檔一律拒絕', () => {
    for (const file of ['package.json', '../evil.json', 'data/../package.json', 'data/floors/../../package.json']) {
      const r = applySave(root, [{ file, doc: {} }]);
      expect(r.ok, file).toBe(false);
      expect(r.errors[0], file).toContain('不允許');
    }
  });

  it('不在 station floors 清單的樓層檔拒絕', () => {
    const r = applySave(root, [{ file: 'data/floors/nope.json', doc: { schema: 'floor@1' } }]);
    expect(r.ok).toBe(false);
  });

  it('sources.json 可寫（含 calibration）', () => {
    const sources = readDoc('refs/sources.json');
    sources.sources[0].calibration = {
      px_per_m: 10, basis: '測試基準', status: 'estimated',
      control_points: [{ px: [0, 0], local: [0, 0] }, { px: [100, 0], local: [10, 0] }],
    };
    const r = applySave(root, [{ file: 'refs/sources.json', doc: sources }]);
    expect(r.ok).toBe(true);
    expect(readDoc('refs/sources.json').sources[0].calibration.px_per_m).toBe(10);
  });
});
