import { describe, expect, it } from 'vitest';
import { buildTiles, generateVariants, rowShiftOptions, steps } from './index';
import { computeMetrics } from './metrics';
import { offsetFor } from './strategies';
import type { Layout, PlacedTile, Room, Tile } from './types';

const tile600: Tile = { width: 600, height: 600, grout: 0 };

function layout(partial: Partial<Layout> = {}): Layout {
  return { ox: 0, oy: 0, orientation: 0, rowShift: 'none', ...partial };
}

function overlaps(a: PlacedTile, b: PlacedTile): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('buildTiles', () => {
  it('покрывает комнату целиком, когда размер кратен плитке', () => {
    const room: Room = { width: 3000, height: 1800 };
    const tiles = buildTiles(room, tile600, layout());

    expect(tiles).toHaveLength(15);
    expect(tiles.every((t) => !t.isCut)).toBe(true);
  });

  it('обрезает плитки по дальним стенам', () => {
    const room: Room = { width: 3100, height: 1800 };
    const tiles = buildTiles(room, tile600, layout());

    const cut = tiles.filter((t) => t.isCut);
    expect(cut).toHaveLength(3); // один столбец подрезки на каждый из трёх рядов
    expect(cut.every((t) => t.w === 100 && t.cutSides.includes('right'))).toBe(true);
  });

  it('плитки не перекрываются и не выходят за границы комнаты', () => {
    const room: Room = { width: 2370, height: 1655 };
    const tile: Tile = { width: 600, height: 1200, grout: 2 };
    const tiles = buildTiles(room, tile, layout({ ox: 137, oy: 421, rowShift: 'third' }));

    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(room.width);
      expect(t.y + t.h).toBeLessThanOrEqual(room.height);
      expect(t.w).toBeGreaterThan(0);
      expect(t.h).toBeGreaterThan(0);
    }

    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        expect(overlaps(tiles[i], tiles[j])).toBe(false);
      }
    }
  });

  it('покрывает всю площадь комнаты при нулевом шве', () => {
    const room: Room = { width: 2370, height: 1655 };
    const tiles = buildTiles(room, tile600, layout({ ox: 137, oy: 421 }));
    const covered = tiles.reduce((sum, t) => sum + t.w * t.h, 0);

    expect(covered).toBe(room.width * room.height);
  });
});

describe('offsetFor', () => {
  const room = 3100;
  const step = steps(tile600, 0).x;

  it('centerTile ставит целую плитку по центру оси', () => {
    const ox = offsetFor('centerTile', room, 600, step, 0);
    const tiles = buildTiles({ width: room, height: 600 }, tile600, layout({ ox }));
    const cuts = tiles.filter((t) => t.isCut).map((t) => t.w);

    expect(cuts).toEqual([50, 50]);
  });

  it('centerJoint ставит шов по центру оси', () => {
    const ox = offsetFor('centerJoint', room, 600, step, 0);
    const tiles = buildTiles({ width: room, height: 600 }, tile600, layout({ ox }));

    // Граница плитки приходится ровно на середину комнаты.
    expect(tiles.some((t) => t.x === room / 2)).toBe(true);
  });

  it('flushEnd прижимает целую плитку к дальней стене', () => {
    const ox = offsetFor('flushEnd', room, 600, step, 0);
    const tiles = buildTiles({ width: room, height: 600 }, tile600, layout({ ox }));
    const rightmost = tiles.reduce((a, b) => (a.x > b.x ? a : b));

    expect(rightmost.w).toBe(600);
    expect(rightmost.x + rightmost.w).toBe(room);
  });

  it('всегда нормализует смещение в [0, step)', () => {
    for (const id of ['centerTile', 'centerJoint', 'flushStart', 'flushEnd'] as const) {
      const o = offsetFor(id, 2345, 600, step, 3);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThan(step);
    }
  });
});

describe('computeMetrics', () => {
  it('считает симметричную раскладку симметричной', () => {
    const room: Room = { width: 3100, height: 3100 };
    const step = steps(tile600, 0);
    const l = layout({
      ox: offsetFor('centerTile', room.width, 600, step.x, 0),
      oy: offsetFor('centerTile', room.height, 600, step.y, 0),
    });
    const m = computeMetrics(room, tile600, l, buildTiles(room, tile600, l));

    expect(m.asymmetryX).toBe(0);
    expect(m.asymmetryY).toBe(0);
    expect(m.minCut).toBe(50);
  });

  it('видит несимметричность раскладки от стены', () => {
    const room: Room = { width: 3100, height: 600 };
    const l = layout();
    const m = computeMetrics(room, tile600, l, buildTiles(room, tile600, l));

    // Слева целая плитка 600, справа подрезка 100.
    expect(m.asymmetryX).toBe(500);
    expect(m.minCut).toBe(100);
  });

  it('без подрезок отдаёт minCut, равный размеру плитки', () => {
    const room: Room = { width: 3000, height: 1800 };
    const l = layout();
    const m = computeMetrics(room, tile600, l, buildTiles(room, tile600, l));

    expect(m.cutTileCount).toBe(0);
    expect(m.minCut).toBe(600);
    expect(m.wasteArea).toBe(0);
  });
});

describe('rowShiftOptions', () => {
  it('запрещает перевязку 1/2 для крупного формата', () => {
    const options = rowShiftOptions({ width: 600, height: 1200, grout: 2 });
    const half = options.find((o) => o.id === 'half')!;

    expect(half.allowed).toBe(false);
    expect(half.reason).toContain('1/3');
  });

  it('разрешает перевязку 1/2 для 600×600', () => {
    expect(rowShiftOptions(tile600).find((o) => o.id === 'half')!.allowed).toBe(true);
  });
});

describe('generateVariants', () => {
  const room: Room = { width: 2370, height: 1655 };

  it('не выдаёт вариантов с одинаковым профилем подрезок', () => {
    const variants = generateVariants({ room, tile: tile600 });
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

  it('не поворачивает квадратную плитку', () => {
    const variants = generateVariants({ room, tile: tile600 });
    expect(variants.every((v) => v.layout.orientation === 0)).toBe(true);
  });

  it('перебирает обе ориентации прямоугольной плитки', () => {
    const variants = generateVariants({ room, tile: { width: 600, height: 1200, grout: 2 } });
    expect(new Set(variants.map((v) => v.layout.orientation))).toEqual(new Set([0, 90]));
  });

  it('не предлагает перевязку 1/2 для крупного формата', () => {
    const variants = generateVariants({ room, tile: { width: 600, height: 1200, grout: 2 } });
    expect(variants.every((v) => v.layout.rowShift !== 'half')).toBe(true);
  });

  it('находит вариант без подрезок, когда комната кратна плитке', () => {
    const variants = generateVariants({ room: { width: 3000, height: 1800 }, tile: tile600 });
    expect(variants.some((v) => v.metrics.cutTileCount === 0)).toBe(true);
  });
});
