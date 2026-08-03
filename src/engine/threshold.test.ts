import { describe, expect, it } from 'vitest';
import {
  buildThresholdTiles,
  computeThresholdMetrics,
  thresholdBounds,
  thresholdTileStart,
} from './threshold';
import { buildTilesIn } from './grid';
import type { Door, Layout, Room, Tile } from './types';

const room: Room = { width: 2600, height: 1700 };
const tile: Tile = { width: 600, height: 600, grout: 0 };

function layout(partial: Partial<Layout> = {}): Layout {
  return { ox: 0, oy: 0, orientation: 0, rowShift: 'none', ...partial };
}

function door(partial: Partial<Door> = {}): Door {
  return { wall: 'bottom', offset: 1060, width: 900, thresholdDepth: 150, ...partial };
}

describe('геометрия проёма', () => {
  it('лежит за стеной, снаружи помещения', () => {
    expect(thresholdBounds(room, door())).toEqual({ x0: 1060, y0: -150, x1: 1960, y1: 0 });
  });

  it('для дальней стены уходит наружу в другую сторону', () => {
    expect(thresholdBounds(room, door({ wall: 'top' }))).toEqual({
      x0: 1060,
      y0: 1700,
      x1: 1960,
      y1: 1850,
    });
  });

  it('без заданной глубины не строится', () => {
    expect(thresholdBounds(room, door({ thresholdDepth: 0 }))).toBeNull();
    expect(buildThresholdTiles(room, tile, layout(), door({ thresholdDepth: 0 }))).toEqual([]);
  });

  it('продолжает ту же сетку, что и в помещении', () => {
    const tiles = buildThresholdTiles(room, tile, layout({ ox: 100 }), door());

    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.y).toBeGreaterThanOrEqual(-150);
      expect(t.y + t.h).toBeLessThanOrEqual(0);
      expect(t.x).toBeGreaterThanOrEqual(1060);
      expect(t.x + t.w).toBeLessThanOrEqual(1960);
    }
    // Границы плиток по X кратны шагу с учётом смещения 100.
    expect(tiles.some((t) => t.x === 100 + 600 * 2)).toBe(true);
  });
});

describe('оценка порога', () => {
  it('без шва в проёме, когда плитка перекрывает его целиком', () => {
    // oy = 0: у стены начинается целая плитка, значит шов ровно на линии стены.
    const m = computeThresholdMetrics(room, tile, layout({ oy: 0 }), door())!;

    expect(m.seamless).toBe(true);
    expect(m.narrowestPiece).toBe(150);
  });

  it('считает сквозной кусок целиком, вместе с частью внутри помещения', () => {
    // Первый шов внутри комнаты на 249 мм: режется одним куском 150 + 249.
    const m = computeThresholdMetrics(room, tile, layout({ oy: 249 }), door())!;

    expect(m.seamless).toBe(true);
    expect(m.outerCut).toBe(399);
  });

  it('при шве внутри проёма меряет только до него', () => {
    const m = computeThresholdMetrics(room, tile, layout({ oy: -50 + 600 }), door())!;

    expect(m.seamless).toBe(false);
    expect(m.outerCut).toBeLessThan(150);
  });

  it('видит шов, попавший внутрь проёма', () => {
    // Граница ряда на 50 мм наружу от стены — ровно в полосе порога.
    const m = computeThresholdMetrics(room, tile, layout({ oy: -50 + 600 }), door())!;

    expect(m.seamless).toBe(false);
    expect(m.narrowestPiece).toBeLessThan(150);
  });

  it('узкий кусок у внешней кромки — худший случай', () => {
    // Шов в 20 мм от внешней кромки: в проёме окажется полоска 20 мм.
    const m = computeThresholdMetrics(room, tile, layout({ oy: -130 + 600 }), door())!;

    expect(m.seamless).toBe(false);
    expect(m.outerCut).toBe(20);
    expect(m.narrowestPiece).toBe(20);
  });

  it('без глубины проёма метрики не считаются', () => {
    expect(computeThresholdMetrics(room, tile, layout(), door({ thresholdDepth: 0 }))).toBeUndefined();
  });

  it('для двери в боковой стене считает по другой оси', () => {
    const side = door({ wall: 'left', offset: 500, width: 800 });
    const m = computeThresholdMetrics(room, tile, layout({ ox: 0 }), side)!;

    expect(m.seamless).toBe(true);
    // Целая плитка от стены: сквозной кусок — проём плюс вся плитка.
    expect(m.outerCut).toBe(150 + 600);
  });
});

describe('привязка к кромке проёма', () => {
  const oblong: Tile = { width: 1200, height: 600, grout: 2 };

  it('плитка проходит проём насквозь и входит в комнату остатком глубины', () => {
    const start = thresholdTileStart(room, door(), oblong.height)!;
    const l = layout({ oy: start });
    const m = computeThresholdMetrics(room, oblong, l, door())!;

    // Ни одного шва в проёме, а сквозной кусок равен всей глубине плитки:
    // продольного роспуска нет, режется только контур проёма.
    expect(m.seamless).toBe(true);
    expect(m.outerCut).toBe(oblong.height);

    // В комнату плитка входит тем, что осталось от глубины после проёма.
    const first = buildTilesIn({ x0: 0, y0: 0, x1: room.width, y1: room.height }, oblong, l)
      .filter((t) => t.y === 0)[0];
    expect(first.h).toBe(oblong.height - 150);
  });

  it('для двери в дальней стене отсчитывается в обратную сторону', () => {
    const far = door({ wall: 'top' });
    const start = thresholdTileStart(room, far, oblong.height)!;
    const m = computeThresholdMetrics(room, oblong, layout({ oy: start }), far)!;

    expect(m.seamless).toBe(true);
    expect(m.outerCut).toBe(oblong.height);
  });

  it('без глубины проёма привязки нет', () => {
    expect(thresholdTileStart(room, door({ thresholdDepth: 0 }), 600)).toBeNull();
  });
});
