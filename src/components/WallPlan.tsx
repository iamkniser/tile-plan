'use client';

import {
  EYE_BAND,
  OBJECT_LABEL,
  wallCoverRects,
  wallOpening,
  wallSurface,
  type Door,
  type Room,
  type RoomObject,
  type Side,
  type WallVariant,
} from '@/engine';

const SIDE = 240; // поле вокруг развёртки под размерные линии, мм
const FONT = 62;

function fits(w: number, h: number, text: string): boolean {
  return w > text.length * FONT * 0.58 && h > FONT * 1.4;
}

/**
 * Развёртка стены: смотрим на стену прямо, пол снизу, потолок сверху.
 * В SVG ось Y растёт вниз, поэтому высота переворачивается при рендере.
 */
export function WallPlan({
  room,
  wall,
  variant,
  objects = [],
  door,
}: {
  room: Room;
  wall: Side;
  variant: WallVariant;
  objects?: RoomObject[];
  door?: Door;
}) {
  const surface = wallSurface(room, wall);
  const flip = (y: number, h: number) => surface.height - y - h;

  const covers = wallCoverRects(room, wall, objects);
  const opening = wallOpening(room, wall, door);

  return (
    <svg
      className="plan"
      viewBox={`${-SIDE} ${-SIDE} ${surface.width + SIDE * 2} ${surface.height + SIDE * 2}`}
      role="img"
      aria-label={`Развёртка стены: ${variant.title}`}
    >
      <rect x={0} y={0} width={surface.width} height={surface.height} className="floor" />

      {variant.tiles.map((t, i) => {
        const y = flip(t.y, t.h);
        const hidden = variant.hiddenTiles[i];
        const label = `${t.w}×${t.h}`;
        const showLabel = t.isCut && !hidden && fits(t.w, t.h, label);

        return (
          <g key={i}>
            <rect
              x={t.x}
              y={y}
              width={t.w}
              height={t.h}
              className={['tile', t.isCut ? 'tile--cut' : '', hidden ? 'tile--hidden' : '']
                .filter(Boolean)
                .join(' ')}
            />
            {showLabel && (
              <text
                x={t.x + t.w / 2}
                y={y + t.h / 2}
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

      {/* Полоса на уровне глаз: тонкая подрезка здесь читается как брак. */}
      <rect
        x={0}
        y={flip(EYE_BAND.from, EYE_BAND.to - EYE_BAND.from)}
        width={surface.width}
        height={EYE_BAND.to - EYE_BAND.from}
        className="eye-band"
      />

      {/* Предметы, закрывающие стену: ванна до борта, тумба между кромками. */}
      {covers.map((c) => (
        <g key={c.id}>
          <rect x={c.x} y={flip(c.y, c.h)} width={c.w} height={c.h} className="object" />
          <text
            x={c.x + c.w / 2}
            y={flip(c.y, c.h) + c.h / 2}
            className="object-label"
            fontSize={FONT}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {OBJECT_LABEL[c.kind]}
          </text>
        </g>
      ))}

      {opening && (
        <g>
          <rect
            x={opening.x}
            y={flip(opening.y, opening.h)}
            width={opening.w}
            height={opening.h}
            className="opening"
          />
          <text
            x={opening.x + opening.w / 2}
            y={flip(opening.y, opening.h) + opening.h / 2}
            className="door-label"
            fontSize={FONT}
            textAnchor="middle"
          >
            проём
          </text>
        </g>
      )}

      <rect x={0} y={0} width={surface.width} height={surface.height} className="wall" />

      <g className="dim">
        <line x1={0} y1={-130} x2={surface.width} y2={-130} />
        <text x={surface.width / 2} y={-164} fontSize={FONT * 1.15} textAnchor="middle">
          {surface.width}
        </text>

        <line x1={-130} y1={0} x2={-130} y2={surface.height} />
        <text
          x={-164}
          y={surface.height / 2}
          fontSize={FONT * 1.15}
          textAnchor="middle"
          transform={`rotate(-90 ${-164} ${surface.height / 2})`}
        >
          {surface.height}
        </text>
      </g>
    </svg>
  );
}
