import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { listLandmarks } from '../src/nav';
import stationDoc from '../data/station.json';
import connectorsDoc from '../data/connectors.json';
import tc from '../data/floors/tra-concourse-b1.json';
import tp from '../data/floors/tra-platform-b2.json';
import rc from '../data/floors/mrt-r-concourse-b3.json';
import rp from '../data/floors/mrt-r-platform-b4.json';

const model = assembleModel(stationDoc, {
  'floors/tra-concourse-b1.json': tc,
  'floors/tra-platform-b2.json': tp,
  'floors/mrt-r-concourse-b3.json': rc,
  'floors/mrt-r-platform-b4.json': rp,
}, connectorsDoc);

describe('地標池（終審 mutation audit #2：mojibake 回歸鎖）', () => {
  it('共 47 個地標，含四區地下街與原有 17 名精確值', () => {
    const byId = new Map(listLandmarks(model).map((l) => [l.id, l.label]));
    expect(byId.size).toBe(47);
    const expected: Record<string, string> = {
      'n-rp-002': '淡水信義線月台 南端電梯口',
      'n-rp-004': '淡水信義線月台 北梯群口',
      'n-rp-006': '淡水信義線月台 中段電梯口',
      'n-rc-002': 'R線大廳 北梯群口（付費區）',
      'n-rc-005': '臺鐵轉乘閘門外（B3 非付費）',
      'n-rc-007': 'B3 往B1 長電扶梯口',
      'n-rc-008': 'R線大廳 北寬閘門內（付費區）',
      'n-rc-010': 'R線大廳 南端電梯口（付費區）',
      'n-rc-011': 'B3 往B1 電梯口',
      'n-rc-014': 'R線大廳 中段電梯口（付費區）',
      'n-rc-017': 'B3 臺鐵轉乘區 第4月台梯口',
      'n-rc-018': 'B3 臺鐵轉乘區 第3月台梯口',
      'n-tp-001': '臺鐵第4月台（轉乘梯口）',
      'n-tp-003': '臺鐵第3月台（轉乘梯口）',
      'n-tc-005': 'B1 東剪票口 寬閘門外',
      'n-tc-007': 'B1 付費島 第4月台梯口',
      'n-tc-008': 'B1 付費島 第3月台梯口',
      'n-tc-y-west': 'Y28 北門站連通口',
      'n-tc-z-east': '站前地下街 Z 區東端',
      'n-tc-r-north': 'R9 中山站連通口',
      'n-tc-k-west': 'K12 機場捷運方向',
    };
    for (const [id, label] of Object.entries(expected)) expect(byId.get(id), id).toBe(label);
    for (const label of byId.values()) expect(label).not.toMatch(/\?/);
  });
});
