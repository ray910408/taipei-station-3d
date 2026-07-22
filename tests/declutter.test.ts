import { describe, it, expect } from 'vitest';
import { declutter } from '../src/labels';

describe('declutter：每格留最高優先', () => {
  it('同格兩籤留高 priority', () => {
    const keep = declutter([{ x: 5, y: 5, priority: 1 }, { x: 8, y: 8, priority: 3 }], 64);
    expect(keep).toEqual([false, true]);
  });
  it('不同格互不影響', () => {
    const keep = declutter([{ x: 5, y: 5, priority: 1 }, { x: 200, y: 200, priority: 1 }], 64);
    expect(keep).toEqual([true, true]);
  });
});
