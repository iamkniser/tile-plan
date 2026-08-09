'use client';

import { create } from 'zustand';
import {
  wallLength,
  type Door,
  type WallPoint,
  type ObjectKind,
  type Room,
  type RoomObject,
  type Side,
  type Tile,
} from './engine';

/** Предмет обстановки: стена, вдоль которой стоит, размеры и высота нижней кромки. */
export interface Fixture {
  id: string;
  kind: ObjectKind;
  present: boolean;
  wall: Side;
  /** Размер вдоль стены. */
  length: number;
  /** Выступ от стены внутрь помещения. */
  depth: number;
  /** Смещение вдоль стены от её начала. */
  offset: number;
  /** Высота нижней кромки над полом; 0 — предмет стоит на полу. */
  bottomHeight: number;
  /** Высота верхней кромки: борт ванны, верх тумбы. Нужна для раскладки стен. */
  topHeight: number;
  /** Класть ли плитку на стену за предметом. За ванной обычно не кладут. */
  tiledBehind: boolean;
}

/** Что сейчас раскладываем: пол или одна из стен. */
export type Surface = 'floor' | Side | `screen:${string}`;

/** Как лежит плитка на стенах: длинной стороной по горизонтали или вертикали. */
export type WallOrientation = 'horizontal' | 'vertical';

interface State {
  surface: Surface;
  points: WallPoint[];
  wallOrientation: WallOrientation;
  room: Room;
  tile: Tile;
  door: Door;
  fixtures: Fixture[];
  selectedIndex: number;
  setSurface: (surface: Surface) => void;
  setWallOrientation: (o: WallOrientation) => void;
  setPoint: (id: string, patch: Partial<WallPoint>) => void;
  setRoom: (patch: Partial<Room>) => void;
  setTile: (patch: Partial<Tile>) => void;
  setDoor: (patch: Partial<Door>) => void;
  setFixture: (id: string, patch: Partial<Fixture>) => void;
  select: (index: number) => void;
  /** Применить состояние из ссылки или прошлого сеанса. */
  restore: (state: { room: Room; tile: Tile; door: Door; fixtures: Fixture[] }) => void;
  /** Вернуться к значениям по умолчанию. */
  reset: () => void;
}

/** Габаритный прямоугольник предмета, прижатого к своей стене. */
export function fixtureObject(f: Fixture, room: Room): RoomObject | null {
  if (!f.present) return null;
  const along = Math.min(f.length, wallLength(room, f.wall));
  const across = f.depth;
  const offset = Math.max(0, Math.min(f.offset, wallLength(room, f.wall) - along));
  const base = {
    id: f.id,
    kind: f.kind,
    bottomHeight: f.bottomHeight,
    topHeight: f.topHeight,
    tiledBehind: f.tiledBehind,
  };

  switch (f.wall) {
    case 'left':
      return { ...base, x: 0, y: offset, w: across, h: along };
    case 'right':
      return { ...base, x: room.width - across, y: offset, w: across, h: along };
    case 'bottom':
      return { ...base, x: offset, y: 0, w: along, h: across };
    case 'top':
      return { ...base, x: offset, y: room.height - across, w: along, h: across };
  }
}

export function fixtureObjects(fixtures: Fixture[], room: Room): RoomObject[] {
  return fixtures
    .map((f) => fixtureObject(f, room))
    .filter((o): o is RoomObject => o !== null);
}

/** Проём не должен выходить за стену: ширину и смещение зажимаем по её длине. */
function clampDoor(door: Door, room: Room): Door {
  const wall = wallLength(room, door.wall);
  const width = Math.min(door.width, wall);
  return { ...door, width, offset: Math.max(0, Math.min(door.offset, wall - width)) };
}

/** Значения по умолчанию: к ним возвращает сброс. */
export const DEFAULTS: {
  room: Room;
  tile: Tile;
  door: Door;
  fixtures: Fixture[];
  points: WallPoint[];
} = {
  // Стена с дверью — 2600 мм, глубина от неё — 1700 мм, потолок 3000 мм.
  room: { width: 2600, height: 1700, ceiling: 3000 },
  tile: { width: 1200, height: 600, grout: 2 },
  // Проём 900 мм: 1060 мм от левого угла, 640 мм до правого.
  // Глубина проёма 150 мм — толщина перегородки; плитка продолжается туда.
  door: { wall: 'bottom', offset: 1060, width: 900, thresholdDepth: 150 },
  // Ванна 1700×700 вдоль левой стены, во всю её длину.
  fixtures: [
    // Ванна 1700×700 вдоль левой стены, во всю её длину.
    {
      id: 'bath',
      kind: 'bath',
      present: true,
      wall: 'left',
      length: 1700,
      depth: 700,
      offset: 0,
      bottomHeight: 0,
      // Борт ванны — сильная горизонтальная линия, с ней совмещают шов.
      topHeight: 600,
      // За ванной стену не облицовывают: плитка начинается от борта.
      tiledBehind: false,
    },
    // Подвесная тумба у дальней стены: от края ванны до правой стены,
    // нижняя кромка на 250 мм, верхняя — на 800 мм.
    {
      id: 'cabinet',
      kind: 'cabinet',
      present: true,
      wall: 'top',
      length: 1900,
      depth: 500,
      offset: 700,
      bottomHeight: 250,
      topHeight: 800,
      tiledBehind: true,
    },
    // Подвесной унитаз у правой стены. Фальш-стена инсталляции уже входит
    // в габарит помещения, поэтому отдельным объектом не задаётся.
    {
      id: 'toilet',
      kind: 'toilet',
      present: true,
      wall: 'right',
      length: 380,
      depth: 540,
      offset: 330,
      bottomHeight: 400,
      topHeight: 400,
      tiledBehind: true,
    },
  ],
  // Отверстия под выводы не должны попадать на шов.
  points: [
    { id: 'mixer', wall: 'left', along: 850, height: 1100, size: 70, label: 'смеситель' },
    // Гусак на торце ванны: дальняя стена, середина её стороны 700 мм.
    { id: 'spout', wall: 'top', along: 350, height: 800, size: 70, label: 'гусак' },
  ],
};

export const useProject = create<State>((set) => ({
  ...structuredClone(DEFAULTS),
  surface: 'floor',
  wallOrientation: 'horizontal',
  selectedIndex: 0,
  setSurface: (surface) => set({ surface, selectedIndex: 0 }),
  setWallOrientation: (wallOrientation) => set({ wallOrientation, selectedIndex: 0 }),
  setPoint: (id, patch) =>
    set((s) => ({
      points: s.points.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      selectedIndex: 0,
    })),
  setRoom: (patch) =>
    set((s) => {
      const room = { ...s.room, ...patch };
      return { room, door: clampDoor(s.door, room), selectedIndex: 0 };
    }),
  setTile: (patch) => set((s) => ({ tile: { ...s.tile, ...patch }, selectedIndex: 0 })),
  setDoor: (patch) =>
    set((s) => ({ door: clampDoor({ ...s.door, ...patch }, s.room), selectedIndex: 0 })),
  setFixture: (id, patch) =>
    set((s) => ({
      fixtures: s.fixtures.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      selectedIndex: 0,
    })),
  select: (index) => set({ selectedIndex: index }),
  restore: (state) => set({ ...state, selectedIndex: 0 }),
  reset: () => set({ ...structuredClone(DEFAULTS), selectedIndex: 0 }),
}));
