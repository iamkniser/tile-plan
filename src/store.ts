'use client';

import { create } from 'zustand';
import {
  wallLength,
  type Door,
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
}

interface State {
  room: Room;
  tile: Tile;
  door: Door;
  fixtures: Fixture[];
  selectedIndex: number;
  setRoom: (patch: Partial<Room>) => void;
  setTile: (patch: Partial<Tile>) => void;
  setDoor: (patch: Partial<Door>) => void;
  setFixture: (id: string, patch: Partial<Fixture>) => void;
  select: (index: number) => void;
}

/** Габаритный прямоугольник предмета, прижатого к своей стене. */
export function fixtureObject(f: Fixture, room: Room): RoomObject | null {
  if (!f.present) return null;
  const along = Math.min(f.length, wallLength(room, f.wall));
  const across = f.depth;
  const offset = Math.max(0, Math.min(f.offset, wallLength(room, f.wall) - along));
  const base = { id: f.id, kind: f.kind, bottomHeight: f.bottomHeight };

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

export const useProject = create<State>((set) => ({
  // Стена с дверью — 2600 мм, глубина от неё — 1700 мм.
  room: { width: 2600, height: 1700 },
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
    },
  ],
  selectedIndex: 0,
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
}));
