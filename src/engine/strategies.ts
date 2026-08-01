import { mod } from './grid';
import { objectEdges } from './objects';
import { OBJECT_LABEL } from './types';
import type { Mm, RoomObject, StrategyId } from './types';

/** Порядок задаёт приоритет при дедупликации: чем раньше, тем понятнее название. */
export const STRATEGY_ORDER: StrategyId[] = [
  'centerTileEntry',
  'centerJointEntry',
  'centerTile',
  'centerJoint',
  'alignObject',
  'flushStart',
  'flushEnd',
];

/** Стратегии, не зависящие от обстановки: смещение выводится из одних размеров. */
export type BaseStrategyId = Exclude<
  StrategyId,
  'alignObject' | 'centerTileEntry' | 'centerJointEntry'
>;

const BASE_STRATEGIES: BaseStrategyId[] = [
  'centerTile',
  'centerJoint',
  'flushStart',
  'flushEnd',
];

export type Axis = 'x' | 'y';

const LABELS: Record<StrategyId, Record<Axis, string>> = {
  centerTileEntry: { x: 'плитка по оси входа', y: 'плитка по оси входа' },
  centerJointEntry: { x: 'шов по оси входа', y: 'шов по оси входа' },
  centerTile: { x: 'плитка по центру', y: 'плитка по центру' },
  centerJoint: { x: 'шов по центру', y: 'шов по центру' },
  alignObject: { x: 'шов по краю мебели', y: 'шов по краю мебели' },
  flushStart: { x: 'целая от левой стены', y: 'целая от нижней стены' },
  flushEnd: { x: 'целая от правой стены', y: 'целая от верхней стены' },
};

export function strategyLabel(id: StrategyId, axis: Axis): string {
  return LABELS[id][axis];
}

export interface AxisCandidate {
  id: StrategyId;
  label: string;
  offset: Mm;
}

/**
 * Кандидаты смещения сетки вдоль одной оси: базовые стратегии плюс выравнивание
 * шва по граням мебели. Совпадающие смещения схлопываются — приоритет у стратегии,
 * которая раньше в STRATEGY_ORDER, то есть у более понятного названия.
 */
export function axisCandidates(
  axis: Axis,
  length: Mm,
  tileLength: Mm,
  step: Mm,
  grout: Mm,
  objects: RoomObject[] = [],
  /** Координата оси входа на этой оси; null — если взгляд идёт вдоль неё. */
  entryCenter: Mm | null = null,
): AxisCandidate[] {
  const candidates: AxisCandidate[] = BASE_STRATEGIES.map((id) => ({
    id,
    label: strategyLabel(id, axis),
    offset: offsetFor(id, length, tileLength, step, grout),
  }));

  // Дверь редко стоит по центру стены, поэтому симметрия относительно комнаты
  // и относительно взгляда — разные раскладки. Вторая важнее (SPEC.md §6).
  if (entryCenter !== null) {
    candidates.push({
      id: 'centerTileEntry',
      label: strategyLabel('centerTileEntry', axis),
      offset: mod(Math.round(entryCenter - tileLength / 2), step),
    });
    candidates.push({
      id: 'centerJointEntry',
      label: strategyLabel('centerJointEntry', axis),
      offset: mod(Math.round(entryCenter + grout / 2), step),
    });
  }

  for (const edge of objectEdges(objects, axis)) {
    // Грань, совпадающая со стеной, не даёт нового варианта — это flushStart/flushEnd.
    if (edge.value <= 0 || edge.value >= length) continue;
    candidates.push({
      id: 'alignObject',
      label: `шов по краю: ${OBJECT_LABEL[edge.kind]}`,
      offset: mod(edge.value, step),
    });
  }

  const byOffset = new Map<Mm, AxisCandidate>();
  for (const c of candidates) {
    const existing = byOffset.get(c.offset);
    if (!existing || STRATEGY_ORDER.indexOf(c.id) < STRATEGY_ORDER.indexOf(existing.id)) {
      byOffset.set(c.offset, c);
    }
  }

  return [...byOffset.values()];
}

/**
 * Смещение сетки вдоль одной оси для заданной стратегии (SPEC.md §5).
 *
 * @param length длина комнаты по оси
 * @param tileLength размер плитки по оси (уже с учётом поворота)
 * @param step шаг сетки по оси (плитка + шов)
 * @param grout ширина шва
 * @returns смещение первой границы плитки, нормализовано в [0, step)
 */
export function offsetFor(
  id: BaseStrategyId,
  length: Mm,
  tileLength: Mm,
  step: Mm,
  grout: Mm,
): Mm {
  switch (id) {
    case 'flushStart':
      return 0;
    case 'flushEnd':
      return mod(length - tileLength, step);
    case 'centerTile':
      // Центр плитки совпадает с центром оси.
      return mod(Math.round(length / 2 - tileLength / 2), step);
    case 'centerJoint':
      // Центр шва совпадает с центром оси; следующая плитка начинается за швом.
      return mod(Math.round(length / 2 + grout / 2), step);
  }
}
