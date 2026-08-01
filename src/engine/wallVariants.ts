import { buildTilesIn, effectiveTile, mod, steps } from './grid';
import { cutSize } from './metrics';
import { isHiddenBy, type Rect } from './objects';
import { offsetFor } from './strategies';
import {
  EYE_BAND,
  floorJointAlong,
  wallCoverRects,
  wallEdgeHeights,
  wallExcludedRects,
  wallSurface,
} from './wall';
import { rowShiftOptions } from './index';
import type {
  Layout,
  Mm,
  Orientation,
  PlacedTile,
  Project,
  Side,
  WallMetrics,
  WallVariant,
} from './types';

interface Candidate {
  label: string;
  offset: Mm;
}

/**
 * Кандидаты старта по высоте.
 *
 * Вертикаль на стене неравноправна, поэтому центрировать раскладку по высоте
 * смысла нет: считается не симметрия, а куда деть подрезку. Годных мест два —
 * под потолок и за ванну; третье — совместить шов с кромкой предмета.
 */
function heightCandidates(
  height: Mm,
  tileHeight: Mm,
  step: Mm,
  grout: Mm,
  edges: Array<{ value: Mm; kind: string }>,
  labelFor: (kind: string) => string,
  /** Отметка, с которой начинается облицовка: 0 — от пола, иначе борт ванны. */
  tilingBottom: Mm,
): Candidate[] {
  const list: Candidate[] = [
    {
      label: tilingBottom > 0 ? 'целая от низа облицовки' : 'целая от пола',
      offset: offsetFor('flushStart', height, tileHeight, step, grout),
    },
    { label: 'целая под потолок', offset: offsetFor('flushEnd', height, tileHeight, step, grout) },
  ];

  for (const edge of edges) {
    if (edge.value <= 0 || edge.value >= height) continue;
    // От кромки, за которой облицовки нет, плитка именно начинается, а не
    // примыкает швом: назвать это «швом по кромке» значило бы соврать.
    const label =
      edge.value === tilingBottom
        ? `целая от кромки: ${labelFor(edge.kind)}`
        : `шов по кромке: ${labelFor(edge.kind)}`;
    list.push({ label, offset: mod(edge.value, step) });
  }

  const byOffset = new Map<Mm, Candidate>();
  for (const c of list) if (!byOffset.has(c.offset)) byOffset.set(c.offset, c);
  return [...byOffset.values()];
}

/**
 * Кандидаты смещения сетки вдоль стены.
 *
 * Отдельно — выравнивание по вертикальным краям проёма. Между углом и проёмом
 * остаётся простенок, куда целая плитка часто не влезает, и тогда решает не
 * «влезет или нет», а сколько там будет кусков: при шве на краю проёма
 * простенок закрывается одним куском вместо двух.
 */
function widthCandidates(
  width: Mm,
  tileWidth: Mm,
  step: Mm,
  grout: Mm,
  verticals: Array<{ value: Mm; label: string }> = [],
): Candidate[] {
  const list: Candidate[] = [
    { label: 'плитка по центру', offset: offsetFor('centerTile', width, tileWidth, step, grout) },
    { label: 'шов по центру', offset: offsetFor('centerJoint', width, tileWidth, step, grout) },
    { label: 'целая от левого угла', offset: offsetFor('flushStart', width, tileWidth, step, grout) },
    { label: 'целая от правого угла', offset: offsetFor('flushEnd', width, tileWidth, step, grout) },
  ];

  for (const v of verticals) {
    if (v.value <= 0 || v.value >= width) continue;
    list.push({ label: v.label, offset: mod(v.value, step) });
  }

  const byOffset = new Map<Mm, Candidate>();
  for (const c of list) if (!byOffset.has(c.offset)) byOffset.set(c.offset, c);
  return [...byOffset.values()];
}

/** Пересечение двух прямоугольников или null. */
function intersect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Вычитает зону из плитки.
 *
 * Если зона срезает плитку насквозь — остаётся прямоугольник поменьше. Если
 * зона задевает только угол, плитку режут буквой Г и кладут одним элементом:
 * дробить её на два прямоугольника было бы враньём — на стене это один кусок.
 */
function subtractZone(tile: PlacedTile, zone: Rect): PlacedTile[] {
  const overlap = intersect(tile, zone);
  if (!overlap) return [tile];

  const coversWidth = overlap.x <= tile.x && overlap.x + overlap.w >= tile.x + tile.w;
  const coversHeight = overlap.y <= tile.y && overlap.y + overlap.h >= tile.y + tile.h;

  // Зона поглотила плитку целиком.
  if (coversWidth && coversHeight) return [];

  // Срез насквозь по горизонтали: остаётся полоса сверху или снизу.
  if (coversWidth) {
    const parts: PlacedTile[] = [];
    if (overlap.y > tile.y) {
      parts.push({ ...tile, h: overlap.y - tile.y, isCut: true });
    }
    if (overlap.y + overlap.h < tile.y + tile.h) {
      const y = overlap.y + overlap.h;
      parts.push({ ...tile, y, h: tile.y + tile.h - y, isCut: true });
    }
    return parts;
  }

  // Срез насквозь по вертикали: остаётся полоса слева или справа.
  if (coversHeight) {
    const parts: PlacedTile[] = [];
    if (overlap.x > tile.x) {
      parts.push({ ...tile, w: overlap.x - tile.x, isCut: true });
    }
    if (overlap.x + overlap.w < tile.x + tile.w) {
      const x = overlap.x + overlap.w;
      parts.push({ ...tile, x, w: tile.x + tile.w - x, isCut: true });
    }
    return parts;
  }

  // Зона задела угол или середину края — режем буквой Г, одним элементом.
  return [{ ...tile, isCut: true, notch: overlap }];
}

