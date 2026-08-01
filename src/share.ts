import type { Door, Room, Tile } from './engine';
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

/** base64url — обычный base64 ломается в адресной строке из-за + / =. */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeState(state: SharedState): string {
  return toBase64Url(JSON.stringify(state));
}

/** Возвращает null на любом мусоре: чужая ссылка не должна ронять страницу. */
export function decodeState(encoded: string): SharedState | null {
  try {
    const parsed = JSON.parse(fromBase64Url(encoded));
    if (parsed?.v !== 1) return null;
    if (!parsed.room?.width || !parsed.tile?.width || !parsed.door?.wall) return null;
    if (!Array.isArray(parsed.fixtures)) return null;
    return parsed as SharedState;
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
