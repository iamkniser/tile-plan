/**
 * Базовые типы геометрического движка.
 *
 * Все линейные величины — целые миллиметры (SPEC.md §2). Начало координат —
 * левый нижний угол комнаты, X вправо, Y вверх. SVG инвертирует Y при рендере.
 */

/** Целое число миллиметров. */
export type Mm = number;

export interface Room {
  /** Размер по X. */
  width: Mm;
  /** Размер по Y. */
  height: Mm;
  /** Высота помещения. Нужна только для раскладки стен. */
  ceiling?: Mm;
}

export interface Tile {
  width: Mm;
  height: Mm;
  /** Ширина шва между плитками. */
  grout: Mm;
}

/** Поворот плитки относительно осей комнаты. */
export type Orientation = 0 | 90;

/** Смещение соседних рядов, в долях шага сетки по X. */
export type RowShift = 'none' | 'third' | 'half';

export const ROW_SHIFT_VALUE: Record<RowShift, number> = {
  none: 0,
  third: 1 / 3,
  half: 1 / 2,
};

/** Идентификаторы одномерных стратегий выбора смещения сетки (SPEC.md §5). */
export type StrategyId =
  | 'centerTileEntry'
  | 'centerJointEntry'
  | 'centerTile'
  | 'centerJoint'
  | 'alignObject'
  | 'flushStart'
  | 'flushEnd';

export type ObjectKind =
  | 'bath'
  | 'cabinet'
  | 'installation'
  | 'washer'
  | 'toilet'
  | 'sink';

/**
 * Класс объекта по отношению к полу:
 * `covers` — закрывает пол собой, подрезки под ним не видны;
 * `stands` — стоит на полу, пол вокруг остаётся видимым.
 */
export type ObjectClass = 'covers' | 'stands';

export const OBJECT_CLASS: Record<ObjectKind, ObjectClass> = {
  bath: 'covers',
  cabinet: 'covers',
  installation: 'covers',
  washer: 'covers',
  toilet: 'stands',
  sink: 'stands',
};

export const OBJECT_LABEL: Record<ObjectKind, string> = {
  bath: 'ванна',
  cabinet: 'тумба',
  installation: 'инсталляция',
  washer: 'стиральная машина',
  toilet: 'унитаз',
  sink: 'раковина',
};

/** Объект на полу, заданный габаритным прямоугольником. */
export interface RoomObject {
  id: string;
  kind: ObjectKind;
  x: Mm;
  y: Mm;
  w: Mm;
  h: Mm;
  /**
   * Высота нижней кромки над полом. У предмета, стоящего на полу, — 0: он прячет
   * всё под собой. У подвесного часть пола просматривается под кромкой, и чем
   * она выше, тем глубже видно.
   */
  bottomHeight?: Mm;
  /**
   * Высота верхней кромки. На полу не используется, а на стене задаёт полосу,
   * которую предмет закрывает: борт ванны, верх тумбы, экран инсталляции.
   */
  topHeight?: Mm;
}

/** Крупная мебель, грани которой имеет смысл совмещать со швом. */
const FURNITURE: ObjectKind[] = ['bath', 'cabinet', 'installation', 'washer'];

export function isFurniture(o: RoomObject): boolean {
  return FURNITURE.includes(o.kind);
}

/** Может ли объект в принципе прятать пол под собой. */
export function isCovering(o: RoomObject): boolean {
  return OBJECT_CLASS[o.kind] === 'covers';
}

/** Вариант раскладки полностью описывается четырьмя числами (SPEC.md §4). */
export interface Layout {
  /** Смещение сетки по X, нормализовано в [0, stepX). */
  ox: Mm;
  /** Смещение сетки по Y, нормализовано в [0, stepY). */
  oy: Mm;
  orientation: Orientation;
  rowShift: RowShift;
}

/** Одна плитка на плане, уже обрезанная по границам комнаты. */
export interface PlacedTile {
  /** Видимый прямоугольник внутри комнаты. */
  x: Mm;
  y: Mm;
  w: Mm;
  h: Mm;
  /** Индекс ряда (по Y) и позиции в ряду (по X); нужны для отладки и рендера. */
  row: number;
  col: number;
  /** Обрезана ли плитка хотя бы по одной стороне. */
  isCut: boolean;
  /** По каким сторонам комнаты плитка прилегает и обрезана. */
  cutSides: Side[];
}

