import type { Door, ObjectKind, Room, Side, Tile } from './engine';
import type { Fixture } from './store';

/**
 * Переносимое состояние проекта.
 *
 * Версия нужна, чтобы старая ссылка не развалила приложение после изменения
 * формата: неизвестную версию просто игнорируем и берём значения по умолчанию.
 */
export interface SharedState {
  v: 1;
  room: Room;
  tile: Tile;
  door: Door;
  fixtures: Fixture[];
}

const STORAGE_KEY = 'tile-plan:project';
const URL_KEY = 'p';

/**
 * Формат ссылки: позиционный список значений через точку.
 *
 * JSON в base64 давал больше 600 символов на пустяковый проект — такую ссылку
 * мессенджеры обрезают. Здесь те же данные укладываются в сотню символов,
 * причём без base64: строка и так безопасна для адреса.
 */
const VERSION = 3;

const DEFAULT_CEILING = 2500;

/** Высоты предметов по умолчанию: ими достраиваются ссылки прежних версий. */
const DEFAULT_TOP: Record<ObjectKind, number> = {
  bath: 600,
  cabinet: 800,
  installation: 400,
  washer: 850,
  toilet: 400,
  sink: 850,
};

const WALL_CODES: Record<Side, string> = {
  bottom: 'b',
  top: 't',
  left: 'l',
  right: 'r',
};

const KIND_CODES: Record<ObjectKind, string> = {
  bath: 'b',
  cabinet: 'c',
  installation: 'i',
  washer: 'w',
  toilet: 't',
  sink: 's',
};

function decodeFrom<T extends string>(codes: Record<T, string>, code: string): T | null {
  const found = (Object.keys(codes) as T[]).find((key) => codes[key] === code);
  return found ?? null;
}

export function encodeState(state: SharedState): string {
  const { room, tile, door, fixtures } = state;
  const parts: (string | number)[] = [
    VERSION,
    room.width,
    room.height,
    tile.width,
    tile.height,
    tile.grout,
    WALL_CODES[door.wall],
    door.offset,
    door.width,
    door.thresholdDepth ?? 0,
    room.ceiling ?? DEFAULT_CEILING,
  ];

  for (const f of fixtures) {
    parts.push(
      KIND_CODES[f.kind],
      f.present ? 1 : 0,
      WALL_CODES[f.wall],
      f.length,
      f.depth,
      f.offset,
      f.bottomHeight,
      f.topHeight,
    );
  }

  return parts.join('.');
}

const HEAD_FIELDS = 11;
const FIXTURE_FIELDS = 8;

/** Возвращает null на любом мусоре: чужая ссылка не должна ронять страницу. */
export function decodeState(encoded: string): SharedState | null {
  const parts = encoded.split('.');
  const version = Number(parts[0]);

  // Второй версии не хватало высоты потолка и высот предметов: читаем её той же
  // разборкой, недостающее достраиваем — иначе уже разосланные ссылки протухнут.
  if (version === 2 && parts.length >= 10) return decodeCompact(parts, 10, 7);
  if (version === VERSION && parts.length >= HEAD_FIELDS) {
    return decodeCompact(parts, HEAD_FIELDS, FIXTURE_FIELDS);
  }
  return legacyDecode(encoded);
}

function decodeCompact(parts: string[], headFields: number, fixtureFields: number): SharedState | null {

  const num = (i: number): number | null => {
    const value = Number(parts[i]);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };

  const [width, height, tileW, tileH, grout] = [num(1), num(2), num(3), num(4), num(5)];
  const doorWall = decodeFrom(WALL_CODES, parts[6]);
  const [doorOffset, doorWidth, threshold] = [num(7), num(8), num(9)];
  // В версии 2 высоты потолка в ссылке не было.
  const ceiling = headFields > 10 ? num(10) : DEFAULT_CEILING;

  if (
    width === null || height === null || tileW === null || tileH === null ||
    grout === null || doorWall === null || doorOffset === null || doorWidth === null ||
    threshold === null || ceiling === null ||
    width === 0 || height === 0 || tileW === 0 || tileH === 0
  ) {
    return null;
  }

  const fixtures: Fixture[] = [];
  for (let i = headFields; i + fixtureFields <= parts.length; i += fixtureFields) {
    const kind = decodeFrom(KIND_CODES, parts[i]);
    const wall = decodeFrom(WALL_CODES, parts[i + 2]);
    if (kind === null || wall === null) return null;

    const values = [num(i + 3), num(i + 4), num(i + 5), num(i + 6)];
    if (values.some((v) => v === null)) return null;
    const top = fixtureFields > 7 ? num(i + 7) : null;

    fixtures.push({
      id: kind,
      kind,
      present: parts[i + 1] === '1',
      wall,
      length: values[0]!,
      depth: values[1]!,
      offset: values[2]!,
      bottomHeight: values[3]!,
      topHeight: top ?? DEFAULT_TOP[kind],
    });
  }

  return {
    v: 1,
    room: { width, height, ceiling },
    tile: { width: tileW, height: tileH, grout },
    door: { wall: doorWall, offset: doorOffset, width: doorWidth, thresholdDepth: threshold },
    fixtures,
  };
}

/** Ссылки первой версии — JSON в base64url. Поддерживаем, чтобы они не протухли. */
function legacyDecode(encoded: string): SharedState | null {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));

    if (parsed?.v !== 1) return null;
    if (!parsed.room?.width || !parsed.tile?.width || !parsed.door?.wall) return null;
    if (!Array.isArray(parsed.fixtures)) return null;

    const state = parsed as SharedState;
    return {
      ...state,
      room: { ...state.room, ceiling: state.room.ceiling ?? DEFAULT_CEILING },
      fixtures: state.fixtures.map((f) => ({
        ...f,
        topHeight: f.topHeight ?? DEFAULT_TOP[f.kind],
      })),
    };
  } catch {
    return null;
  }
}

/** Ссылка на текущий проект — состояние целиком лежит в самом адресе. */
export function shareUrl(state: SharedState): string {
  const url = new URL(window.location.href);
  url.searchParams.set(URL_KEY, encodeState(state));
  return url.toString();
}

/**
 * Состояние при запуске: сначала ссылка (её прислали намеренно),
 * затем последний сеанс из хранилища.
 */
export function loadState(): SharedState | null {
  if (typeof window === 'undefined') return null;

  const fromUrl = new URLSearchParams(window.location.search).get(URL_KEY);
  if (fromUrl) {
    const state = decodeState(fromUrl);
    if (state) return state;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? decodeState(stored) : null;
  } catch {
    return null; // приватный режим или запрет хранилища
  }
}

export function saveState(state: SharedState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, encodeState(state));
  } catch {
    // Хранилище недоступно — приложение работает, просто не помнит прошлый сеанс.
  }
}
