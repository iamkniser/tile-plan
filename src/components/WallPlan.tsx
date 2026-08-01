'use client';

import { EYE_BAND, OBJECT_LABEL, type Rect, type WallCover, type WallVariant } from '@/engine';

const SIDE = 240; // поле вокруг развёртки под размерные линии, мм
const FONT = 62;

function fits(w: number, h: number, text: string): boolean {
  return w > text.length * FONT * 0.58 && h > FONT * 1.4;
}

/**
 * Контур плитки с вырезом: шесть точек буквой Г.
 *
 * Вырез может прийтись на любой из четырёх углов, поэтому контур строится от
 * фактического положения выреза, а не от заранее выбранного угла.
 */
function notchPath(
  t: {
    x: number;
    y: number;
    w: number;
    h: number;
    notch?: { x: number; y: number; w: number; h: number };
  },
  flip: (y: number, h: number) => number,
): string {
  const n = t.notch!;
  const x0 = t.x;
  const x1 = t.x + t.w;
  const y0 = t.y;
  const y1 = t.y + t.h;

  // Внутренние границы выреза — те, что не совпадают с краем плитки.
  const nx = n.x <= x0 ? n.x + n.w : n.x;
  const ny = n.y <= y0 ? n.y + n.h : n.y;
  const cornerLeft = n.x <= x0;
  const cornerBottom = n.y <= y0;

  // Обход в математических координатах, затем перевод в экранные.
  const points: Array<[number, number]> = cornerLeft
    ? cornerBottom
      ? [[nx, y0], [x1, y0], [x1, y1], [x0, y1], [x0, ny], [nx, ny]]
      : [[x0, y0], [x1, y0], [x1, y1], [nx, y1], [nx, ny], [x0, ny]]
    : cornerBottom
      ? [[x0, y0], [nx, y0], [nx, ny], [x1, ny], [x1, y1], [x0, y1]]
      : [[x0, y0], [x1, y0], [x1, ny], [nx, ny], [nx, y1], [x0, y1]];

  return (
    points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'} ${px} ${flip(py, 0)}`).join(' ') + ' Z'
  );
}

/**
 * Развёртка стены: смотрим на стену прямо, пол снизу, потолок сверху.
 * В SVG ось Y растёт вниз, поэтому высота переворачивается при рендере.
 */
export function WallPlan({
  surface,
  variant,
  covers = [],
  opening,
  showEyeBand = true,
}: {
  surface: { width: number; height: number };
  variant: WallVariant;
  covers?: WallCover[];
  opening?: Rect | null;
  /** У экрана ванны полосы глаз нет: он целиком ниже неё. */
  showEyeBand?: boolean;
}) {
  const flip = (y: number, h: number) => surface.height - y - h;

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
        // Плитку с вырезом режут буквой Г и кладут одним элементом, поэтому
        // подписываем габарит целиком и отмечаем вырез.
        const label = t.notch ? `${t.w}×${t.h} с вырезом` : `${t.w}×${t.h}`;
        const showLabel = t.isCut && !hidden && fits(t.w, t.h, label);
        const className = ['tile', t.isCut ? 'tile--cut' : '', hidden ? 'tile--hidden' : '']
          .filter(Boolean)
          .join(' ');

        return (
          <g key={i}>
            {t.notch ? (
              <path d={notchPath(t, flip)} className={className} />
            ) : (
              <rect x={t.x} y={y} width={t.w} height={t.h} className={className} />
            )}
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
      {showEyeBand && EYE_BAND.to < surface.height && (
        <rect
          x={0}
          y={flip(EYE_BAND.from, EYE_BAND.to - EYE_BAND.from)}
          width={surface.width}
          height={EYE_BAND.to - EYE_BAND.from}
          className="eye-band"
        />
      )}

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
