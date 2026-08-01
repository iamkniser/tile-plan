import { describe, expect, it } from 'vitest';
import { generateWallVariants } from './wallVariants';
import { EYE_BAND, wallCoverRects, wallEdgeHeights, wallOpening, wallSurface } from './wall';
import type { Door, Layout, Room, RoomObject, Tile } from './types';

const room: Room = { width: 2600, height: 1700, ceiling: 2500 };
const tile: Tile = { width: 300, height: 600, grout: 2 };
const door: Door = { wall: 'bottom', offset: 1060, width: 900, thresholdDepth: 150 };

/** Ванна вдоль левой стены: борт на высоте 600. */
const bath: RoomObject = {
  id: 'bath',
  kind: 'bath',
  x: 0,
  y: 0,
  w: 700,
  h: 1700,
  topHeight: 600,
};

/** Подвесная тумба у дальней стены: от 250 до 800. */
const cabinet: RoomObject = {
  id: 'cabinet',
  kind: 'cabinet',
  x: 700,
  y: 1200,
  w: 1900,
  h: 500,
  bottomHeight: 250,
  topHeight: 800,
};

describe('развёртка стены', () => {
  it('берёт длину стены и высоту помещения', () => {
    expect(wallSurface(room, 'bottom')).toEqual({ wall: 'bottom', width: 2600, height: 2500 });
    expect(wallSurface(room, 'left')).toEqual({ wall: 'left', width: 1700, height: 2500 });
  });

  it('без заданного потолка берёт значение по умолчанию', () => {
    expect(wallSurface({ width: 2600, height: 1700 }, 'top').height).toBe(2500);
  });
});

describe('предметы на развёртке', () => {
  it('ванна закрывает стену до борта по всей своей длине', () => {
    const [rect] = wallCoverRects(room, 'left', [bath]);

    expect(rect).toMatchObject({ x: 0, y: 0, w: 1700, h: 600, kind: 'bath' });
  });

  it('подвесная тумба закрывает полосу между кромками', () => {
    const [rect] = wallCoverRects(room, 'top', [cabinet]);

    expect(rect.y).toBe(250);
    expect(rect.h).toBe(550); // 800 − 250
  });

  it('предмет у другой стены на эту развёртку не попадает', () => {
    expect(wallCoverRects(room, 'right', [bath])).toHaveLength(0);
  });

  it('предмет без заданной высоты стену не закрывает', () => {
    const flat: RoomObject = { ...bath, topHeight: undefined };
    expect(wallCoverRects(room, 'left', [flat])).toHaveLength(0);
  });

  it('кромки предметов дают линии для совмещения шва', () => {
    const edges = wallEdgeHeights(room, 'top', [cabinet]).map((e) => e.value);
    expect(edges).toContain(800);
    expect(edges).toContain(250);
  });
});

describe('дверной проём на стене', () => {
  it('вырезается только в своей стене', () => {
    expect(wallOpening(room, 'bottom', door)?.w).toBe(900);
    expect(wallOpening(room, 'top', door)).toBeNull();
  });

  it('идёт от пола на высоту двери', () => {
    const opening = wallOpening(room, 'bottom', door, 2100)!;
    expect(opening.y).toBe(0);
    expect(opening.h).toBe(2100);
  });
});

