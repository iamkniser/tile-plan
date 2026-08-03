import { computeEntryMetrics, doorCenter, viewerPoint } from './entry';
import { buildTiles, effectiveTile, steps } from './grid';
import { computeMetrics } from './metrics';
import { coverRects, hiddenFlags } from './objects';
import { buildThresholdTiles, computeThresholdMetrics, thresholdTileStart } from './threshold';
import { STRATEGY_ORDER, axisCandidates } from './strategies';
import type {
  Layout,
  Orientation,
  Project,
  RowShift,
  Tile,
  Variant,
} from './types';

export * from './types';
export { buildTiles, effectiveTile, steps } from './grid';
export { axisCandidates, strategyLabel } from './strategies';
export { EYE_HEIGHT, coverRects, hiddenFlags, isHiddenBy, objectEdges, visibleDepthUnder } from './objects';
export type { Rect } from './objects';
export { buildInstructions, sideName } from './instructions';
export { buildRationale } from './rationale';
export {
  DEFAULT_CEILING,
  EYE_BAND,
  floorJointAlong,
  wallCoverRects,
  wallEdgeHeights,
  wallOpening,
  wallSurface,
} from './wall';
export type { WallCover, WallSurface } from './wall';
export {
  MIN_EYE_LEVEL_CUT,
  generateWallVariants,
  rankWallVariants,
  rejectWallVariants,
} from './wallVariants';
export { generateScreenVariants, screenCovers, screenSurface } from './screen';
export type { ScreenSurface } from './screen';
export type { Rationale } from './rationale';
export {
  buildThresholdTiles,
  computeThresholdMetrics,
  thresholdBounds,
  thresholdTileStart,
} from './threshold';
export {
  computeEntryMetrics,
  doorCenter,
  viewerPoint,
  doorRect,
  toViewRect,
  viewRoom,
  wallLength,
} from './entry';

/**
 * Длина плитки, начиная с которой производители запрещают перевязку в половину:
 * из-за прогиба крупноформатной плиты на шве возникает заметный перепад
 * («пропеллер»). SPEC.md §5.
 */
export const LARGE_FORMAT_MM = 900;

export interface RowShiftOption {
  id: RowShift;
  label: string;
  allowed: boolean;
  reason?: string;
}

export function rowShiftOptions(tile: Tile): RowShiftOption[] {
  const longest = Math.max(tile.width, tile.height);
  const halfAllowed = longest < LARGE_FORMAT_MM;
  return [
    { id: 'none', label: 'без смещения', allowed: true },
    { id: 'third', label: 'смещение 1/3', allowed: true },
    {
      id: 'half',
      label: 'смещение 1/2',
      allowed: halfAllowed,
      reason: halfAllowed
        ? undefined
        : `Для плитки длиной ${longest} мм перевязка в половину не применяется: ` +
          `на длинной стороне возникает перепад плоскости. Максимум — 1/3.`,
    },
  ];
}

/** Ключ для схлопывания визуально одинаковых вариантов (SPEC.md §5). */
function dedupeKey(v: Variant): string {
  const { cuts } = v.metrics;
  return [
    v.layout.orientation,
    v.layout.rowShift,
    cuts.left.join(','),
    cuts.right.join(','),
    cuts.bottom.join(','),
    cuts.top.join(','),
  ].join('|');
}

function strategyRank(v: Variant): number {
  return STRATEGY_ORDER.indexOf(v.strategyX) + STRATEGY_ORDER.indexOf(v.strategyY);
}

/**
 * Подрезка тоньше этого крошится при резке и почти не держится на клею —
 * плиточники таких кусков избегают, даже если их не видно.
 */
export const MIN_PRACTICAL_CUT = 50;

/** Подрезка тоньше этого в поле зрения читается как ошибка укладки. */
export const MIN_COMFORTABLE_CUT = 100;

/**
 * Скрытой мебелью подрезке позволено быть уже видимой: именно туда уводят ряд,
 * добирающий погрешность помещения, и скол там ничего не стоит. Но резаться она
 * всё равно должна — полоска тоньше этого крошится на плиткорезе и не держится
 * на клею. Число из практики и не откалибровано (SPEC.md §10).
 */
export const MIN_HIDDEN_CUT = 30;

export interface Rejection {
  reason: string;
  count: number;
}

/**
 * Отсеивает варианты с непрактично мелкими подрезками, объясняя, что именно ушло.
 * Если после отсева не остаётся ничего, список возвращается как есть: показать
 * плохой вариант честнее, чем не показать никакого.
 */
