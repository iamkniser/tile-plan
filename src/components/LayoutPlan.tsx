'use client';

import {
  OBJECT_LABEL,
  doorRect,
  toViewRect,
  viewRoom,
  type Door,
  type Rect,
  type Room,
  type RoomObject,
  type Variant,
} from '@/engine';

const SIDE = 220; // поле по бокам и сверху под размерные линии, мм
const BELOW = 200; // место под проём и подписи входа, мм
const FONT = 62;

/** Подпись помещается, если кусок шире текста и выше строки. */
function fits(w: number, h: number, text: string): boolean {
  return w > text.length * FONT * 0.58 && h > FONT * 1.4;
}

export function LayoutPlan({
  room,
  variant,
  door,
  objects = [],
  covers = [],
}: {
  room: Room;
  variant: Variant;
  door?: Door;
  objects?: RoomObject[];
  covers?: Rect[];
}) {
  // Без двери показываем план в координатах комнаты; с дверью — так, как его видно
  // с порога: вход внизу, глубина вверх.
  const wall = door?.wall ?? 'bottom';
  const view = viewRoom(room, wall);
  const toView = (r: { x: number; y: number; w: number; h: number }) =>
    toViewRect(room, wall, r);

  // В SVG ось Y направлена вниз, а глубина от входа растёт вверх.
  const flip = (y: number, h: number) => view.height - y - h;

  const doorView = door ? toView(doorRect(room, door)) : null;
  const gazeCenter = doorView ? doorView.x + doorView.w / 2 : null;
  const threshold = door?.thresholdDepth ?? 0;
  const seamlessThreshold = variant.metrics.threshold?.seamless ?? false;

  return (
    <svg
      className="plan"
      viewBox={`${-SIDE} ${-SIDE} ${view.width + SIDE * 2} ${
        view.height + SIDE + threshold + BELOW
      }`}
      role="img"
      aria-label={`План раскладки: ${variant.title}`}
    >
      <defs>
        <clipPath id="room-clip">
          <rect x={0} y={0} width={view.width} height={view.height} />
        </clipPath>
      </defs>

      <rect x={0} y={0} width={view.width} height={view.height} className="floor" />

      {variant.tiles.map((t, i) => {
        const v = toView(t);
        const y = flip(v.y, v.h);
        // Подписываем весь размер куска, а не одну его сторону: по одному числу
        // не видно, вдоль или поперёк резали плитку. У стены с дверью кусок ещё и
        // продолжается в проём — показываем его целиком, как его будут резать.
        const throughDoor =
          seamlessThreshold && door !== undefined && t.cutSides.includes(door.wall);
        const alongY = door?.wall === 'bottom' || door?.wall === 'top';
        const label = throughDoor
          ? alongY
            ? `${t.w}×${t.h + threshold}`
            : `${t.w + threshold}×${t.h}`
          : `${t.w}×${t.h}`;
        const hidden = variant.hiddenTiles[i];
        const showLabel = t.isCut && !hidden && fits(v.w, v.h, label);

        return (
          <g key={i}>
            <rect
              x={v.x}
              y={y}
              width={v.w}
              height={v.h}
              className={[
                'tile',
                t.isCut ? 'tile--cut' : '',
                hidden ? 'tile--hidden' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            />
            {showLabel && (
              <text
                x={v.x + v.w / 2}
                y={y + v.h / 2}
                className="cut-label"
                fontSize={FONT}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}

      {/* Зона обзора: сектор ±45° от порога, внутри которого подрезки заметнее всего. */}
      {gazeCenter !== null && (
        <polygon
          className="gaze"
          clipPath="url(#room-clip)"
          points={[
            `${gazeCenter},${view.height}`,
            `${gazeCenter - view.height},0`,
            `${gazeCenter + view.height},0`,
          ].join(' ')}
        />
      )}

      {/* Пол в проёме: та же раскладка продолжается за линию стены. */}
      {variant.thresholdTiles.map((t, i) => {
        const v = toView(t);
        return (
          <rect
            key={`th-${i}`}
            x={v.x}
            y={flip(v.y, v.h)}
            width={v.w}
            height={v.h}
            className={
              // Шва на линии стены нет: плитка идёт насквозь, поэтому обводку
              // между проёмом и помещением не рисуем — иначе читается как рез.
              `tile tile--through${t.isCut ? ' tile--cut' : ''}`
            }
          />
        );
      })}

      {/* Зона, реально закрытая от взгляда: под подвесной мебелью она уже её габарита. */}
      {covers.map((c, i) => {
        const v = toView(c);
        return (
          <rect
            key={`cover-${i}`}
            x={v.x}
            y={flip(v.y, v.h)}
            width={v.w}
            height={v.h}
            className="cover-zone"
          />
        );
      })}

      {/* Мебель поверх плитки. */}
      {objects.map((o) => {
        const v = toView(o);
        const y = flip(v.y, v.h);
        return (
          <g key={o.id}>
            <rect
              x={v.x}
              y={y}
              width={v.w}
              height={v.h}
              className={o.bottomHeight ? 'object object--floating' : 'object'}
            />
            <text
              x={v.x + v.w / 2}
              y={y + v.h / 2}
              className="object-label"
              fontSize={FONT}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {OBJECT_LABEL[o.kind]}
            </text>
          </g>
        );
      })}

      <rect x={0} y={0} width={view.width} height={view.height} className="wall" />

      {/* Ось взгляда — та самая линия, которую отбивают лазером перед укладкой. */}
      {gazeCenter !== null && (
        <line
          className="axis"
          x1={gazeCenter}
          y1={view.height + threshold}
          x2={gazeCenter}
          y2={0}
        />
      )}

      {/* Проём — разрыв в стене, а не накладка поверх неё. */}
      {doorView && (
        <g>
          <rect
            x={doorView.x}
            y={view.height - 9}
            width={doorView.w}
            height={18}
            className="door-gap"
          />

          {/* Пол в проёме лежит снаружи помещения, в толще перегородки. */}
          {threshold > 0 && (
            <>
              <rect
                x={doorView.x}
                y={view.height}
                width={doorView.w}
                height={threshold}
                className="threshold-zone"
              />
              <text
                x={doorView.x + doorView.w / 2}
                y={view.height + threshold + 78}
                className="door-label"
                fontSize={FONT * 0.8}
                textAnchor="middle"
              >
                проём {threshold} мм
              </text>
            </>
          )}

          <text
            x={gazeCenter!}
            y={view.height + threshold + (threshold > 0 ? 175 : 120)}
            className="door-label"
            fontSize={FONT}
            textAnchor="middle"
          >
            вход
          </text>
        </g>
      )}

      {/* Размерные линии */}
      <g className="dim">
        <line x1={0} y1={-130} x2={view.width} y2={-130} />
        <text x={view.width / 2} y={-130 - 34} fontSize={FONT * 1.15} textAnchor="middle">
          {view.width}
        </text>

        <line x1={-130} y1={0} x2={-130} y2={view.height} />
        <text
          x={-130 - 34}
          y={view.height / 2}
          fontSize={FONT * 1.15}
          textAnchor="middle"
          transform={`rotate(-90 ${-130 - 34} ${view.height / 2})`}
        >
          {view.height}
        </text>
      </g>
    </svg>
  );
}
