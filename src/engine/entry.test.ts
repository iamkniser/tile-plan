import { describe, expect, it } from 'vitest';
import { computeEntryMetrics, doorRect, toViewRect, viewRoom } from './entry';
import { buildTiles, steps } from './grid';
import { generateVariants } from './index';
import { offsetFor } from './strategies';
import type { Door, Layout, Room, Tile } from './types';

const tile600: Tile = { width: 600, height: 600, grout: 0 };
const room: Room = { width: 3100, height: 2400 };

function layout(partial: Partial<Layout> = {}): Layout {
  return { ox: 0, oy: 0, orientation: 0, rowShift: 'none', ...partial };
}

function entry(door: Door, l: Layout, r: Room = room, t: Tile = tile600) {
  return computeEntryMetrics(r, t, l, buildTiles(r, t, l), door);
}

describe('симметрия относительно оси входа', () => {
  const door: Door = { wall: 'bottom', offset: 1200, width: 700 }; // центр на 1550 = центр стены

  it('нулевая, когда центр плитки лежит на оси взгляда', () => {
    const ox = offsetFor('centerTile', room.width, 600, steps(tile600, 0).x, 0);
    expect(entry(door, layout({ ox })).asymmetry).toBe(0);
  });

  it('нулевая, когда шов лежит на оси взгляда', () => {
    const ox = offsetFor('centerJoint', room.width, 600, steps(tile600, 0).x, 0);
    expect(entry(door, layout({ ox })).asymmetry).toBe(0);
  });

  it('максимальна при смещении на четверть шага', () => {
    const ox = offsetFor('centerTile', room.width, 600, steps(tile600, 0).x, 0);
    expect(entry(door, layout({ ox: ox + 150 })).asymmetry).toBe(150);
  });

  it('учитывает смещение рядов, когда взгляд идёт поперёк рядов', () => {
    const ox = offsetFor('centerTile', room.width, 600, steps(tile600, 0).x, 0);
    const straight = entry(door, layout({ ox })).asymmetry;
    const shifted = entry(door, layout({ ox, rowShift: 'half' })).asymmetry;

    // При перевязке 1/2 половина рядов смещена на полшага — но полшага это тоже
    // симметричное положение, поэтому симметрия сохраняется.
    expect(straight).toBe(0);
    expect(shifted).toBe(0);

    // А перевязка 1/3 симметрию относительно оси ломает.
    expect(entry(door, layout({ ox, rowShift: 'third' })).asymmetry).toBeGreaterThan(0);
  });

  it('для двери на боковой стене считается по другой оси', () => {
    const sideDoor: Door = { wall: 'left', offset: 850, width: 700 }; // центр на 1200 = центр стены
    const oy = offsetFor('centerTile', room.height, 600, steps(tile600, 0).y, 0);
    expect(entry(sideDoor, layout({ oy })).asymmetry).toBe(0);
  });
});

describe('выравнивание по оси входа', () => {
  // Дверь смещена от центра стены: симметрия по комнате и по взгляду расходятся.
  const offCenter: Door = { wall: 'bottom', offset: 1060, width: 900 }; // ось на 1510

  it('даёт варианты с точной симметрией относительно взгляда', () => {
    const variants = generateVariants({ room, tile: tile600, door: offCenter });
    // Перевязка 1/3 сбивает симметрию сама по себе, каким бы ни было смещение.
    const byEntry = variants.filter(
      (v) =>
        v.layout.rowShift !== 'third' &&
        (v.strategyX === 'centerTileEntry' || v.strategyX === 'centerJointEntry'),
    );

    expect(byEntry.length).toBeGreaterThan(0);
    for (const v of byEntry) {
      expect(v.metrics.entry!.asymmetry).toBeLessThanOrEqual(1);
    }
  });

  it('отличается от выравнивания по центру комнаты, когда дверь смещена', () => {
    const variants = generateVariants({ room, tile: tile600, door: offCenter });
    const byEntry = variants.find((v) => v.strategyX === 'centerTileEntry');
    const byRoom = variants.find((v) => v.strategyX === 'centerTile');

    expect(byEntry).toBeDefined();
    expect(byRoom).toBeDefined();
    expect(byEntry!.layout.ox).not.toBe(byRoom!.layout.ox);
    expect(byEntry!.metrics.entry!.asymmetry).toBeLessThan(byRoom!.metrics.entry!.asymmetry);
  });

  it('не появляется без двери', () => {
    const variants = generateVariants({ room, tile: tile600 });
    expect(
      variants.every(
        (v) => v.strategyX !== 'centerTileEntry' && v.strategyY !== 'centerJointEntry',
      ),
    ).toBe(true);
  });

  it('для двери в боковой стене выравнивает по другой оси', () => {
    const sideDoor: Door = { wall: 'left', offset: 600, width: 700 };
    const variants = generateVariants({ room, tile: tile600, door: sideDoor });

    expect(variants.some((v) => v.strategyY === 'centerTileEntry')).toBe(true);
    expect(variants.every((v) => v.strategyX !== 'centerTileEntry')).toBe(true);
  });
});

describe('зона обзора', () => {
  it('не видит подрезку у стены, на которой стоит дверь', () => {
    // Комната некратна плитке по обеим осям: подрезки есть и у входа, и вдали.
    const door: Door = { wall: 'bottom', offset: 1200, width: 700 };
    const m = entry(door, layout());
    const all = buildTiles(room, tile600, layout()).filter((t) => t.isCut);

    expect(all.length).toBeGreaterThan(m.cutTileCount);
  });

  it('видит подрезку у противоположной стены', () => {
    // Ширина кратна плитке, чтобы в зону попадали только подрезки по глубине.
    const even: Room = { width: 3000, height: 2400 };
    const door: Door = { wall: 'bottom', offset: 1150, width: 700 };
    const m = entry(door, layout({ oy: 300 }), even);

    expect(m.cutTileCount).toBeGreaterThan(0);
    expect(m.minCut).toBe(300);
  });

  it('без подрезок в зоне отдаёт размер плитки', () => {
    const square: Room = { width: 3000, height: 1800 };
    const door: Door = { wall: 'bottom', offset: 1150, width: 700 };
    expect(entry(door, layout(), square).minCut).toBe(600);
  });
});

describe('вид от входа', () => {
  it('для нижней стены оставляет координаты как есть', () => {
    const r = { x: 100, y: 200, w: 300, h: 400 };
    expect(toViewRect(room, 'bottom', r)).toEqual(r);
    expect(viewRoom(room, 'bottom')).toEqual(room);
  });

  it('для боковой стены меняет оси местами', () => {
    expect(viewRoom(room, 'left')).toEqual({ width: room.height, height: room.width });
    expect(viewRoom(room, 'right')).toEqual({ width: room.height, height: room.width });
  });

  it('ставит порог в начало координат вида для любой стены', () => {
    for (const wall of ['bottom', 'top', 'left', 'right'] as const) {
      const v = toViewRect(room, wall, doorRect(room, { wall, offset: 400, width: 700 }, 70));
      expect(v.y).toBe(0); // глубина от входа равна нулю
    }
  });

  it('сохраняет размеры плитки при повороте вида', () => {
    const r = { x: 100, y: 200, w: 300, h: 400 };
    const v = toViewRect(room, 'left', r);
    expect(new Set([v.w, v.h])).toEqual(new Set([r.w, r.h]));
  });
});
