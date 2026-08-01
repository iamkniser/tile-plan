import { describe, expect, it } from 'vitest';
import { decodeState, encodeState, type SharedState } from './share';

const state: SharedState = {
  v: 1,
  room: { width: 2600, height: 1700 },
  tile: { width: 1200, height: 600, grout: 2 },
  door: { wall: 'bottom', offset: 1060, width: 900, thresholdDepth: 150 },
  fixtures: [
    {
      id: 'bath',
      kind: 'bath',
      present: true,
      wall: 'left',
      length: 1700,
      depth: 700,
      offset: 0,
      bottomHeight: 0,
    },
  ],
};

describe('переносимое состояние', () => {
  it('переживает кодирование и обратное чтение без потерь', () => {
    expect(decodeState(encodeState(state))).toEqual(state);
  });

  it('кодируется безопасно для адресной строки', () => {
    expect(encodeState(state)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('не разваливается на мусоре', () => {
    for (const junk of ['', 'не base64!!', 'YWJj', '%%%']) {
      expect(decodeState(junk)).toBeNull();
    }
  });

  it('игнорирует состояние чужой версии', () => {
    const future = encodeState({ ...state, v: 99 as unknown as 1 });
    expect(decodeState(future)).toBeNull();
  });

  it('отбрасывает состояние без обязательных полей', () => {
    const broken = btoa(JSON.stringify({ v: 1, room: {}, tile: {}, door: {} }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeState(broken)).toBeNull();
  });

  it('сохраняет кириллицу в размерах и названиях', () => {
    const withText = { ...state, fixtures: [{ ...state.fixtures[0], id: 'ванна-1' }] };
    expect(decodeState(encodeState(withText))?.fixtures[0].id).toBe('ванна-1');
  });
});
