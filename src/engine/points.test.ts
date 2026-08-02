import { describe, expect, it } from 'vitest';
import { generateWallVariants, rankWallVariants, rejectWallVariants } from './wallVariants';
import type { Room, RoomObject, Tile, WallPoint } from './types';

const room: Room = { width: 2600, height: 1700, ceiling: 2900 };
const tile: Tile = { width: 1200, height: 600, grout: 2 };
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

/** Смеситель по центру ванны: 850 мм вдоль левой стены, 1100 над полом. */
const mixer: WallPoint = {
  id: 'mixer',
  wall: 'left',
  along: 850,
  height: 1100,
  size: 70,
  label: 'смеситель',
};

describe('выводы на стене', () => {
  it('считают зазор от отверстия до ближайшего шва', () => {
    const variants = generateWallVariants(
      { room, tile, objects: [bath], points: [mixer] },
      'left',
      undefined,
      0,
    );

    expect(variants.every((v) => v.metrics.outletClearance !== null)).toBe(true);
  });

  it('без выводов метрика не считается', () => {
    const variants = generateWallVariants({ room, tile, objects: [bath] }, 'left', undefined, 0);
    expect(variants.every((v) => v.metrics.outletClearance === null)).toBe(true);
  });

  it('отсеивают варианты, где шов режет отверстие', () => {
    const all = generateWallVariants(
      { room, tile, objects: [bath], points: [mixer] },
      'left',
      undefined,
      0,
    );
    const { kept, rejected } = rejectWallVariants(all);

    expect(rejected).toBeGreaterThan(0);
    expect(kept.every((v) => v.metrics.outletClearance! > 0)).toBe(true);
  });

  it('наверх поднимают вариант с наибольшим зазором до шва', () => {
    const { kept } = rejectWallVariants(
      generateWallVariants({ room, tile, objects: [bath], points: [mixer] }, 'left', undefined, 0),
    );
    const ranked = kept.sort(rankWallVariants);

    // Зазор больше ширины ладони считаем одинаково хорошим, дальше решает дробность.
    const capped = (v: (typeof ranked)[number]) => Math.min(v.metrics.outletClearance!, 100);
    for (let i = 1; i < ranked.length; i++) {
      expect(capped(ranked[i])).toBeLessThanOrEqual(capped(ranked[i - 1]));
    }
  });

  it('предлагают поставить центр плитки на вывод', () => {
    const titles = generateWallVariants(
      { room, tile, objects: [bath], points: [mixer] },
      'left',
      undefined,
      0,
    ).map((v) => v.title);

    expect(titles.some((t) => t.includes('смеситель'))).toBe(true);
  });
});
