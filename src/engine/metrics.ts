import { effectiveTile } from './grid';
import { hiddenFlags, type Rect } from './objects';
import type { Layout, Metrics, Mm, PlacedTile, Room, Side, Tile } from './types';

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function uniqueSorted(values: Mm[]): Mm[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * Ширина крайних элементов вдоль каждой стены.
 *
 * Считается именно ширина видимого элемента, а не размер подрезки: если у стены
 * лежит целая плитка, элемент равен полной плитке. Иначе раскладка «целая слева,
 * подрезка 100 мм справа» выглядела бы симметричнее, чем она есть.
 */
function edgeWidths(tiles: PlacedTile[], room: Room): Record<Side, Mm[]> {
  return {
    left: tiles.filter((t) => t.x === 0).map((t) => t.w),
    right: tiles.filter((t) => t.x + t.w === room.width).map((t) => t.w),
    bottom: tiles.filter((t) => t.y === 0).map((t) => t.h),
    top: tiles.filter((t) => t.y + t.h === room.height).map((t) => t.h),
  };
}

/** Размеры реальных подрезок вдоль каждой стены. */
function cutWidths(tiles: PlacedTile[]): Record<Side, Mm[]> {
  const cuts: Record<Side, Mm[]> = { left: [], right: [], bottom: [], top: [] };
  for (const t of tiles) {
    for (const side of t.cutSides) {
      cuts[side].push(side === 'left' || side === 'right' ? t.w : t.h);
    }
  }
  return {
    left: uniqueSorted(cuts.left),
    right: uniqueSorted(cuts.right),
    bottom: uniqueSorted(cuts.bottom),
    top: uniqueSorted(cuts.top),
  };
}

/** Размер подрезки плитки: наименьшее из обрезанных измерений. */
export function cutSize(tile: PlacedTile): Mm {
  return Math.min(...tile.cutSides.map((s) => (s === 'left' || s === 'right' ? tile.w : tile.h)));
}

export function computeMetrics(
  room: Room,
  tile: Tile,
  layout: Layout,
  tiles: PlacedTile[],
  covers: Rect[] = [],
): Metrics {
  const eff = effectiveTile(tile, layout.orientation);
  const cuts = cutWidths(tiles);
  const edges = edgeWidths(tiles, room);

  const allCuts = [...cuts.left, ...cuts.right, ...cuts.bottom, ...cuts.top];
  // Если подрезок нет вообще — это идеальный случай; отдаём максимально
  // возможное значение, чтобы сортировка «больше — лучше» работала без ветвлений.
  const maxPossible = Math.min(eff.w, eff.h);
  const minCut = allCuts.length > 0 ? Math.min(...allCuts) : maxPossible;

  const hidden = hiddenFlags(tiles, covers);
  const visibleCuts = tiles
    .filter((t, i) => t.isCut && !hidden[i])
    .map((t) => cutSize(t));

  const cutTileCount = tiles.filter((t) => t.isCut).length;
  const fullArea = eff.w * eff.h;
  const wasteArea = tiles
    .filter((t) => t.isCut)
    .reduce((sum, t) => sum + (fullArea - t.w * t.h), 0);

  return {
    minCut,
    minVisibleCut: visibleCuts.length > 0 ? Math.min(...visibleCuts) : maxPossible,
    hiddenCutCount: tiles.filter((t, i) => t.isCut && hidden[i]).length,
    cutTileCount,
    wholeTileCount: tiles.length - cutTileCount,
    asymmetryX: Math.abs(mean(edges.left) - mean(edges.right)),
    asymmetryY: Math.abs(mean(edges.bottom) - mean(edges.top)),
    wasteArea,
    cuts,
  };
}
