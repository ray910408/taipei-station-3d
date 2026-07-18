import { describe, it, expect } from 'vitest';
import station from '../data/station.json';
import { formatDataJson } from '../tools/format-data.mjs';

describe('formatDataJson', () => {
  it('純數字陣列單行、物件多行縮排', () => {
    expect(formatDataJson({ a: [1, 2.5], b: 'x' })).toBe('{\n  "a": [1, 2.5],\n  "b": "x"\n}\n');
  });

  it('座標環：外層多行、每個座標對單行', () => {
    const out = formatDataJson({ outline: [[0, 0], [10, 0], [10, 5]] });
    expect(out).toBe('{\n  "outline": [\n    [0, 0],\n    [10, 0],\n    [10, 5]\n  ]\n}\n');
  });

  it('roundtrip 與冪等', () => {
    const v = { schema: 'floor@1', slab: { outline: [[-1.5, 2], [3, 4], [0, 9]], holes: [] }, n: null, empty: {} };
    const once = formatDataJson(v);
    expect(JSON.parse(once)).toEqual(v);
    expect(formatDataJson(JSON.parse(once))).toBe(once);
  });

  it('真實資料 roundtrip 不失真', () => {
    const raw = station;
    expect(JSON.parse(formatDataJson(raw))).toEqual(raw);
  });
});
