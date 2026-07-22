// 語音播報（Phase 4）：SpeechSynthesis zh-TW。
// iOS 需在使用者手勢內先 speak 一次解鎖——toggle 開啟時的確認語即 unlock。

/** 偏好序：zh-TW → 任一 zh-* → null（null 時仍設 utterance.lang 交系統挑）。 */
export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const norm = (lang: string): string => lang.replace('_', '-').toLowerCase();
  return voices.find((v) => norm(v.lang) === 'zh-tw')
    ?? voices.find((v) => norm(v.lang).startsWith('zh')) ?? null;
}

export interface Speaker { setEnabled(on: boolean): void; speak(text: string): void }

export function createSpeaker(): Speaker {
  const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  let on = false;
  let voice: SpeechSynthesisVoice | null = null;
  const refresh = (): void => { if (synth) voice = pickVoice(synth.getVoices()); };
  refresh(); // getVoices 可能先回空陣列 → voiceschanged 補選
  synth?.addEventListener('voiceschanged', refresh);
  return {
    setEnabled(v: boolean): void { on = v; },
    speak(text: string): void {
      if (!on || !synth) return;
      synth.cancel(); // 每次先清佇列——防 iOS 佇列凍結
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-TW';
      if (voice) u.voice = voice;
      synth.speak(u);
    },
  };
}
