import { describe, expect, it } from 'vitest';
import { buildInstructions, sideName } from './instructions';
import { generateVariants } from './index';
import type { Door, Room, RoomObject, Tile } from './types';

const room: Room = { width: 2600, height: 1700 };
const tile: Tile = { width: 1200, height: 600, grout: 2 };
const door: Door = { wall: 'bottom', offset: 1060, width: 900, thresholdDepth: 150 };
const objects: RoomObject[] = [
  { id: 'bath', kind: 'bath', x: 0, y: 0, w: 700, h: 1700 },
];

function brief(d: Door = door) {
  const v = generateVariants({ room, tile, door: d, objects })[0];
  return { text: buildInstructions(room, tile, d, v).join('\n'), variant: v };
}

describe('имена стен для укладчика', () => {
  it('называет стороны относительно входа, а не осей', () => {
    expect(sideName('bottom', 'bottom')).toBe('входной');
    expect(sideName('bottom', 'top')).toBe('дальней');
    expect(sideName('bottom', 'left')).toBe('левой');
  });

  it('переворачивает лево и право, когда дверь в дальней стене', () => {
    expect(sideName('top', 'left')).toBe('правой');
    expect(sideName('top', 'right')).toBe('левой');
    expect(sideName('top', 'top')).toBe('входной');
  });

  it('для боковой двери меняет оси местами', () => {
    expect(sideName('left', 'left')).toBe('входной');
    expect(sideName('left', 'right')).toBe('дальней');
  });
});

describe('задание на укладку', () => {
  it('даёт две разметочные линии в миллиметрах от стен', () => {
    const { text } = brief();
    expect(text).toContain('Отбейте');
    expect(text).toMatch(/\d+ мм от (левой|правой) стены/);
  });

  it('бьёт линию по краю целой плитки, а не по краю подрезки', () => {
    const { text, variant } = brief();
    const { ox, oy } = variant.layout;
    const cutX = variant.metrics.cuts.left[0];

    // Линия отстоит от стены на подрезку плюс шов.
    expect(ox).toBe(cutX + tile.grout);
    expect(text).toContain(`${ox} мм от левой стены`);
    expect(text).toContain(`${oy} мм от входной стены`);
    expect(text).toContain('край первого ряда целых плиток');
  });

  it('перечисляет подрезки по всем четырём стенам', () => {
    const { text } = brief();
    for (const name of ['левой', 'правой', 'входной', 'дальней']) {
      expect(text).toContain(name);
    }
  });

  it('даёт размер куска целиком, а не одну сторону', () => {
    const { text, variant } = brief();
    const cutLeft = variant.metrics.cuts.left[0];
    const cutBottom = variant.metrics.cuts.bottom[0];

    // Вдоль боковой стены режется ширина, вдоль входной — длина.
    expect(text).toContain(`${cutLeft}×600`);
    expect(text).toContain(`1200×${cutBottom}`);
    expect(text).toContain('ширина×длина');
  });

  it('сообщает про плитку в проёме', () => {
    expect(brief().text).toMatch(/проём|проходит/i);
  });

  it('даёт сквозной кусок одним размером, а не двумя', () => {
    const { text, variant } = brief();
    const th = variant.metrics.threshold!;

    if (th.seamless) {
      // Кусок длиннее и подрезки в комнате, и глубины проёма по отдельности.
      expect(th.outerCut).toBeGreaterThan(150);
      expect(text).toContain(`одним куском 1200×${th.outerCut}`);
    }
  });

  it('не упоминает проём, если его глубина не задана', () => {
    const { text } = brief({ ...door, thresholdDepth: 0 });
    expect(text).not.toContain('дверном проёме');
  });

  it('говорит, что мерить надо от стен, а не от будущей мебели', () => {
    const { text } = brief();
    expect(text).toContain('от голых стен');
    expect(text).toContain('под ванну и мебель');
  });

  it('всегда предупреждает о непрямоугольности помещения', () => {
    expect(brief().text).toContain('промерьте обе стены');
  });

  it('называет ширину шва и перевязку', () => {
    const { text } = brief();
    expect(text).toContain('Шов 2 мм');
    expect(text).toMatch(/перевязк|шов в шов/);
  });
});
