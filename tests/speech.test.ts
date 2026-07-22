import { describe, it, expect } from 'vitest';
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
