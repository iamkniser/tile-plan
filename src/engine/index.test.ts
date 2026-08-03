import { describe, expect, it } from 'vitest';
import {
  MIN_COMFORTABLE_CUT,
  MIN_HIDDEN_CUT,
  MIN_PRACTICAL_CUT,
  generateVariants,
  rejectImpractical,
} from './index';
import type { Door, Room, RoomObject, Tile } from './types';

const room: Room = { width: 2600, height: 1700 };
const tile: Tile = { width: 1200, height: 600, grout: 2 };
const door: Door = { wall: 'bottom', offset: 1060, width: 900, thresholdDepth: 150 };
const objects: RoomObject[] = [
  { id: 'bath', kind: 'bath', x: 0, y: 0, w: 700, h: 1700 },
  { id: 'cab', kind: 'cabinet', x: 700, y: 1200, w: 1900, h: 500, bottomHeight: 250 },
];

describe('отсев непрактичных вариантов', () => {
  it('убирает варианты с нерезабельными подрезками', () => {
    const all = generateVariants({ room, tile, door, objects });
    const { kept, rejections } = rejectImpractical(all);

    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(all.length);
    for (const v of kept) {
      expect(v.metrics.minCut).toBeGreaterThanOrEqual(MIN_HIDDEN_CUT);
      expect(v.metrics.minVisibleCut).toBeGreaterThanOrEqual(MIN_COMFORTABLE_CUT);
    }
    expect(rejections.length).toBeGreaterThan(0);
    expect(rejections.every((r) => r.count > 0)).toBe(true);
  });

  it('оставляет вариант с привязкой к проёму: его тонкий ряд уходит под мебель', () => {
    const { kept } = rejectImpractical(generateVariants({ room, tile, door, objects }));
    const anchored = kept.find(
      (v) => v.strategyY === 'fromEntry' && v.layout.orientation === 0,
    );

    expect(anchored).toBeDefined();
    // Ряд, добирающий глубину помещения, тоньше видимого порога — но не виден.
    expect(anchored!.metrics.minCut).toBeLessThan(MIN_PRACTICAL_CUT);
    expect(anchored!.metrics.hiddenCutCount).toBeGreaterThan(0);
    // Зато у порога лежит плитка во всю глубину, без продольного роспуска.
    expect(anchored!.metrics.threshold!.seamless).toBe(true);
    expect(anchored!.metrics.threshold!.outerCut).toBe(tile.height);
  });

  it('не выбрасывает узкие куски из проёма молча', () => {
    const { kept } = rejectImpractical(generateVariants({ room, tile, door, objects }));
    for (const v of kept) {
      expect(v.metrics.threshold!.narrowestPiece).toBeGreaterThanOrEqual(MIN_PRACTICAL_CUT);
    }
  });

  it('никогда не оставляет пустой список', () => {
    // Комната, где любая раскладка даёт тонкую подрезку.
    const awkward: Room = { width: 1210, height: 1210 };
    const { kept } = rejectImpractical(generateVariants({ room: awkward, tile, door }));
    expect(kept.length).toBeGreaterThan(0);
  });
});