export function rejectImpractical(variants: Variant[]): {
  kept: Variant[];
  rejections: Rejection[];
} {
  const rejections: Rejection[] = [];

  const checks: Array<{ reason: string; ok: (v: Variant) => boolean }> = [
    {
      reason: `подрезка тоньше ${MIN_HIDDEN_CUT} мм — такую не отрезать и не приклеить`,
      ok: (v) => v.metrics.minCut >= MIN_HIDDEN_CUT,
    },
    {
      reason: `на виду подрезка тоньше ${MIN_PRACTICAL_CUT} мм — такую сложно резать`,
      ok: (v) => v.metrics.minVisibleCut >= MIN_PRACTICAL_CUT,
    },
    {
      reason: `на виду подрезка тоньше ${MIN_COMFORTABLE_CUT} мм`,
      ok: (v) => v.metrics.minVisibleCut >= MIN_COMFORTABLE_CUT,
    },
    {
      reason: 'в дверном проёме оказался узкий кусок плитки',
      ok: (v) =>
        v.metrics.threshold === undefined ||
        v.metrics.threshold.narrowestPiece >= MIN_PRACTICAL_CUT,
    },
  ];

  let kept = variants;
  for (const check of checks) {
    const passing = kept.filter(check.ok);
    if (passing.length === 0) continue; // правило отбросило бы всё — пропускаем
    if (passing.length < kept.length) {
      rejections.push({ reason: check.reason, count: kept.length - passing.length });
    }
    kept = passing;
  }

  return { kept, rejections };
}

export function generateVariants(project: Project): Variant[] {
  const { room, tile, door } = project;
  const objects = project.objects ?? [];
  // Что именно закрыто от глаз, зависит от того, откуда смотрят: под подвесной
  // мебелью пол просматривается на глубину, заданную высотой её кромки.
  const covers = coverRects(objects, room, door ? viewerPoint(room, door) : null);

  const orientations: Orientation[] =
    tile.width === tile.height ? [0] : [0, 90];
  const shifts = rowShiftOptions(tile)
    .filter((o) => o.allowed)
    .map((o) => o.id);

  const variants: Variant[] = [];

  for (const orientation of orientations) {
    const eff = effectiveTile(tile, orientation);
    const step = steps(tile, orientation);

    // Ось входа лежит поперёк направления взгляда: для двери в торцевой стене
    // это ось X, для двери в боковой — ось Y.
    const entryAxis = door && (door.wall === 'bottom' || door.wall === 'top') ? 'x' : 'y';
    const entryCenter = door ? doorCenter(door) : null;

    // Проём уходит вглубь по оси, перпендикулярной оси входа: привязка к его
    // кромке имеет смысл только на ней.
    const depthAxis = entryAxis === 'x' ? 'y' : 'x';
    const thresholdX =
      door && depthAxis === 'x' ? thresholdTileStart(room, door, eff.w) : null;
    const thresholdY =
      door && depthAxis === 'y' ? thresholdTileStart(room, door, eff.h) : null;

    const alongX = axisCandidates(
      'x',
      room.width,
      eff.w,
      step.x,
      tile.grout,
      objects,
      entryAxis === 'x' ? entryCenter : null,
      thresholdX,
    );
    const alongY = axisCandidates(
      'y',
      room.height,
      eff.h,
      step.y,
      tile.grout,
      objects,
      entryAxis === 'y' ? entryCenter : null,
      thresholdY,
    );

    for (const rowShift of shifts) {
      for (const cx of alongX) {
        for (const cy of alongY) {
          const layout: Layout = { ox: cx.offset, oy: cy.offset, orientation, rowShift };
          const tiles = buildTiles(room, tile, layout);
          const metrics = computeMetrics(room, tile, layout, tiles, covers);

          variants.push({
            layout,
            strategyX: cx.id,
            strategyY: cy.id,
            hiddenTiles: hiddenFlags(tiles, covers),
            thresholdTiles: door ? buildThresholdTiles(room, tile, layout, door) : [],
            title: `${cx.label} × ${cy.label}`,
            tiles,
            metrics: door
              ? {
                  ...metrics,
                  entry: computeEntryMetrics(room, tile, layout, tiles, door, covers),
                  threshold: computeThresholdMetrics(room, tile, layout, door),
                }
              : metrics,
          });
        }
      }
    }
  }

  // Схлопываем одинаковые профили подрезок, оставляя вариант с самым понятным названием.
  const byKey = new Map<string, Variant>();
  for (const v of variants) {
    const key = dedupeKey(v);
    const existing = byKey.get(key);
    if (!existing || strategyRank(v) < strategyRank(existing)) {
      byKey.set(key, v);
    }
  }

  return [...byKey.values()];
}
