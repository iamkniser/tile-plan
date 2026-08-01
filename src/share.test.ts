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
    expect(encodeState(state)).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it('умещается в сотню символов, а не в шестьсот', () => {
    const full: SharedState = {
      ...state,
      fixtures: [
        state.fixtures[0],
        { ...state.fixtures[0], id: 'cabinet', kind: 'cabinet', bottomHeight: 250 },
        { ...state.fixtures[0], id: 'toilet', kind: 'toilet', bottomHeight: 400 },
      ],
    };
    expect(encodeState(full).length).toBeLessThan(120);
  });

  it('читает ссылки прежнего формата', () => {
    // JSON в base64url — так выглядели ссылки первой версии.
    const legacy =
      'eyJ2IjoxLCJyb29tIjp7IndpZHRoIjoyNjAwLCJoZWlnaHQiOjE3MDB9LCJ0aWxlIjp7IndpZHRoIjoxMjAwLCJoZWln' +
      'aHQiOjYwMCwiZ3JvdXQiOjJ9LCJkb29yIjp7IndhbGwiOiJib3R0b20iLCJvZmZzZXQiOjEwNjAsIndpZHRoIjo5MDAs' +
      'InRocmVzaG9sZERlcHRoIjoxNTB9LCJmaXh0dXJlcyI6W119';
    const decoded = decodeState(legacy);

    expect(decoded?.room).toEqual({ width: 2600, height: 1700 });
    expect(decoded?.door.thresholdDepth).toBe(150);
  });

  it('не разваливается на мусоре', () => {
    for (const junk of ['', 'не формат!!', 'YWJj', '%%%', '2.0.0.0.0.0.x.0.0.0']) {
      expect(decodeState(junk)).toBeNull();
    }
  });

  it('отбрасывает запись с неизвестным предметом или стеной', () => {
    expect(decodeState('2.2600.1700.1200.600.2.b.1060.900.150.z.1.l.1700.700.0.0')).toBeNull();
    expect(decodeState('2.2600.1700.1200.600.2.b.1060.900.150.b.1.z.1700.700.0.0')).toBeNull();
  });

  it('игнорирует состояние чужой версии', () => {
    expect(decodeState('99.2600.1700.1200.600.2.b.1060.900.150')).toBeNull();
  });

  it('отбрасывает состояние с нулевыми размерами', () => {
    expect(decodeState('2.0.1700.1200.600.2.b.1060.900.150')).toBeNull();
  });

  it('переживает проект без единого предмета', () => {
    const empty: SharedState = { ...state, fixtures: [] };
    expect(decodeState(encodeState(empty))).toEqual(empty);
  });
});