/**
 * Убирает из раскладки то, что не облицовывают: пространство за ванной и
 * дверной проём.
 */
function clipToExcluded(tiles: PlacedTile[], zones: Rect[]): PlacedTile[] {
  if (zones.length === 0) return tiles;

  let current = tiles;
  for (const zone of zones) {
    current = current.flatMap((t) => subtractZone(t, zone));
  }
  return current;
}

function uniqueSorted(values: Mm[]): Mm[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function computeWallMetrics(
  tiles: PlacedTile[],
  hidden: boolean[],
  eff: { w: Mm; h: Mm },
  layout: Layout,
  step: { x: Mm; y: Mm },
  edges: Array<{ value: Mm; kind: string }>,
  floorJoint: { offset: Mm; step: Mm },
): WallMetrics {
  const cuts: Record<Side, Mm[]> = { left: [], right: [], bottom: [], top: [] };
  for (const t of tiles) {
    for (const side of t.cutSides) {
      cuts[side].push(side === 'left' || side === 'right' ? t.w : t.h);
    }
  }

  const maxPossible = Math.min(eff.w, eff.h);
  const cutTiles: PlacedTile[] = [];
  const visibleCuts: Mm[] = [];
  const eyeCuts: Mm[] = [];

  tiles.forEach((t, i) => {
    if (!t.isCut) return;
    cutTiles.push(t);
    if (hidden[i]) return;

    const size = cutSize(t);
    visibleCuts.push(size);
    // Уровень глаз: полоса, в которую смотрят стоя, — там подрезка читается как брак.
    if (t.y < EYE_BAND.to && t.y + t.h > EYE_BAND.from) eyeCuts.push(size);
  });

  // Совпадение горизонтального шва с кромкой предмета.
  let edgeAlignment: WallMetrics['edgeAlignment'] = null;
  for (const edge of edges) {
    const d = mod(edge.value - layout.oy, step.y);
    const offset = Math.min(d, step.y - d);
    if (edgeAlignment === null || offset < edgeAlignment.offset) {
      edgeAlignment = { kind: edge.kind as never, offset: Math.round(offset) };
    }
  }

  // Расхождение вертикального шва стены с ближайшим швом пола.
  const dj = mod(layout.ox - floorJoint.offset, floorJoint.step);
  const floorJointOffset = Math.round(Math.min(dj, floorJoint.step - dj));

  return {
    pieceCount: tiles.length,
    distinctCuts: new Set(cutTiles.map((t) => `${t.w}×${t.h}`)).size,
    minCut: cutTiles.length > 0 ? Math.min(...cutTiles.map(cutSize)) : maxPossible,
    minVisibleCut: visibleCuts.length > 0 ? Math.min(...visibleCuts) : maxPossible,
    eyeLevelCut: eyeCuts.length > 0 ? Math.min(...eyeCuts) : maxPossible,
    cutTileCount: cutTiles.length,
    wholeTileCount: tiles.length - cutTiles.length,
    hiddenCutCount: cutTiles.length - visibleCuts.length,
    cuts: {
      left: uniqueSorted(cuts.left),
      right: uniqueSorted(cuts.right),
      bottom: uniqueSorted(cuts.bottom),
      top: uniqueSorted(cuts.top),
    },
    edgeAlignment,
    floorJointOffset,
  };
}

/**
 * Варианты раскладки одной стены.
 *
 * `floorLayout` нужен, чтобы показать расхождение швов стены и пола: подчинять
 * одно другому мы не стали, но молча расходиться на два сантиметра — худшее,
 * что может случиться в углу.
 */
export function generateWallVariants(
  project: Project,
  wall: Side,
  floorLayout?: Layout,
  orientation: Orientation = 0,
): WallVariant[] {
  const { room, door } = project;
  const objects = project.objects ?? [];

  return generateSurfaceVariants(project, {
    id: wall,
    surface: wallSurface(room, wall),
    covers: wallCoverRects(room, wall, objects),
    excluded: wallExcludedRects(room, wall, objects, door),
    edges: wallEdgeHeights(room, wall, objects),
    floorLayout,
    orientation,
  });
}

/** Общая часть: раскладка любой плоской поверхности — стены или экрана ванны. */
export interface SurfaceInput {
  id: Side;
  surface: { width: Mm; height: Mm };
  covers: Rect[];
  excluded: Rect[];
  edges: Array<{ value: Mm; kind: string }>;
  floorLayout?: Layout;
  /**
   * Ориентация плитки на стенах — решение на всё помещение, а не на отдельную
   * поверхность: если на одной стене плитка лежит, а на соседней стоит, рисунок
   * разъезжается на углу. Поэтому её задают, а не перебирают.
   */
  orientation: Orientation;
}

export function generateSurfaceVariants(
  project: Project,
  input: SurfaceInput,
): WallVariant[] {
  const { room, tile } = project;
  const wall = input.id;
  const surface = input.surface;
  const covers = input.covers;
  const excluded = input.excluded;
  const edges = input.edges;
  const floorLayout = input.floorLayout;

  // Если у пола есть зона без облицовки, плитка начинается от её верхней кромки.
  const tilingBottom = excluded
    .filter((z) => z.y <= 0 && z.w >= surface.width / 2)
    .reduce((max, z) => Math.max(max, z.y + z.h), 0);

  const labelFor = (kind: string) => LABELS[kind] ?? kind;

  // Вертикальные линии, по которым имеет смысл поставить шов: края проёма
  // и края предметов вдоль стены.
  const verticals = [
    ...input.excluded.flatMap((z) => [
      { value: z.x, label: 'шов по левому краю проёма' },
      { value: z.x + z.w, label: 'шов по правому краю проёма' },
    ]),
    ...input.covers.flatMap((c) => [
      { value: c.x, label: 'шов по краю мебели' },
      { value: c.x + c.w, label: 'шов по краю мебели' },
    ]),
  ];

  const orientations: Orientation[] = [input.orientation];
  const shifts = rowShiftOptions(tile)
    .filter((o) => o.allowed)
    .map((o) => o.id);

  const variants: WallVariant[] = [];

  for (const orientation of orientations) {
    const eff = effectiveTile(tile, orientation);
    const step = steps(tile, orientation);
    const floorStep = steps(tile, 0);
    const floorJoint = floorLayout
      ? floorJointAlong(room, wall, floorLayout.ox, floorLayout.oy, floorStep.x, floorStep.y)
      : { offset: 0, step: floorStep.x };

    const across = widthCandidates(surface.width, eff.w, step.x, tile.grout, verticals);
    const up = heightCandidates(
      surface.height,
      eff.h,
      step.y,
      tile.grout,
      edges,
      labelFor,
      tilingBottom,
    );

    for (const rowShift of shifts) {
      for (const cx of across) {
        for (const cy of up) {
          const layout: Layout = { ox: cx.offset, oy: cy.offset, orientation, rowShift };
          const tiles = clipToExcluded(
            buildTilesIn({ x0: 0, y0: 0, x1: surface.width, y1: surface.height }, tile, layout),
            excluded,
          );
          const hidden = tiles.map((t) => isHiddenBy(t, covers));

          variants.push({
            wall,
            layout,
            title: `${cy.label} × ${cx.label}`,
            tiles,
            hiddenTiles: hidden,
            metrics: computeWallMetrics(tiles, hidden, eff, layout, step, edges, floorJoint),
          });
        }
      }
    }
  }

  // Схлопываем варианты с одинаковым профилем подрезок.
  const byKey = new Map<string, WallVariant>();
  for (const v of variants) {
    const { cuts } = v.metrics;
    const key = [
      v.layout.orientation,
      v.layout.rowShift,
      cuts.left.join(','),
      cuts.right.join(','),
      cuts.bottom.join(','),
      cuts.top.join(','),
    ].join('|');
    if (!byKey.has(key)) byKey.set(key, v);
  }

  return [...byKey.values()];
}

/** Подрезка тоньше этого на уровне глаз читается как брак укладки. */
export const MIN_EYE_LEVEL_CUT: Mm = 100;

/**
 * Порядок вариантов стены: сначала наименее дроблёные, затем те, где кусков
 * меньше по типоразмерам, и только потом — с крупной подрезкой на уровне глаз.
 *
 * Симметрии здесь не ищем: её ломают проём и мебель, а взгляд цепляется
 * за дробность, а не за ось.
 */
export function rankWallVariants(a: WallVariant, b: WallVariant): number {
  return (
    a.metrics.pieceCount - b.metrics.pieceCount ||
    a.metrics.distinctCuts - b.metrics.distinctCuts ||
    b.metrics.eyeLevelCut - a.metrics.eyeLevelCut ||
    a.metrics.cutTileCount - b.metrics.cutTileCount
  );
}

/**
 * Отсев вариантов с тонкой подрезкой там, куда смотрят стоя. Если правило
 * отбросило бы всё, оно пропускается: показать плохой вариант честнее.
 */
export function rejectWallVariants(variants: WallVariant[]): {
  kept: WallVariant[];
  rejected: number;
} {
  const kept = variants.filter((v) => v.metrics.eyeLevelCut >= MIN_EYE_LEVEL_CUT);
  return kept.length > 0
    ? { kept, rejected: variants.length - kept.length }
    : { kept: variants, rejected: 0 };
}

const LABELS: Record<string, string> = {
  bath: 'борт ванны',
  cabinet: 'тумба',
  installation: 'инсталляция',
  washer: 'стиральная машина',
  toilet: 'унитаз',
  sink: 'раковина',
};
