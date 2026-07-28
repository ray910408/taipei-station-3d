import { describe, it, expect, afterEach, vi } from 'vitest';
import { attachFpsOverlay } from '../src/fps';

/** 最小樁：fps.ts 只用到 document.createElement / body.append 與 location.search。 */
function stubDom(search: string): { textContent: string } {
  const el = { style: { cssText: '' }, textContent: '' };
  (globalThis as Record<string, unknown>).document = {
    createElement: () => el,
    body: { append: () => {} },
  };
  (globalThis as Record<string, unknown>).location = { search };
  return el;
}

/** 假 renderer：忠實模擬 three 的 info 語意——每個 pass 起手依 autoReset 決定是否歸零。 */
function fakeRenderer() {
  const info = {
    autoReset: true,
    render: { calls: 0 },
    reset(): void { info.render.calls = 0; },
  };
  return {
    info,
    /** 跑一個 render pass，畫了 calls 次 draw call。 */
    pass(calls: number): void {
      if (info.autoReset) info.reset();
      info.render.calls += calls;
    },
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).location;
  vi.restoreAllMocks();
});

describe('attachFpsOverlay', () => {
  it('假 renderer 確實複製 three 的 autoReset 語意（否則本檔守線是假的）', () => {
    const r = fakeRenderer();
    r.pass(200); r.pass(12); r.pass(1); // AO composer：主場景 + n8ao + OutputPass
    expect(r.info.render.calls).toBe(1); // 預設 autoReset → 只剩最後一道 quad，正是 ISSUE-005
  });

  it('沒有 ?fps=1 就不掛載，也不動 renderer 的 autoReset', () => {
    stubDom('');
    const r = fakeRenderer();
    expect(attachFpsOverlay(r as never)).toBeNull();
    expect(r.info.autoReset).toBe(true);
  });

  // QA ISSUE-005：AO 一幀多 pass，autoReset 會把計數洗成最後一個 pass。
  it('draw call 涵蓋整幀所有 pass，不是只有最後一道合成 quad', () => {
    const el = stubDom('?fps=1');
    const r = fakeRenderer();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const tick = attachFpsOverlay(r as never)!;
    expect(r.info.autoReset).toBe(false);

    r.pass(200); r.pass(12); r.pass(1);
    now.mockReturnValue(600); // 跨過 500ms 更新門檻
    tick();
    expect(el.textContent).toContain('draws 213');
  });

  it('跨幀不累加（autoReset 關掉後由 tick 負責每幀歸零）', () => {
    const el = stubDom('?fps=1');
    const r = fakeRenderer();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const tick = attachFpsOverlay(r as never)!;

    r.pass(200); r.pass(12); r.pass(1);
    now.mockReturnValue(600);
    tick();
    r.pass(200); r.pass(12); r.pass(1);
    now.mockReturnValue(1200);
    tick();
    expect(el.textContent).toContain('draws 213'); // 不是 426
  });

  it('未達 500ms 門檻的幀也會歸零，不會把中間幀累進下次顯示', () => {
    const el = stubDom('?fps=1');
    const r = fakeRenderer();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const tick = attachFpsOverlay(r as never)!;

    r.pass(200); r.pass(12); r.pass(1);
    now.mockReturnValue(100); // 未達門檻：不更新文字，但仍須歸零
    tick();
    r.pass(200); r.pass(12); r.pass(1);
    now.mockReturnValue(600);
    tick();
    expect(el.textContent).toContain('draws 213');
  });
});
