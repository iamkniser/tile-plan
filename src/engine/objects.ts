import { isCovering, isFurniture } from './types';
import type { Mm, PlacedTile, Room, RoomObject, Side } from './types';

export interface Rect {
  x: Mm;
  y: Mm;
  w: Mm;
  h: Mm;
}

/**
 * Высота глаз стоящего человека. Из неё считается, насколько глубоко
 * просматривается пол под подвесной мебелью.
 */
export const EYE_HEIGHT: Mm = 1600;

/**
 * Доля площади плитки, которую должно закрывать укрытие, чтобы подрезку под ним
 * можно было считать невидимой. Порог высокий намеренно: ошибочно счесть подрезку
 * скрытой хуже, чем перестраховаться и учесть её как видимую.
 */
const HIDDEN_COVERAGE = 0.9;

function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * К какой стене прижат объект; null — если стоит на отшибе.
 *
 * Предмет может касаться сразу двух стен — например, тумба во всю дальнюю стену
 * упирается ещё и в боковую. Выбираем ту, от которой он отходит на меньшую глубину:
 * тумбу 1900×500 у дальней стены нельзя считать прижатой к боковой, иначе укрытие
 * посчитается вдоль неверной оси.
 */
function attachedWall(o: RoomObject, room: Room): Side | null {
  const touching: Array<{ wall: Side; depth: Mm }> = [];
  if (o.x <= 0) touching.push({ wall: 'left', depth: o.w });
  if (o.x + o.w >= room.width) touching.push({ wall: 'right', depth: o.w });
  if (o.y <= 0) touching.push({ wall: 'bottom', depth: o.h });
  if (o.y + o.h >= room.height) touching.push({ wall: 'top', depth: o.h });

  if (touching.length === 0) return null;
  return touching.reduce((a, b) => (b.depth < a.depth ? b : a)).wall;
}

/**
 * Насколько глубоко виден пол под нижней кромкой.
 *
 * Луч зрения идёт от глаза на высоте `EYE_HEIGHT` через переднюю нижнюю кромку
 * предмета и падает на пол на расстоянии `L·h / (E − h)` за ней. Всё, что дальше
 * этой точки, закрыто корпусом.
 */
export function visibleDepthUnder(bottomHeight: Mm, distanceToEdge: Mm): Mm {
  if (bottomHeight <= 0) return 0;
  if (bottomHeight >= EYE_HEIGHT) return Infinity; // кромка выше глаз — видно весь пол
  return (distanceToEdge * bottomHeight) / (EYE_HEIGHT - bottomHeight);
}

/**
 * Прямоугольники пола, реально закрытые от наблюдателя.
 *
 * У предмета, стоящего на полу, это весь его габарит. У подвесного — только
 * дальняя от наблюдателя полоса: под кромкой пол просматривается. Без известной
 * точки обзора подвесная мебель не прячет ничего — консервативно и безопасно.
 */
export function coverRects(
  objects: RoomObject[],
  room: Room,
  viewer: { x: Mm; y: Mm } | null,
): Rect[] {
  const rects: Rect[] = [];

  for (const o of objects) {
    if (!isCovering(o)) continue;

    const bottom = o.bottomHeight ?? 0;
    if (bottom <= 0) {
      rects.push(o);
      continue;
    }
    if (!viewer) continue;

    const wall = attachedWall(o, room);
    if (!wall) continue; // подвесной предмет посреди комнаты — не прячем ничего

    // Передняя грань — противоположная стене, к которой прижат предмет.
    const depth = wall === 'left' || wall === 'right' ? o.w : o.h;
    const frontEdge =
      wall === 'left' ? o.x + o.w : wall === 'right' ? o.x : wall === 'bottom' ? o.y + o.h : o.y;
    const distance = Math.abs((wall === 'left' || wall === 'right' ? viewer.x : viewer.y) - frontEdge);

    const visible = visibleDepthUnder(bottom, distance);
    const hidden = depth - Math.min(depth, visible);
    if (hidden <= 0) continue;

    switch (wall) {
      case 'left':
        rects.push({ x: o.x, y: o.y, w: hidden, h: o.h });
        break;
      case 'right':
        rects.push({ x: o.x + o.w - hidden, y: o.y, w: hidden, h: o.h });
        break;
      case 'bottom':
        rects.push({ x: o.x, y: o.y, w: o.w, h: hidden });
        break;
      case 'top':
        rects.push({ x: o.x, y: o.y + o.h - hidden, w: o.w, h: hidden });
        break;
    }
  }

  return rects;
}

/** Скрыта ли плитка укрытиями. Перекрытия между ними для порога безопасны. */
export function isHiddenBy(tile: PlacedTile, covers: Rect[]): boolean {
  if (covers.length === 0) return false;
  const area = tile.w * tile.h;
  if (area === 0) return false;
  const covered = covers.reduce((sum, r) => sum + intersectionArea(tile, r), 0);
  return covered / area >= HIDDEN_COVERAGE;
}

/** Отметка скрытости для каждой плитки раскладки. */
export function hiddenFlags(tiles: PlacedTile[], covers: Rect[]): boolean[] {
  return tiles.map((t) => isHiddenBy(t, covers));
}

/**
 * Координаты граней мебели вдоль оси — кандидаты на совмещение со швом.
 *
 * Выравнивание шва по краю ванны или тумбы — стандартный приём укладки: подрезка
 * уходит под мебель, а на открытом полу линия начинается с целой плитки. Для
 * подвесной мебели это тем важнее, что пол под её кромкой на виду.
 */
export function objectEdges(
  objects: RoomObject[],
  axis: 'x' | 'y',
): Array<{ value: Mm; kind: RoomObject['kind'] }> {
  const seen = new Set<Mm>();
  const edges: Array<{ value: Mm; kind: RoomObject['kind'] }> = [];

  for (const o of objects.filter(isFurniture)) {
    const near = axis === 'x' ? o.x : o.y;
    const far = near + (axis === 'x' ? o.w : o.h);
    for (const value of [near, far]) {
      if (seen.has(value)) continue;
      seen.add(value);
      edges.push({ value, kind: o.kind });
    }
  }

  return edges;
}
