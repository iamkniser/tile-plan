import { describe, expect, it } from 'vitest';
import { buildRationale } from './rationale';
import { generateVariants, rejectImpractical } from './index';
import type { Door, Room, RoomObject, Tile, Variant } from './types';

const room: Room = { width: 2600, height: 1700 };
const tile: Tile = { width: 1200, height: 600, grout: 2 };
const door: Door = { wall: 'bottom', offset: 1060, width: 900, thresholdDepth: 150 };
const objects: RoomObject[] = [
  { id: 'bath', kind: 'bath', x: 0, y: 0, w: 700, h: 1700 },
  { id: 'cab', kind: 'cabinet', x: 700, y: 1200, w: 1900, h: 500, bottomHeight: 250 },
];

function variants(): Variant[] {
  return rejectImpractical(generateVariants({ room, tile, door, objects })).kept;
}

describe('объяснение варианта', () => {
  it('называет симметрию плюсом, когда она есть', () => {
    const all = variants();
    const symmetric = all.find((v) => Math.round(v.metrics.entry!.asymmetry) <= 5)!;
    const r = buildRationale(symmetric, all);

    expect(r.pros.some((p) => p.includes('симметрич'))).toBe(true);
    expect(r.cons.some((c) => c.includes('сбита'))).toBe(false);
  });

  it('называет сбитую симметрию минусом', () => {
    const all = variants();
    const skewed = all.find((v) => Math.round(v.metrics.entry!.asymmetry) > 5);

    if (skewed) {
      const r = buildRationale(skewed, all);
      expect(r.cons.some((c) => c.includes('сбита'))).toBe(true);
    }
  });

  it('отмечает подрезки, спрятанные под мебель', () => {
    const all = variants();
    const hiding = all.find((v) => v.metrics.hiddenCutCount > 0)!;
    const r = buildRationale(hiding, all);

    expect(r.pros.some((p) => p.includes('под ванну и мебель'))).toBe(true);
  });

  it('отмечает сквозную плитку в проёме', () => {
    const all = variants();
    const seamless = all.find((v) => v.metrics.threshold?.seamless)!;
    const r = buildRationale(seamless, all);

    expect(r.pros.some((p) => p.includes('насквозь'))).toBe(true);
  });

  it('называет компромисс по числу резов и с чем сравнивает', () => {
    const all = variants();
    const leanest = all.reduce((a, b) =>
      b.metrics.cutTileCount < a.metrics.cutTileCount ? b : a,
    );
    const wasteful = all.find((v) => v.metrics.cutTileCount > leanest.metrics.cutTileCount)!;
    const r = buildRationale(wasteful, all);

    expect(r.tradeoff).toContain('Резать на');
    expect(r.tradeoff).toContain(leanest.title);
  });

  it('у самого экономного варианта компромисса нет', () => {
    const all = variants();
    const leanest = all.reduce((a, b) =>
      b.metrics.cutTileCount < a.metrics.cutTileCount ? b : a,
    );
    const r = buildRationale(leanest, all);

    expect(r.tradeoff).toBeNull();
    expect(r.pros.some((p) => p.includes('Меньше всего резов'))).toBe(true);
  });

  it('не выдаёт простыню: не больше четырёх плюсов и трёх минусов', () => {
    for (const v of variants()) {
      const r = buildRationale(v, variants());
      expect(r.pros.length).toBeLessThanOrEqual(4);
      expect(r.cons.length).toBeLessThanOrEqual(3);
    }
  });

  it('предупреждает о тонком ряде, спрятанном под мебелью', () => {
    const all = variants();
    const anchored = all.find((v) => v.strategyY === 'fromEntry' && v.layout.orientation === 0)!;
    const r = buildRationale(anchored, all);

    // Ряд не виден, поэтому в плюсах он как скрытая подрезка, а в минусах —
    // как единственное место, куда уходит погрешность помещения.
    expect(r.cons.some((c) => c.includes('погрешность помещения'))).toBe(true);
    expect(r.pros.some((p) => p.includes('не будет видно'))).toBe(true);
  });

  it('работает без двери, когда оценивать вход нечем', () => {
    const all = generateVariants({ room, tile, objects });
    const r = buildRationale(all[0], all);

    expect(r.pros.every((p) => !p.includes('вход'))).toBe(true);
  });
});

describe('склонения', () => {
  it('согласует число плиток со словом', () => {
    const all = variants();
    for (const v of all) {
      const r = buildRationale(v, all);
      const text = [...r.pros, ...r.cons, r.tradeoff ?? ''].join(' ');
      expect(text).not.toMatch(/\b\d*[02-9]1 плиток\b/);
      expect(text).not.toMatch(/\b[234] плиток больше/);
      expect(text).not.toMatch(/\b\d*[5-9] плитки\b/);
    }
  });
});