describe('варианты раскладки стены', () => {
  const objects = [bath, cabinet];

  it('предлагает старт и от пола, и под потолок', () => {
    const titles = generateWallVariants({ room, tile, door, objects }, 'left').map((v) => v.title);

    expect(titles.some((t) => t.includes('целая от пола'))).toBe(true);
    expect(titles.some((t) => t.includes('целая под потолок'))).toBe(true);
  });

  it('предлагает совместить шов с бортом ванны', () => {
    const titles = generateWallVariants({ room, tile, door, objects }, 'left').map((v) => v.title);
    expect(titles.some((t) => t.includes('борт ванны'))).toBe(true);
  });

  it('не считает подрезки за ванной видимыми', () => {
    const variants = generateWallVariants({ room, tile, door, objects }, 'left');
    const hiding = variants.find((v) => v.metrics.hiddenCutCount > 0);

    expect(hiding).toBeDefined();
    expect(hiding!.metrics.minVisibleCut).toBeGreaterThanOrEqual(hiding!.metrics.minCut);
  });

  it('отдельно меряет подрезку на уровне глаз', () => {
    for (const v of generateWallVariants({ room, tile, door, objects }, 'left')) {
      // Подрезка на уровне глаз не может быть мельче самой мелкой видимой.
      expect(v.metrics.eyeLevelCut).toBeGreaterThanOrEqual(v.metrics.minVisibleCut);
    }
  });

  it('полоса глаз лежит там, куда смотрят стоя', () => {
    expect(EYE_BAND.from).toBeLessThan(EYE_BAND.to);
    expect(EYE_BAND.from).toBeGreaterThan(1000);
    expect(EYE_BAND.to).toBeLessThan(2000);
  });

  it('считает расхождение шва стены со швом пола', () => {
    const floor: Layout = { ox: 309, oy: 249, orientation: 0, rowShift: 'none' };
    const withFloor = generateWallVariants({ room, tile, door, objects }, 'bottom', floor);

    expect(withFloor.every((v) => v.metrics.floorJointOffset >= 0)).toBe(true);
    // Хотя бы один вариант расходится с полом, иначе метрика бессмысленна.
    expect(withFloor.some((v) => v.metrics.floorJointOffset > 0)).toBe(true);
  });

  it('не выдаёт вариантов с одинаковым профилем подрезок', () => {
    const variants = generateWallVariants({ room, tile, door, objects }, 'left');
    const keys = variants.map((v) =>
      [
        v.layout.orientation,
        v.layout.rowShift,
        v.metrics.cuts.left.join(','),
        v.metrics.cuts.right.join(','),
        v.metrics.cuts.bottom.join(','),
        v.metrics.cuts.top.join(','),
      ].join('|'),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('плитки покрывают развёртку и не выходят за её края', () => {
    const surface = wallSurface(room, 'left');
    for (const v of generateWallVariants({ room, tile, door, objects }, 'left')) {
      for (const t of v.tiles) {
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.x + t.w).toBeLessThanOrEqual(surface.width);
        expect(t.y + t.h).toBeLessThanOrEqual(surface.height);
      }
    }
  });
});

describe('за ванной плитки нет', () => {
  const noTilesBehind: RoomObject = { ...bath, tiledBehind: false };

  it('плитка не заходит за борт ванны', () => {
    const variants = generateWallVariants(
      { room, tile, door, objects: [noTilesBehind] },
      'left',
    );

    for (const v of variants) {
      // Ванна занимает всю длину стены, поэтому ниже борта плитки быть не должно.
      expect(v.tiles.every((t) => t.y >= 600)).toBe(true);
    }
  });

  it('нижний ряд режется по борту и считается подрезкой', () => {
    const variants = generateWallVariants(
      { room, tile, door, objects: [noTilesBehind] },
      'left',
    );
    const startsAtRim = variants.find((v) => v.tiles.some((t) => t.y === 600 && !t.isCut));

    expect(startsAtRim).toBeDefined();
  });

  it('с плиткой за ванной раскладка идёт до пола', () => {
    const tiled: RoomObject = { ...bath, tiledBehind: true };
    const variants = generateWallVariants({ room, tile, door, objects: [tiled] }, 'left');

    expect(variants.some((v) => v.tiles.some((t) => t.y === 0))).toBe(true);
  });

  it('в дверном проёме плитки нет', () => {
    const variants = generateWallVariants({ room, tile, door, objects: [] }, 'bottom');
    const opening = { x: 1060, w: 900, h: 2100 };

    for (const v of variants) {
      const inside = v.tiles.filter(
        (t) => t.x >= opening.x && t.x + t.w <= opening.x + opening.w && t.y + t.h <= opening.h,
      );
      expect(inside).toHaveLength(0);
    }
  });
});

describe('плитка у дверного проёма', () => {
  it('не заходит внутрь проёма', () => {
    const variants = generateWallVariants({ room, tile, door, objects: [] }, 'bottom');
    const opening = { x: 1060, y: 0, w: 900, h: 2100 };

    for (const v of variants) {
      for (const t of v.tiles) {
        const overlapW = Math.min(t.x + t.w, opening.x + opening.w) - Math.max(t.x, opening.x);
        const overlapH = Math.min(t.y + t.h, opening.y + opening.h) - Math.max(t.y, opening.y);
        expect(overlapW <= 0 || overlapH <= 0).toBe(true);
      }
    }
  });

  it('обрезанный проёмом кусок считается подрезкой, а не целой плиткой', () => {
    const variants = generateWallVariants({ room, tile, door, objects: [] }, 'bottom');

    for (const v of variants) {
      // Кусок, примыкающий к краю проёма, обязан быть помечен как резаный.
      const touching = v.tiles.filter((t) => t.x + t.w === 1060 || t.x === 1960);
      for (const t of touching) {
        if (t.w < 300) expect(t.isCut).toBe(true);
      }
    }
  });

  it('плитки не накладываются друг на друга после обрезки', () => {
    const variants = generateWallVariants({ room, tile, door, objects: [] }, 'bottom');
    const v = variants[0];

    for (let i = 0; i < v.tiles.length; i++) {
      for (let j = i + 1; j < v.tiles.length; j++) {
        const a = v.tiles[i];
        const b = v.tiles[j];
        const overlap =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });
});
