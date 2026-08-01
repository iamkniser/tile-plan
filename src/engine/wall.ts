import { EYE_HEIGHT, type Rect } from './objects';
import type { Door, Mm, Room, RoomObject, Side, Tile } from './types';

/**
 * Раскладка стены считается на её развёртке: плоский прямоугольник, где по
 * горизонтали идёт длина стены, а по вертикали — высота помещения.
 *
 * Ключевое отличие от пола: вертикаль неравноправна. Подрезка у потолка
 * привычна и почти не читается, подрезка за ванной не видна вовсе, а вот
 * подрезка на уровне глаз считается браком.
 */
export interface WallSurface {
  wall: Side;
  /** Длина стены. */
  width: Mm;
  /** Высота помещения. */
  height: Mm;
}

export const DEFAULT_CEILING: Mm = 2500;

/** Полоса на уровне глаз, где тонкая подрезка недопустима. */
export const EYE_BAND: { from: Mm; to: Mm } = { from: 1400, to: EYE_HEIGHT + 100 };

export function wallSurface(room: Room, wall: Side): WallSurface {
  const width = wall === 'bottom' || wall === 'top' ? room.width : room.height;
  return { wall, width, height: room.ceiling ?? DEFAULT_CEILING };
}

/**
 * Положение точки вдоль стены, если смотреть на стену снаружи помещения.
 *
 * Развёртку читают, стоя лицом к стене, поэтому направление отсчёта у каждой
 * стены своё: иначе левый край чертежа окажется справа на объекте.
 */
function alongWall(room: Room, wall: Side, x: Mm, y: Mm): Mm {
  switch (wall) {
    case 'bottom':
      return x;
    case 'top':
      return room.width - x;
    case 'left':
      return room.height - y;
    case 'right':
      return y;
  }
}

/** Примыкает ли предмет к этой стене. */
function touchesWall(o: RoomObject, room: Room, wall: Side): boolean {
  switch (wall) {
    case 'left':
      return o.x <= 0;
    case 'right':
      return o.x + o.w >= room.width;
    case 'bottom':
      return o.y <= 0;
    case 'top':
      return o.y + o.h >= room.height;
  }
}

/**
 * Проекция предметов на развёртку стены: полоса от нижней кромки до верхней
 * на той длине, которую предмет занимает вдоль стены.
 *
 * Ванна закрывает стену до борта, подвесная тумба — от нижней кромки до верха.
 * Плитка за ними есть, но её не видно, и подрезка там бесплатна.
 */
export type WallCover = Rect & { id: string; kind: RoomObject['kind'] };

export function wallCoverRects(room: Room, wall: Side, objects: RoomObject[]): WallCover[] {
  const rects: WallCover[] = [];

  for (const o of objects) {
    if (!touchesWall(o, room, wall)) continue;

    const top = o.topHeight ?? 0;
    if (top <= 0) continue; // высота не задана — считаем, что стену не закрывает

    const a = alongWall(room, wall, o.x, o.y);
    const b = alongWall(room, wall, o.x + o.w, o.y + o.h);
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    const bottom = o.bottomHeight ?? 0;

    rects.push({ id: o.id, kind: o.kind, x: from, y: bottom, w: to - from, h: top - bottom });
  }

  return rects;
}

/**
 * Зоны, которые вообще не облицовывают: пространство за ванной и дверной проём.
 *
 * Отличие от `wallCoverRects` принципиальное. Скрытая зона — плитка там есть,
 * просто её не видно. Исключённая — плитки нет, и нижний ряд над ней режется
 * по кромке предмета, а не по полу.
 */
export function wallExcludedRects(
  room: Room,
  wall: Side,
  objects: RoomObject[],
  door?: Door,
): Rect[] {
  const zones: Rect[] = [];

  for (const cover of wallCoverRects(room, wall, objects)) {
    const object = objects.find((o) => o.id === cover.id);
    if (object?.tiledBehind === false) zones.push(cover);
  }

  const opening = wallOpening(room, wall, door);
  if (opening) zones.push(opening);

  return zones;
}

/** Дверной проём на развёртке: плитку туда не кладут. */
export function wallOpening(
  room: Room,
  wall: Side,
  door: Door | undefined,
  doorHeight: Mm = 2100,
): Rect | null {
  if (!door || door.wall !== wall) return null;

  const a = alongWall(room, wall, ...doorAnchors(room, door).start);
  const b = alongWall(room, wall, ...doorAnchors(room, door).end);
  const from = Math.min(a, b);

  return { x: from, y: 0, w: Math.abs(b - a), h: doorHeight };
}

function doorAnchors(room: Room, door: Door): { start: [Mm, Mm]; end: [Mm, Mm] } {
  switch (door.wall) {
    case 'bottom':
      return { start: [door.offset, 0], end: [door.offset + door.width, 0] };
    case 'top':
      return { start: [door.offset, room.height], end: [door.offset + door.width, room.height] };
    case 'left':
      return { start: [0, door.offset], end: [0, door.offset + door.width] };
    case 'right':
      return { start: [room.width, door.offset], end: [room.width, door.offset + door.width] };
  }
}

/**
 * Горизонтальные линии, с которыми осмысленно совместить шов: верхние кромки
 * предметов. Борт ванны — самая сильная из них: шов, попавший на борт, читается
 * как задуманный, а разошедшийся на пару сантиметров — как промах.
 */
export function wallEdgeHeights(
  room: Room,
  wall: Side,
  objects: RoomObject[],
): Array<{ value: Mm; kind: RoomObject['kind'] }> {
  const seen = new Set<Mm>();
  const edges: Array<{ value: Mm; kind: RoomObject['kind'] }> = [];

  for (const o of objects) {
    if (!touchesWall(o, room, wall)) continue;
    for (const value of [o.topHeight, o.bottomHeight]) {
      if (!value || value <= 0 || seen.has(value)) continue;
      seen.add(value);
      edges.push({ value, kind: o.kind });
    }
  }

  return edges;
}

/** Шов пола, к которому примыкает эта стена: с ним сравнивается шов стены. */
export function floorJointAlong(
  room: Room,
  wall: Side,
  floorOx: Mm,
  floorOy: Mm,
  stepX: Mm,
  stepY: Mm,
): { offset: Mm; step: Mm } {
  // Вдоль нижней и верхней стены идёт сетка по X, вдоль боковых — по Y.
  const horizontal = wall === 'bottom' || wall === 'top';
  const offset = horizontal ? floorOx : floorOy;
  const step = horizontal ? stepX : stepY;

  // Развёртка боковых и дальней стен читается в обратную сторону.
  const flipped = wall === 'top' || wall === 'left';
  const length = horizontal ? room.width : room.height;

  return { offset: flipped ? (length - offset) % step : offset, step };
}

export function wallArea(surface: WallSurface, tile: Tile): number {
  void tile;
  return surface.width * surface.height;
}
