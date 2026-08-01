import { buildTilesIn, effectiveTile, steps, type Bounds } from './grid';
import type { Door, Layout, Mm, PlacedTile, Room, ThresholdMetrics, Tile } from './types';

/**
 * Прямоугольник пола в дверном проёме — он лежит за стеной, снаружи помещения,
 * в толще перегородки. Плитка продолжается туда из комнаты.
 */
export function thresholdBounds(room: Room, door: Door): Bounds | null {
  const depth = door.thresholdDepth ?? 0;
  if (depth <= 0) return null;

  switch (door.wall) {
    case 'bottom':
      return { x0: door.offset, y0: -depth, x1: door.offset + door.width, y1: 0 };
    case 'top':
      return {
        x0: door.offset,
        y0: room.height,
        x1: door.offset + door.width,
        y1: room.height + depth,
      };
    case 'left':
      return { x0: -depth, y0: door.offset, x1: 0, y1: door.offset + door.width };
    case 'right':
      return {
        x0: room.width,
        y0: door.offset,
        x1: room.width + depth,
        y1: door.offset + door.width,
      };
  }
}

export function buildThresholdTiles(
  room: Room,
  tile: Tile,
  layout: Layout,
  door: Door,
): PlacedTile[] {
  const bounds = thresholdBounds(room, door);
  return bounds ? buildTilesIn(bounds, tile, layout) : [];
}

/**
 * Границы плиток внутри проёма, выраженные глубиной наружу от линии стены.
 * `0` — линия стены, `depth` — внешняя кромка, где начинается соседнее покрытие.
 */
function seamDepths(room: Room, tile: Tile, layout: Layout, door: Door, depth: Mm): Mm[] {
  const step = steps(tile, layout.orientation);
  const eff = effectiveTile(tile, layout.orientation);

  // Ось глубины перпендикулярна стене с дверью.
  const alongY = door.wall === 'bottom' || door.wall === 'top';
  const offset = alongY ? layout.oy : layout.ox;
  const s = alongY ? step.y : step.x;
  const size = alongY ? eff.h : eff.w;

  // Линия стены и направление наружу в координатах помещения.
  const wallAt =
    door.wall === 'bottom' || door.wall === 'left'
      ? 0
      : door.wall === 'top'
        ? room.height
        : room.width;
  const outward = door.wall === 'bottom' || door.wall === 'left' ? -1 : 1;

  // Интервал проёма в исходных координатах.
  const lo = outward < 0 ? wallAt - depth : wallAt;
  const hi = outward < 0 ? wallAt : wallAt + depth;

  const seams: Mm[] = [];
  // Границей плитки служит и её начало, и её конец: между ними лежит шов.
  for (const base of [offset, offset + size]) {
    const kMin = Math.ceil((lo - base) / s);
    const kMax = Math.floor((hi - base) / s);
    for (let k = kMin; k <= kMax; k++) {
      const t = outward * (base + k * s - wallAt);
      if (t > 0 && t < depth) seams.push(Math.round(t));
    }
  }

  return [...new Set(seams)].sort((a, b) => a - b);
}

export function computeThresholdMetrics(
  room: Room,
  tile: Tile,
  layout: Layout,
  door: Door,
): ThresholdMetrics | undefined {
  const depth = door.thresholdDepth ?? 0;
  if (depth <= 0) return undefined;

  const seams = seamDepths(room, tile, layout, door, depth);

  // Куски по глубине: от внешней кромки до первого шва, между швами, и до стены.
  const edges = [0, ...seams, depth];
  const pieces: Mm[] = [];
  for (let i = 1; i < edges.length; i++) pieces.push(edges[i] - edges[i - 1]);

  // Если шва в проёме нет, плитка идёт насквозь и режется одним куском: от внешней
  // кромки до первого шва уже внутри помещения. Резать её как два куска — ошибка.
  const insideSeam = firstSeamInside(room, tile, layout, door);

  return {
    seamless: seams.length === 0,
    outerCut:
      seams.length === 0 ? depth + insideSeam : depth - seams[seams.length - 1],
    narrowestPiece: Math.min(...pieces),
  };
}

/** Расстояние от линии стены до первого шва внутрь помещения. */
function firstSeamInside(room: Room, tile: Tile, layout: Layout, door: Door): Mm {
  const step = steps(tile, layout.orientation);
  const eff = effectiveTile(tile, layout.orientation);

  const alongY = door.wall === 'bottom' || door.wall === 'top';
  const offset = alongY ? layout.oy : layout.ox;
  const s = alongY ? step.y : step.x;
  const size = alongY ? eff.h : eff.w;

  const wallAt =
    door.wall === 'bottom' || door.wall === 'left'
      ? 0
      : door.wall === 'top'
        ? room.height
        : room.width;
  // Внутрь помещения — в сторону, противоположную наружной.
  const inward = door.wall === 'bottom' || door.wall === 'left' ? 1 : -1;

  let best = Infinity;
  for (const base of [offset, offset + size]) {
    for (let k = -2; k <= 2; k++) {
      const d = inward * (base + k * s - wallAt);
      if (d > 0) best = Math.min(best, d);
    }
  }

  return Number.isFinite(best) ? Math.round(best) : 0;
}
