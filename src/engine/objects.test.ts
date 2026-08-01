import { describe, expect, it } from 'vitest';
import { computeEntryMetrics } from './entry';
import { buildTiles, steps } from './grid';
import { generateVariants } from './index';
import { computeMetrics } from './metrics';
import { EYE_HEIGHT, coverRects, isHiddenBy, objectEdges, visibleDepthUnder } from './objects';
import { axisCandidates } from './strategies';
import type { Door, Layout, PlacedTile, Room, RoomObject, Tile } from './types';

const tile600: Tile = { width: 600, height: 600, grout: 0 };
const room: Room = { width: 3100, height: 2400 };

/** Ванна вдоль левой стены: закрывает полосу шириной 700 мм по всей длине. */
const bath: RoomObject = { id: 'bath', kind: 'bath', x: 0, y: 0, w: 700, h: 1700 };

function layout(partial: Partial<Layout> = {}): Layout {
  return { ox: 0, oy: 0, orientation: 0, rowShift: 'none', ...partial };
}

function tileAt(x: number, y: number, w: number, h: number): PlacedTile {
  return { x, y, w, h, row: 0, col: 0, isCut: true, cutSides: ['left'] };
}


/** Укрытия для набора объектов; наблюдатель — у середины нижней стены. */
function covers(objects: RoomObject[], r: Room = room) {
  return coverRects(objects, r, { x: r.width / 2, y: 0 });
}

describe('isHiddenBy', () => {
  it('считает скрытой плитку целиком под мебелью', () => {
    expect(isHiddenBy(tileAt(0, 0, 300, 600), covers([bath]))).toBe(true);
  });

  it('не считает скрытой плитку, торчащую из-под мебели', () => {
    expect(isHiddenBy(tileAt(600, 0, 600, 600), covers([bath]))).toBe(false);
  });

  it('не считает скрытой плитку вне мебели', () => {
    expect(isHiddenBy(tileAt(2000, 0, 600, 600), covers([bath]))).toBe(false);
  });

  it('без мебели ничего не скрыто', () => {
    expect(isHiddenBy(tileAt(0, 0, 300, 600), covers([]))).toBe(false);
  });

  it('унитаз не прячет подрезки: пол вокруг него виден', () => {
    const toilet: RoomObject = { id: 't', kind: 'toilet', x: 0, y: 0, w: 700, h: 1700 };
    expect(isHiddenBy(tileAt(0, 0, 300, 600), covers([toilet]))).toBe(false);
  });
});

describe('видимая подрезка', () => {
  // Тесная комната, где ванна занимает левую стену целиком.
  const small: Room = { width: 3000, height: 1700 };
  const wallBath: RoomObject = { id: 'bath', kind: 'bath', x: 0, y: 0, w: 700, h: 1700 };

  it('исключает подрезки, спрятанные под ванной', () => {
    // Смещение 50 мм создаёт тонкую подрезку вдоль левой стены — как раз под ванной.
    const l = layout({ ox: 50 });
    const tiles = buildTiles(small, tile600, l);

    const bare = computeMetrics(small, tile600, l, tiles);
    const withBath = computeMetrics(small, tile600, l, tiles, covers([wallBath], small));

    expect(bare.minCut).toBe(50);
    expect(bare.minVisibleCut).toBe(50);
    expect(withBath.minCut).toBe(50); // сама подрезка никуда не делась
    expect(withBath.minVisibleCut).toBeGreaterThan(50); // но её больше не видно
    expect(withBath.hiddenCutCount).toBeGreaterThan(0);
  });

  it('не прячет подрезки выше ванны, если она короче стены', () => {
    // Ванна 1700 мм в комнате 2400 мм: над ней остаётся открытый пол.
    const l = layout({ ox: 50 });
    const m = computeMetrics(room, tile600, l, buildTiles(room, tile600, l), covers([bath]));

    expect(m.minVisibleCut).toBe(50);
  });

  it('без мебели видимая подрезка совпадает с минимальной', () => {
    const l = layout({ ox: 50 });
    const m = computeMetrics(room, tile600, l, buildTiles(room, tile600, l));
    expect(m.minVisibleCut).toBe(m.minCut);
  });

  it('мебель убирает подрезку и из зоны обзора', () => {
    // Ванна у дальней стены стоит прямо по курсу вошедшего и закрывает
    // подрезку, которая иначе была бы самой заметной.
    const farBath: RoomObject = { id: 'b', kind: 'bath', x: 0, y: 1000, w: 3000, h: 700 };
    const door: Door = { wall: 'bottom', offset: 1150, width: 700 };
    const l = layout();
    const tiles = buildTiles(small, tile600, l);

    const bare = computeEntryMetrics(small, tile600, l, tiles, door);
    const withBath = computeEntryMetrics(small, tile600, l, tiles, door, covers([farBath], small));

    expect(bare.cutTileCount).toBeGreaterThan(0);
    expect(withBath.cutTileCount).toBe(0);
    expect(withBath.minCut).toBeGreaterThan(bare.minCut);
  });
});

