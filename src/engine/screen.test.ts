import { describe, expect, it } from 'vitest';
import { generateScreenVariants, screenCovers, screenSurface } from './screen';
import type { Room, RoomObject, Tile } from './types';

const room: Room = { width: 2600, height: 1700, ceiling: 2500 };
const tile: Tile = { width: 300, height: 600, grout: 2 };

/** Ванна вдоль левой стены: лицевая грань на x = 700, борт на 600. */
const bath: RoomObject = {
  id: 'bath',
  kind: 'bath',
  x: 0,
  y: 0,
  w: 700,
  h: 1700,
  topHeight: 600,
  tiledBehind: false,
};

/** Подвесная тумба у дальней стены, торцом вплотную к экрану ванны. */
const cabinet: RoomObject = {
  id: 'cabinet',
  kind: 'cabinet',
  x: 700,
  y: 1200,
  w: 1900,
  h: 500,
  bottomHeight: 250,
  topHeight: 800,
  tiledBehind: true,
};

describe('экран ванны', () => {
  it('идёт вдоль ванны от пола до борта', () => {
    const surface = screenSurface(room, bath)!;

    expect(surface.width).toBe(1700); // длина ванны вдоль левой стены
    expect(surface.height).toBe(600); // высота борта
    expect(surface.attachedTo).toBe('left');
  });

  it('без заданной высоты борта не существует', () => {
    expect(screenSurface(room, { ...bath, topHeight: undefined })).toBeNull();
  });

  it('у предмета посреди комнаты экрана нет', () => {
    const island: RoomObject = { ...bath, x: 500, y: 500, w: 400, h: 400 };
    expect(screenSurface(room, island)).toBeNull();
  });
});

describe('перекрытие экрана', () => {
  it('тумба, стоящая торцом вплотную, перекрывает экран на своей длине', () => {
    const [cover] = screenCovers(room, bath, [bath, cabinet]);

    expect(cover).toBeDefined();
    expect(cover.kind).toBe('cabinet');
    expect(cover.x).toBe(1200); // тумба начинается на 1200 мм вдоль ванны
    expect(cover.w).toBe(500); // и тянется до конца ванны
    expect(cover.y).toBe(250); // от нижней кромки тумбы
    expect(cover.h).toBe(350); // и до борта: 600 − 250
  });

  it('предмет, не достающий до экрана, его не перекрывает', () => {
    const far: RoomObject = { ...cabinet, x: 1500, w: 1100 };
    expect(screenCovers(room, bath, [bath, far])).toHaveLength(0);
  });

  it('сама ванна себя не перекрывает', () => {
    expect(screenCovers(room, bath, [bath]).some((c) => c.id === 'bath')).toBe(false);
  });
});

describe('раскладка экрана', () => {
  it('даёт варианты в пределах экрана', () => {
    const variants = generateScreenVariants({ room, tile, objects: [bath, cabinet] }, 'bath');

    expect(variants.length).toBeGreaterThan(0);
    for (const v of variants) {
      for (const t of v.tiles) {
        expect(t.x + t.w).toBeLessThanOrEqual(1700);
        expect(t.y + t.h).toBeLessThanOrEqual(600);
      }
    }
  });

  it('считает подрезки под тумбой скрытыми', () => {
    // Вертикальная плитка даёт ряд, целиком попадающий под тумбу.
    const variants = generateScreenVariants(
      { room, tile, objects: [bath, cabinet] },
      'bath',
      undefined,
      90,
    );
    expect(variants.some((v) => v.metrics.hiddenCutCount > 0)).toBe(true);
  });

  it('ориентация задаётся, а не перебирается', () => {
    const variants = generateScreenVariants({ room, tile, objects: [bath, cabinet] }, 'bath');
    expect(variants.every((v) => v.layout.orientation === 0)).toBe(true);
  });

  it('для несуществующего предмета возвращает пустой список', () => {
    expect(generateScreenVariants({ room, tile, objects: [bath] }, 'нет-такого')).toEqual([]);
  });
});
