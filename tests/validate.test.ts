import { describe, it, expect, beforeAll } from 'vitest';
import { loadRepoDocs, validateDocs } from '../tools/validate.mjs';

const FIXTURE = 'tests/fixtures/mini';

function freshDocs() {
  return loadRepoDocs(FIXTURE);
}

describe('validateDocs', () => {
  it('合法 fixture 無 errors', () => {
    const { errors } = validateDocs(freshDocs());
    expect(errors).toEqual([]);
  });

  it('schema 違規：station.schema 版本錯誤', () => {
    const docs = freshDocs();
    (docs.station as any).schema = 'station@2';
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('station.json'))).toBe(true);
  });

  it('參照：element source 不存在於 sources.json', () => {
    const docs = freshDocs();
    (docs.floors.get('hall-b1') as any).slab.source = 'nope';
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('nope'))).toBe(true);
  });

  it('參照：connector 指到不存在的 node', () => {
    const docs = freshDocs();
    (docs.connectors as any).connectors[0].levels[0].node = 'n-pl-999';
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('n-pl-999'))).toBe(true);
  });

  it('ID 前綴與樓層 short 不符', () => {
    const docs = freshDocs();
    (docs.floors.get('hall-b1') as any).areas[0].id = 'a-xx-paid';
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('a-xx-paid'))).toBe(true);
  });

  it('幾何：outline 順時針（應為逆時針）', () => {
    const docs = freshDocs();
    (docs.floors.get('plat-b2') as any).slab.outline.reverse();
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('逆時針'))).toBe(true);
  });

  it('幾何：node 落在 slab 外', () => {
    const docs = freshDocs();
    (docs.floors.get('plat-b2') as any).nav.nodes[0].xy = [99, 99];
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('n-pl-001'))).toBe(true);
  });

  it('語意：非 both 閘門的 gate edge 不可 bidir', () => {
    const docs = freshDocs();
    (docs.floors.get('hall-b1') as any).nav.edges[0].bidir = true;
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('g-ha-out'))).toBe(true);
  });

  it('語意：connector levels 高程須遞增', () => {
    const docs = freshDocs();
    (docs.connectors as any).connectors[0].levels.reverse();
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('c-esc-plha-1'))).toBe(true);
  });

  it('calibration：px_per_m 與控制點不一致 → warning', () => {
    const docs = freshDocs();
    (docs.sources as any).sources[0].calibration = {
      px_per_m: 99, basis: '測試', status: 'estimated',
      control_points: [
        { px: [0, 0], local: [0, 0] },
        { px: [100, 0], local: [10, 0] },
      ],
    };
    const { errors, warnings } = validateDocs(docs);
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes('test-src') && w.includes('px_per_m'))).toBe(true);
  });

  it('calibration：控制點重複 → error', () => {
    const docs = freshDocs();
    (docs.sources as any).sources[0].calibration = {
      px_per_m: 10, basis: '測試', status: 'estimated',
      control_points: [{ px: [5, 5], local: [0, 0] }, { px: [5, 5], local: [10, 0] }],
    };
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('控制點重複'))).toBe(true);
  });

  it('status=traced 但來源無 calibration → warning', () => {
    const docs = freshDocs();
    (docs.floors.get('hall-b1') as any).slab.status = 'traced';
    const { warnings } = validateDocs(docs);
    expect(warnings.some((w) => w.includes('traced') && w.includes('test-src'))).toBe(true);
  });
});
