import { ROW_SHIFT_VALUE } from './types';
import type { Layout, Mm, PlacedTile, Room, Side, Tile } from './types';

/** Остаток от деления, всегда неотрицательный. */
export function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

/** Эффективный размер плитки с учётом поворота. */
export function effectiveTile(tile: Tile, orientation: 0 | 90): { w: Mm; h: Mm } {
  return orientation === 0
    ? { w: tile.width, h: tile.height }
    : { w: tile.height, h: tile.width };
}

/** Шаг сетки: плитка плюс шов. */
export function steps(tile: Tile, orientation: 0 | 90): { x: Mm; y: Mm } {
  const eff = effectiveTile(tile, orientation);
  return { x: eff.w + tile.grout, y: eff.h + tile.grout };
}

/**
 * Строит все плитки, попадающие в комнату, обрезая их по её границам.
 *
 * Ряды идут полосами вдоль оси X; `rowShift` сдвигает каждый следующий ряд по X
 * на долю шага (SPEC.md §4).
 */
export function buildTiles(room: Room, tile: Tile, layout: Layout): PlacedTile[] {
  return buildTilesIn({ x0: 0, y0: 0, x1: room.width, y1: room.height }, tile, layout);
}

export interface Bounds {
  x0: Mm;
  y0: Mm;
  x1: Mm;
  y1: Mm;
}

/**
 * Строит плитки внутри произвольного прямоугольника, обрезая их по его границам.
 *
 * Границы не обязаны совпадать с помещением: сетка продолжается в дверной проём,
 * который лежит за стеной, и там считается той же раскладкой.
 */
export function buildTilesIn(bounds: Bounds, tile: Tile, layout: Layout): PlacedTile[] {
  const eff = effectiveTile(tile, layout.orientation);
  const step = steps(tile, layout.orientation);

  const rowMin = Math.floor((bounds.y0 - layout.oy - eff.h) / step.y);
  const rowMax = Math.ceil((bounds.y1 - layout.oy) / step.y);

  const tiles: PlacedTile[] = [];

  for (let row = rowMin; row <= rowMax; row++) {
    const yStart = layout.oy + row * step.y;
    const y0 = Math.max(bounds.y0, yStart);
    const y1 = Math.min(bounds.y1, yStart + eff.h);
    if (y1 - y0 <= 0) continue;

    const shift = Math.round(mod(row * ROW_SHIFT_VALUE[layout.rowShift] * step.x, step.x));
    const colMin = Math.floor((bounds.x0 - layout.ox - shift - eff.w) / step.x);
    const colMax = Math.ceil((bounds.x1 - layout.ox - shift) / step.x);

    for (let col = colMin; col <= colMax; col++) {
      const xStart = layout.ox + shift + col * step.x;
      const x0 = Math.max(bounds.x0, xStart);
      const x1 = Math.min(bounds.x1, xStart + eff.w);
      if (x1 - x0 <= 0) continue;

      const cutSides: Side[] = [];
      if (xStart < bounds.x0) cutSides.push('left');
      if (xStart + eff.w > bounds.x1) cutSides.push('right');
      if (yStart < bounds.y0) cutSides.push('bottom');
      if (yStart + eff.h > bounds.y1) cutSides.push('top');

      tiles.push({
        x: x0,
        y: y0,
        w: x1 - x0,
        h: y1 - y0,
        row,
        col,
        isCut: cutSides.length > 0,
        cutSides,
      });
    }
  }

  return tiles;
}
