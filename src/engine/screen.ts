import type { Rect } from './objects';
import { generateSurfaceVariants } from './wallVariants';
import type { Layout, Mm, Project, Room, RoomObject, Side, WallVariant } from './types';

/**
 * Экран ванны — вертикальная плоскость по её лицевой грани, от пола до борта.
 * Его тоже облицовывают, причём это самая близкая к глазу плоскость в санузле:
 * на неё смотрят с расстояния вытянутой руки.
 */
export interface ScreenSurface {
  objectId: string;
  /** Длина экрана вдоль ванны. */
  width: Mm;
  /** Высота от пола до борта. */
  height: Mm;
  /** К какой стене прижата ванна: лицевая грань — противоположная. */
  attachedTo: Side;
}

/** К какой стене прижат предмет; null — если стоит на отшибе. */
function attachedWall(o: RoomObject, room: Room): Side | null {
  const touching: Array<{ wall: Side; depth: Mm }> = [];
  if (o.x <= 0) touching.push({ wall: 'left', depth: o.w });
  if (o.x + o.w >= room.width) touching.push({ wall: 'right', depth: o.w });
  if (o.y <= 0) touching.push({ wall: 'bottom', depth: o.h });
  if (o.y + o.h >= room.height) touching.push({ wall: 'top', depth: o.h });

  if (touching.length === 0) return null;
  return touching.reduce((a, b) => (b.depth < a.depth ? b : a)).wall;
}

export function screenSurface(room: Room, object: RoomObject): ScreenSurface | null {
  const height = object.topHeight ?? 0;
  if (height <= 0) return null;

  const wall = attachedWall(object, room);
  if (wall === null) return null;

  // Вдоль боковой стены экран тянется по Y, вдоль торцевой — по X.
  const width = wall === 'left' || wall === 'right' ? object.h : object.w;
  return { objectId: object.id, width, height, attachedTo: wall };
}

/** Координата плоскости экрана и ось, вдоль которой он идёт. */
function screenPlane(object: RoomObject, wall: Side): { at: Mm; axis: 'x' | 'y'; from: Mm; to: Mm } {
  switch (wall) {
    case 'left':
      return { at: object.x + object.w, axis: 'x', from: object.y, to: object.y + object.h };
    case 'right':
      return { at: object.x, axis: 'x', from: object.y, to: object.y + object.h };
    case 'bottom':
      return { at: object.y + object.h, axis: 'y', from: object.x, to: object.x + object.w };
    case 'top':
      return { at: object.y, axis: 'y', from: object.x, to: object.x + object.w };
  }
}

/**
 * Что закрывает экран: предмет, прилегающий к нему вплотную.
 *
 * Тумба, поставленная торцом к экрану, перекрывает его на своей длине —
 * облицовывать эту полосу незачем, а подрезка там не видна.
 */
export function screenCovers(
  room: Room,
  object: RoomObject,
  others: RoomObject[],
): Array<Rect & { id: string; kind: RoomObject['kind'] }> {
  const surface = screenSurface(room, object);
  if (!surface) return [];

  const plane = screenPlane(object, surface.attachedTo);
  const covers: Array<Rect & { id: string; kind: RoomObject['kind'] }> = [];

  for (const other of others) {
    if (other.id === object.id) continue;

    // Предмет должен доставать до плоскости экрана — хотя бы касаться её.
    const spanFrom = plane.axis === 'x' ? other.x : other.y;
    const spanTo = spanFrom + (plane.axis === 'x' ? other.w : other.h);
    if (plane.at < spanFrom || plane.at > spanTo) continue;

    // Перекрытие вдоль экрана.
    const alongFrom = plane.axis === 'x' ? other.y : other.x;
    const alongTo = alongFrom + (plane.axis === 'x' ? other.h : other.w);
    const from = Math.max(plane.from, alongFrom);
    const to = Math.min(plane.to, alongTo);
    if (to - from <= 0) continue;

    const bottom = other.bottomHeight ?? 0;
    const top = Math.min(other.topHeight ?? surface.height, surface.height);
    if (top - bottom <= 0) continue;

    covers.push({
      id: other.id,
      kind: other.kind,
      x: from - plane.from,
      y: bottom,
      w: to - from,
      h: top - bottom,
    });
  }

  return covers;
}

/**
 * Варианты облицовки экрана ванны.
 *
 * Метрика «уровень глаз» здесь не срабатывает: экран целиком ниже неё. Зато
 * важен верхний ряд — он стыкуется с бортом и виден с полуметра.
 */
export function generateScreenVariants(
  project: Project,
  objectId: string,
  floorLayout?: Layout,
): WallVariant[] {
  const objects = project.objects ?? [];
  const object = objects.find((o) => o.id === objectId);
  if (!object) return [];

  const surface = screenSurface(project.room, object);
  if (!surface) return [];

  const covers = screenCovers(project.room, object, objects);

  return generateSurfaceVariants(project, {
    // Экран отсчитывается от той же стены, к которой прижата ванна.
    id: surface.attachedTo,
    surface: { width: surface.width, height: surface.height },
    covers,
    // Полностью перекрытый участок облицовывать незачем.
    excluded: covers.filter((c) => c.h >= surface.height),
    edges: [],
    floorLayout,
  });
}
