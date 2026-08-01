import { effectiveTile, mod, steps } from './grid';
import { cutSize } from './metrics';
import { isHiddenBy, type Rect } from './objects';
import type { Door, EntryMetrics, Layout, Mm, PlacedTile, Room, Tile } from './types';

/** Половина угла зоны обзора — 45°, поэтому допустимое боковое смещение равно глубине. */
const GAZE_SLOPE = 1;

/** Ось, вдоль которой человек оценивает симметрию: поперёк направления взгляда. */
function lateralAxis(wall: Door['wall']): 'x' | 'y' {
  return wall === 'bottom' || wall === 'top' ? 'x' : 'y';
}

/** Координата центра дверного проёма на поперечной оси. */
export function doorCenter(door: Door): Mm {
  return door.offset + door.width / 2;
}

/** Точка, из которой человек смотрит в помещение: центр проёма на плане. */
export function viewerPoint(room: Room, door: Door): { x: Mm; y: Mm } {
  const c = doorCenter(door);
  switch (door.wall) {
    case 'bottom':
      return { x: c, y: 0 };
    case 'top':
      return { x: c, y: room.height };
    case 'left':
      return { x: 0, y: c };
    case 'right':
      return { x: room.width, y: c };
  }
}

/**
 * Глубина от входа и боковое смещение для точки на плане.
 * Глубина растёт по направлению взгляда, смещение — вправо от наблюдателя.
 */
function gazeCoords(
  room: Room,
  wall: Door['wall'],
  x: Mm,
  y: Mm,
): { depth: Mm; lateral: Mm } {
  switch (wall) {
    case 'bottom':
      return { depth: y, lateral: x };
    case 'top':
      return { depth: room.height - y, lateral: x };
    case 'left':
      return { depth: x, lateral: y };
    case 'right':
      return { depth: room.width - x, lateral: y };
  }
}

/** Смещения рядов, встречающиеся в раскладке, в долях шага. */
function shiftFractions(layout: Layout): number[] {
  switch (layout.rowShift) {
    case 'none':
      return [0];
    case 'half':
      return [0, 1 / 2];
    case 'third':
      return [0, 1 / 3, 2 / 3];
  }
}

/**
 * Отклонение от симметрии относительно оси взгляда.
 *
 * Раскладка симметрична, если на оси лежит либо шов, либо центр плитки —
 * то есть смещение сетки относительно оси кратно половине шага. Метрика —
 * расстояние до ближайшего такого положения, в миллиметрах.
 */
function symmetryDeviation(center: Mm, offset: Mm, step: Mm): Mm {
  const d = mod(center - offset, step);
  return Math.min(d, Math.abs(d - step / 2), step - d);
}

export function computeEntryMetrics(
  room: Room,
  tile: Tile,
  layout: Layout,
  tiles: PlacedTile[],
  door: Door,
  covers: Rect[] = [],
): EntryMetrics {
  const eff = effectiveTile(tile, layout.orientation);
  const step = steps(tile, layout.orientation);
  const center = doorCenter(door);
  const axis = lateralAxis(door.wall);

  // Ряды сдвигаются вдоль X. Если наблюдатель смотрит вдоль X, перевязка уходит
  // в глубину и на поперечную симметрию не влияет — тогда достаточно одного смещения.
  const deviations =
    axis === 'x'
      ? shiftFractions(layout).map((f) =>
          symmetryDeviation(center, layout.ox + f * step.x, step.x),
        )
      : [symmetryDeviation(center, layout.oy, step.y)];
  const asymmetry = deviations.reduce((a, b) => a + b, 0) / deviations.length;

  // В зону обзора попадает то, что видно с порога: сектор ±45° и не закрыто мебелью.
  const inZone = tiles.filter((t) => {
    const { depth, lateral } = gazeCoords(room, door.wall, t.x + t.w / 2, t.y + t.h / 2);
    return Math.abs(lateral - center) <= depth * GAZE_SLOPE && !isHiddenBy(t, covers);
  });

  const visibleCuts = inZone.filter((t) => t.isCut).map(cutSize);

  return {
    asymmetry,
    minCut: visibleCuts.length > 0 ? Math.min(...visibleCuts) : Math.min(eff.w, eff.h),
    cutTileCount: visibleCuts.length,
  };
}

/**
 * Пересчёт координат в систему наблюдателя: ось Y растёт от входа вглубь,
 * ось X — вправо от вошедшего. Нужен, чтобы план показывался так, как его видят
 * с порога, а не в абстрактных координатах комнаты.
 */
export function toViewRect(
  room: Room,
  wall: Door['wall'],
  r: { x: Mm; y: Mm; w: Mm; h: Mm },
): { x: Mm; y: Mm; w: Mm; h: Mm } {
  switch (wall) {
    case 'bottom':
      return r;
    case 'top':
      return { x: room.width - r.x - r.w, y: room.height - r.y - r.h, w: r.w, h: r.h };
    case 'left':
      return { x: room.height - r.y - r.h, y: r.x, w: r.h, h: r.w };
    case 'right':
      return { x: r.y, y: room.width - r.x - r.w, w: r.h, h: r.w };
  }
}

/** Размеры комнаты в системе наблюдателя. */
export function viewRoom(room: Room, wall: Door['wall']): Room {
  return wall === 'left' || wall === 'right'
    ? { width: room.height, height: room.width }
    : room;
}

/** Прямоугольник дверного проёма на плане комнаты. */
export function doorRect(room: Room, door: Door, thickness = 70) {
  switch (door.wall) {
    case 'bottom':
      return { x: door.offset, y: 0, w: door.width, h: thickness };
    case 'top':
      return { x: door.offset, y: room.height - thickness, w: door.width, h: thickness };
    case 'left':
      return { x: 0, y: door.offset, w: thickness, h: door.width };
    case 'right':
      return { x: room.width - thickness, y: door.offset, w: thickness, h: door.width };
  }
}

/** Длина стены, на которой стоит дверь. */
export function wallLength(room: Room, wall: Door['wall']): Mm {
  return wall === 'bottom' || wall === 'top' ? room.width : room.height;
}
