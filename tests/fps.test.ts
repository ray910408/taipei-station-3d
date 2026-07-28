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

  // PR #5 review：掛載點（main.ts:104）之後還有 PMREM 環境貼圖預濾等 boot 期 render。
  // 提早關掉 autoReset 會把那些 draw call 累進第一次讀數——boot 超過 500ms 的裝置上，
  // 第一格數字會是開機統計而不是首幀。
  it('掛載時不接手 autoReset；第一次 tick 才接手並丟掉 boot 期統計', () => {
    const el = stubDom('?fps=1');
    const r = fakeRenderer();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const tick = attachFpsOverlay(r as never)!;
    expect(r.info.autoReset).toBe(true); // 掛載時不動它

    r.pass(500);              // boot 期 render（PMREM 等）
    now.mockReturnValue(900); // boot 花了 900ms，已跨過 500ms 門檻
    tick();                   // 第一次 tick
    expect(r.info.autoReset).toBe(false);
    expect(el.textContent).toBe(''); // 不把開機統計當成首幀顯示出來

    r.pass(200); r.pass(12); r.pass(1);
    now.mockReturnValue(1500);
    tick();
    expect(el.textContent).toContain('draws 213');
  });

  /** 走完「第一次 tick 接手」的起手式，回傳可直接量測的 tick。 */
  function started(r: ReturnType<typeof fakeRenderer>, now: { mockReturnValue: (v: number) => void }) {
    const tick = attachFpsOverlay(r as never)!;
    now.mockReturnValue(0);
    tick();
    return tick;
  }

  // QA ISSUE-005：AO 一幀多 pass，autoReset 會把計數洗成最後一個 pass。
  it('draw call 涵蓋整幀所有 pass，不是只有最後一道合成 quad', () => {
    const el = stubDom('?fps=1');
    const r = fakeRenderer();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const tick = started(r, now);

    r.pass(200); r.pass(12); r.pass(1);
    now.mockReturnValue(600); // 跨過 500ms 更新門檻
    tick();
    expect(el.textContent).toContain('draws 213');
  });

  it('跨幀不累加（autoReset 關掉後由 tick 負責每幀歸零）', () => {
    const el = stubDom('?fps=1');
    const r = fakeRenderer();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const tick = started(r, now);

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
    const tick = started(r, now);

    r.pass(200); r.pass(12); r.pass(1);
    now.mockReturnValue(100); // 未達門檻：不更新文字，但仍須歸零
    tick();
    r.pass(200); r.pass(12); r.pass(1);
    now.mockReturnValue(600);
    tick();
    expect(el.textContent).toContain('draws 213');
  });
});