export type Side = 'left' | 'right' | 'bottom' | 'top';

/** Дверной проём: стена, смещение вдоль неё от начала и ширина проёма. */
export interface Door {
  wall: Side;
  offset: Mm;
  width: Mm;
  /**
   * Глубина проёма — толщина перегородки. Пол в проёме продолжает основную
   * раскладку и добавляется к площади помещения: отдельной вставкой порог не
   * набирают, это заметный узкий кусок в самом просматриваемом месте.
   */
  thresholdDepth?: Mm;
}

/**
 * Оценка пола в дверном проёме. Это самая просматриваемая полоса в помещении:
 * на неё смотрят сверху вниз при каждом входе.
 */
export interface ThresholdMetrics {
  /** Проходит ли плитка сквозь проём без шва — так порог и должен выглядеть. */
  seamless: boolean;
  /** Размер подрезки на внешней линии проёма, у стыка с соседним покрытием. */
  outerCut: Mm;
  /** Ширина самого узкого куска в проёме. */
  narrowestPiece: Mm;
}

/** Оценка раскладки с точки зрения человека, входящего в дверь (SPEC.md §6). */
export interface EntryMetrics {
  /**
   * Отклонение раскладки от симметрии относительно оси двери, мм.
   * Ноль — на оси взгляда лежит либо шов, либо центр плитки.
   */
  asymmetry: Mm;
  /** Минимальная подрезка внутри зоны обзора; равна размеру плитки, если подрезок там нет. */
  minCut: Mm;
  /** Число подрезанных плиток в зоне обзора. */
  cutTileCount: number;
}

export interface Metrics {
  /** Минимальная подрезка по всему периметру. */
  minCut: Mm;
  /** Количество подрезанных плиток. */
  cutTileCount: number;
  /** Количество целых плиток. */
  wholeTileCount: number;
  /** |средняя подрезка слева − средняя подрезка справа|. */
  asymmetryX: Mm;
  /** |средняя подрезка снизу − средняя подрезка сверху|. */
  asymmetryY: Mm;
  /** Площадь отхода: срезанная часть подрезанных плиток. */
  wasteArea: number;
  /** Подрезки вдоль каждой стены, уникальные значения по возрастанию. */
  cuts: Record<Side, Mm[]>;
  /** Минимальная подрезка, не закрытая мебелью; равна `minCut`, если объектов нет. */
  minVisibleCut: Mm;
  /** Сколько подрезанных плиток спрятано под мебелью. */
  hiddenCutCount: number;
  /** Оценка от входа; отсутствует, если дверь не задана. */
  entry?: EntryMetrics;
  /** Оценка пола в проёме; отсутствует, если глубина проёма не задана. */
  threshold?: ThresholdMetrics;
}

export interface Variant {
  layout: Layout;
  /** Стратегии, породившие смещения по каждой оси. */
  strategyX: StrategyId;
  strategyY: StrategyId;
  /** Плитки, полностью скрытые мебелью: на плане показываются приглушённо. */
  hiddenTiles: boolean[];
  /** Человеческое название варианта. */
  title: string;
  tiles: PlacedTile[];
  /** Плитки в дверном проёме, за пределами прямоугольника помещения. */
  thresholdTiles: PlacedTile[];
  metrics: Metrics;
}

/** Оценка раскладки одной стены. */
export interface WallMetrics {
  minCut: Mm;
  /** Минимальная подрезка, не закрытая ни мебелью, ни проёмом. */
  minVisibleCut: Mm;
  /** Самая мелкая подрезка на уровне глаз — там она читается как брак. */
  eyeLevelCut: Mm;
  cutTileCount: number;
  wholeTileCount: number;
  hiddenCutCount: number;
  cuts: Record<Side, Mm[]>;
  /** С какой кромкой предмета совпал горизонтальный шов и насколько точно. */
  edgeAlignment: { kind: ObjectKind; offset: Mm } | null;
  /** Расхождение ближайшего вертикального шва стены со швом пола. */
  floorJointOffset: Mm;
}

export interface WallVariant {
  wall: Side;
  layout: Layout;
  title: string;
  tiles: PlacedTile[];
  hiddenTiles: boolean[];
  metrics: WallMetrics;
}

export interface Project {
  room: Room;
  tile: Tile;
  door?: Door;
  objects?: RoomObject[];
}
