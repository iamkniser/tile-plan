import { buildTilesIn, effectiveTile, mod, steps } from './grid';
import { cutSize } from './metrics';
import { isHiddenBy, type Rect } from './objects';
import { offsetFor } from './strategies';
import {
  EYE_BAND,
  floorJointAlong,
  wallCoverRects,
  wallEdgeHeights,
  wallOpening,
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
): Candidate[] {
  const list: Candidate[] = [
    { label: 'целая от пола', offset: offsetFor('flushStart', height, tileHeight, step, grout) },
    { label: 'целая под потолок', offset: offsetFor('flushEnd', height, tileHeight, step, grout) },
  ];

  for (const edge of edges) {
    if (edge.value <= 0 || edge.value >= height) continue;
    list.push({ label: `шов по кромке: ${labelFor(edge.kind)}`, offset: mod(edge.value, step) });
  }

  const byOffset = new Map<Mm, Candidate>();
  for (const c of list) if (!byOffset.has(c.offset)) byOffset.set(c.offset, c);
  return [...byOffset.values()];
}

function widthCandidates(width: Mm, tileWidth: Mm, step: Mm, grout: Mm): Candidate[] {
  const list: Candidate[] = [
    { label: 'плитка по центру', offset: offsetFor('centerTile', width, tileWidth, step, grout) },
    { label: 'шов по центру', offset: offsetFor('centerJoint', width, tileWidth, step, grout) },
    { label: 'целая от левого угла', offset: offsetFor('flushStart', width, tileWidth, step, grout) },
    { label: 'целая от правого угла', offset: offsetFor('flushEnd', width, tileWidth, step, grout) },
  ];

  const byOffset = new Map<Mm, Candidate>();
  for (const c of list) if (!byOffset.has(c.offset)) byOffset.set(c.offset, c);
  return [...byOffset.values()];
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
): WallVariant[] {
  const { room, tile, door } = project;
  const objects = project.objects ?? [];
  const surface = wallSurface(room, wall);

  const covers = wallCoverRects(room, wall, objects);
  const opening = wallOpening(room, wall, door);
  const blocked: Rect[] = opening ? [...covers, opening] : covers;

  const edges = wallEdgeHeights(room, wall, objects);
  const labelFor = (kind: string) => LABELS[kind] ?? kind;

  const orientations: Orientation[] = tile.width === tile.height ? [0] : [0, 90];
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

    const across = widthCandidates(surface.width, eff.w, step.x, tile.grout);
    const up = heightCandidates(surface.height, eff.h, step.y, tile.grout, edges, labelFor);

    for (const rowShift of shifts) {
      for (const cx of across) {
        for (const cy of up) {
          const layout: Layout = { ox: cx.offset, oy: cy.offset, orientation, rowShift };
          const tiles = buildTilesIn(
            { x0: 0, y0: 0, x1: surface.width, y1: surface.height },
            tile,
            layout,
          );
          const hidden = tiles.map((t) => isHiddenBy(t, blocked));

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

const LABELS: Record<string, string> = {
  bath: 'борт ванны',
  cabinet: 'тумба',
  installation: 'инсталляция',
  washer: 'стиральная машина',
  toilet: 'унитаз',
  sink: 'раковина',
};
