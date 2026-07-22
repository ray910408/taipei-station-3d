import { describe, it, expect, afterEach } from 'vitest';
import { motionSupported, requestMotionPermission } from '../src/pdr-sensor';

const G = globalThis as Record<string, unknown>;
afterEach(() => { delete G.DeviceMotionEvent; });

const mockWithPermission = (impl: () => Promise<string>): void => {
  const c = class {} as unknown as { requestPermission: () => Promise<string> };
  c.requestPermission = impl;
  G.DeviceMotionEvent = c;
};

describe('requestMotionPermission 三態', () => {
  it('無 DeviceMotionEvent → 不支援、權限 false', async () => {
    expect(motionSupported()).toBe(false);
    expect(await requestMotionPermission()).toBe(false);
  });

  it('無 requestPermission（Android／桌機 Chrome）→ 視同 granted', async () => {
    G.DeviceMotionEvent = class {};
    expect(motionSupported()).toBe(true);
    expect(await requestMotionPermission()).toBe(true);
  });

  it('granted → true；denied → false；throw（非手勢內呼叫）→ false', async () => {
    mockWithPermission(() => Promise.resolve('granted'));
    expect(await requestMotionPermission()).toBe(true);
    mockWithPermission(() => Promise.resolve('denied'));
    expect(await requestMotionPermission()).toBe(false);
    mockWithPermission(() => Promise.reject(new Error('NotAllowedError')));
    expect(await requestMotionPermission()).toBe(false);
  });
});
