import { describe, it, expect, afterEach } from 'vitest';
import { pickVoice, createSpeaker } from '../src/speech';

const v = (lang: string): SpeechSynthesisVoice =>
  ({ lang, name: lang } as SpeechSynthesisVoice);

describe('pickVoice 偏好序', () => {
  it('zh-TW 優先', () => {
    expect(pickVoice([v('en-US'), v('zh-CN'), v('zh-TW')])?.lang).toBe('zh-TW');
  });

  it('zh_TW 底線格式也命中', () => {
    expect(pickVoice([v('en-US'), v('zh_TW')])?.lang).toBe('zh_TW');
  });

  it('無 zh-TW 退任一 zh-*', () => {
    expect(pickVoice([v('en-US'), v('zh-HK')])?.lang).toBe('zh-HK');
  });

  it('全無 zh 回 null（交給 utterance.lang）', () => {
    expect(pickVoice([v('en-US'), v('ja-JP')])).toBeNull();
  });
});

describe('createSpeaker（node 無 speechSynthesis）', () => {
  it('無環境時 speak 靜默不炸', () => {
    const sp = createSpeaker();
    sp.setEnabled(true);
    expect(() => sp.speak('測試')).not.toThrow();
  });
});

describe('createSpeaker（mock speechSynthesis——終審 F8 補強）', () => {
  const G = globalThis as Record<string, unknown>;
  interface MockSynth {
    spoken: string[]; cancels: number;
    cancel(): void; speak(u: SpeechSynthesisUtterance): void;
    getVoices(): SpeechSynthesisVoice[]; addEventListener(): void;
  }
  const mockSynth = (): MockSynth => {
    const m: MockSynth = {
      spoken: [], cancels: 0,
      cancel() { m.cancels++; },
      speak(u) { m.spoken.push(u.text); },
      getVoices: () => [{ lang: 'zh-TW', name: 'tw' } as SpeechSynthesisVoice],
      addEventListener() {},
    };
    return m;
  };
  afterEach(() => { delete G.speechSynthesis; delete G.SpeechSynthesisUtterance; });
  const setup = (): MockSynth => {
    const m = mockSynth();
    G.speechSynthesis = m;
    G.SpeechSynthesisUtterance = class { text: string; lang = ''; voice: unknown = null;
      constructor(t: string) { this.text = t; } };
    return m;
  };

  it('未啟用不出聲；啟用後 speak 前先 cancel（防 iOS 佇列凍結）', () => {
    const m = setup();
    const sp = createSpeaker();
    sp.speak('不該播');
    expect(m.spoken).toEqual([]);
    sp.setEnabled(true);
    sp.speak('下一步：直走');
    expect(m.spoken).toEqual(['下一步：直走']);
    expect(m.cancels).toBe(1); // speak 內的 cancel
  });

  it('setEnabled(false) 即噤聲並 cancel 殘句（終審 F4）', () => {
    const m = setup();
    const sp = createSpeaker();
    sp.setEnabled(true);
    sp.speak('a');
    const before = m.cancels;
    sp.setEnabled(false);
    expect(m.cancels).toBe(before + 1);
    sp.speak('b');
    expect(m.spoken).toEqual(['a']);
  });

  it('stop() cancel 殘句但不改 enabled 狀態', () => {
    const m = setup();
    const sp = createSpeaker();
    sp.setEnabled(true);
    sp.stop();
    expect(m.cancels).toBe(1);
    sp.speak('繼續播');
    expect(m.spoken).toEqual(['繼續播']);
  });
});