describe('видимость пола под подвесной мебелью', () => {
  it('предмет на полу не пропускает взгляд под себя', () => {
    expect(visibleDepthUnder(0, 1200)).toBe(0);
  });

  it('кромка выше глаз не закрывает пол вовсе', () => {
    expect(visibleDepthUnder(EYE_HEIGHT, 1200)).toBe(Infinity);
  });

  it('считает глубину просмотра по подобию треугольников', () => {
    // L·h / (E − h) = 1200 · 250 / 1350 ≈ 222 мм
    expect(Math.round(visibleDepthUnder(250, 1200))).toBe(222);
  });

  it('чем дальше предмет, тем глубже видно под ним', () => {
    expect(visibleDepthUnder(250, 2000)).toBeGreaterThan(visibleDepthUnder(250, 1000));
  });

  it('оставляет скрытой только дальнюю полосу под тумбой', () => {
    const room2: Room = { width: 2600, height: 1700 };
    // Подвесная тумба у дальней стены: глубина 500, кромка на 250 мм.
    const cabinet: RoomObject = {
      id: 'c',
      kind: 'cabinet',
      x: 700,
      y: 1200,
      w: 1650,
      h: 500,
      bottomHeight: 250,
    };
    const [rect] = coverRects([cabinet], room2, { x: 1510, y: 0 });

    expect(rect).toBeDefined();
    expect(Math.round(rect.h)).toBe(278); // 500 − 222
    expect(rect.y + rect.h).toBe(1700); // скрыта полоса, прилегающая к стене
  });

  it('тумба во всю стену прижата к дальней стене, а не к боковой', () => {
    const room2: Room = { width: 2600, height: 1700 };
    // Тумба упирается и в дальнюю стену, и в правую: важно не перепутать ось.
    const cabinet: RoomObject = {
      id: 'c',
      kind: 'cabinet',
      x: 700,
      y: 1200,
      w: 1900,
      h: 500,
      bottomHeight: 250,
    };
    const [rect] = coverRects([cabinet], room2, { x: 1510, y: 0 });

    expect(rect.x).toBe(700); // укрытие по всей длине тумбы
    expect(rect.w).toBe(1900);
    expect(Math.round(rect.h)).toBe(278); // и только дальняя полоса по глубине
  });

  it('без известной точки обзора подвесная мебель не прячет ничего', () => {
    const cabinet: RoomObject = {
      id: 'c',
      kind: 'cabinet',
      x: 700,
      y: 1200,
      w: 1650,
      h: 500,
      bottomHeight: 250,
    };
    expect(coverRects([cabinet], { width: 2600, height: 1700 }, null)).toHaveLength(0);
  });

  it('та же тумба, стоящая на полу, прячет весь пол под собой', () => {
    const room2: Room = { width: 2600, height: 1700 };
    const cabinet: RoomObject = { id: 'c', kind: 'cabinet', x: 700, y: 1200, w: 1650, h: 500 };
    const [rect] = coverRects([cabinet], room2, { x: 1510, y: 0 });

    expect(rect.h).toBe(500);
  });
});

describe('выравнивание шва по краю мебели', () => {
  const step = steps(tile600, 0).x;

  it('даёт кандидата, ставящего шов на дальний край ванны', () => {
    const candidates = axisCandidates('x', room.width, 600, step, 0, [bath]);
    const aligned = candidates.filter((c) => c.id === 'alignObject');

    expect(aligned.length).toBeGreaterThan(0);
    // Край ванны на 700 мм: шов должен попасть ровно туда.
    const l = layout({ ox: aligned[0].offset });
    const tiles = buildTiles(room, tile600, l);
    expect(tiles.some((t) => t.x === 700)).toBe(true);
  });

  it('не появляется без мебели', () => {
    const candidates = axisCandidates('x', room.width, 600, step, 0, []);
    expect(candidates.every((c) => c.id !== 'alignObject')).toBe(true);
  });

  it('игнорирует грани, совпадающие со стеной', () => {
    // Ближняя грань ванны лежит на x = 0 — это уже flushStart, дубля быть не должно.
    const edges = objectEdges([bath], 'x').map((e) => e.value);
    expect(edges).toContain(0);

    const candidates = axisCandidates('x', room.width, 600, step, 0, [bath]);
    expect(candidates.filter((c) => c.offset === 0)).toHaveLength(1);
  });

  it('в названии варианта видно, по какому объекту выровнялись', () => {
    const variants = generateVariants({ room, tile: tile600, objects: [bath] });
    expect(variants.some((v) => v.title.includes('ванна'))).toBe(true);
  });
});

describe('generateVariants с мебелью', () => {
  it('отмечает скрытые плитки для отрисовки', () => {
    const variants = generateVariants({ room, tile: tile600, objects: [bath] });
    const v = variants[0];

    expect(v.hiddenTiles).toHaveLength(v.tiles.length);
    expect(v.hiddenTiles.some(Boolean)).toBe(true);
  });

  it('без мебели ничего не помечает скрытым', () => {
    const variants = generateVariants({ room, tile: tile600 });
    expect(variants[0].hiddenTiles.every((h) => !h)).toBe(true);
  });
});
