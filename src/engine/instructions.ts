import { effectiveTile } from './grid';
import type { Door, Mm, Room, Side, Tile, Variant } from './types';

/**
 * Как называется сторона помещения для человека, стоящего в дверях.
 * Плиточник размечает пол относительно стен, а не координатных осей, поэтому
 * инструкция говорит «левая стена», а не «сторона X = 0».
 */
const SIDE_NAMES: Record<Side, Record<Side, string>> = {
  // door.wall → сторона комнаты → имя
  bottom: { left: 'левой', right: 'правой', bottom: 'входной', top: 'дальней' },
  top: { left: 'правой', right: 'левой', bottom: 'дальней', top: 'входной' },
  left: { bottom: 'правой', top: 'левой', left: 'входной', right: 'дальней' },
  right: { bottom: 'левой', top: 'правой', right: 'входной', left: 'дальней' },
};

export function sideName(doorWall: Side, side: Side): string {
  return SIDE_NAMES[doorWall][side];
}

const ROW_SHIFT_TEXT: Record<string, string> = {
  none: 'шов в шов, без перевязки',
  third: 'с перевязкой в треть плитки',
  half: 'с перевязкой в половину плитки',
};

function formatCuts(sizes: Mm[]): string {
  if (sizes.length === 0) return 'целая плитка';
  if (sizes.length === 1) return `${sizes[0]} мм`;
  return sizes.join(' и ') + ' мм';
}

/**
 * Размер куска целиком, а не одна его сторона: по одному числу не понять,
 * вдоль или поперёк резали плитку.
 */
function formatPieces(sizes: Mm[], side: Side, eff: { w: Mm; h: Mm }): string {
  if (sizes.length === 0) return 'целые плитки';
  const across = side === 'left' || side === 'right';
  return sizes.map((c) => (across ? `${c}×${eff.h}` : `${eff.w}×${c}`)).join(' и ');
}

/**
 * Наряд для укладчика: две разметочные линии и список подрезок по стенам.
 *
 * Раскладка задаётся смещением сетки, но на объекте от него толку нет — там
 * отбивают линии от стен. Поэтому смещение переводится в расстояние от стены
 * до первого шва.
 */
export function buildInstructions(
  room: Room,
  tile: Tile,
  door: Door | undefined,
  variant: Variant,
): string[] {
  const wall = door?.wall ?? 'bottom';
  const eff = effectiveTile(tile, variant.layout.orientation);
  const { cuts } = variant.metrics;
  const steps: string[] = [];

  steps.push(
    `Плитка ${tile.width}×${tile.height} кладётся стороной ${eff.w} мм вдоль ` +
      `${sideName(wall, 'bottom')} стены, ${ROW_SHIFT_TEXT[variant.layout.rowShift]}. ` +
      `Шов ${tile.grout} мм.`,
  );

  // Разметка идёт по пустому помещению: сантехнику ставят уже на готовый пол,
  // поэтому все размеры — от стен, а не от будущей мебели.
  steps.push(
    'Все размеры ниже — от голых стен. Пол выкладывается целиком, в том числе под ' +
      'ванну и мебель: их ставят уже на готовую плитку.',
  );

  // Шнур бьют по краю первого целого ряда, а не по краю подрезки: между ними
  // лежит шов. Смещение сетки — это и есть расстояние от стены до целой плитки.
  const lineX = variant.layout.ox;
  const lineY = variant.layout.oy;
  const cutX = cuts.left.length > 0 ? cuts.left[0] : null;
  const cutY = cuts.bottom.length > 0 ? cuts.bottom[0] : null;

  // При перевязке подрезки вдоль стены чередуются от ряда к ряду — про это
  // нужно сказать прямо, иначе разметка по одному числу уведёт раскладку.
  const alternates = cuts.left.length > 1;

  steps.push(
    cutX === null
      ? `От ${sideName(wall, 'left')} стены кладите целую плитку вплотную, без подрезки.`
      : `Отбейте линию в ${lineX} мм от ${sideName(wall, 'left')} стены — по ней пойдёт ` +
          `край первого ряда целых плиток. Между линией и стеной ляжет подрезка ` +
          `${alternates ? formatCuts(cuts.left) : `${cutX} мм`} и шов ${tile.grout} мм.` +
          (alternates ? ' Подрезки вдоль этой стены чередуются по рядам.' : ''),
  );

  steps.push(
    cutY === null
      ? `От ${sideName(wall, 'bottom')} стены кладите целую плитку вплотную, без подрезки.`
      : `Отбейте вторую линию в ${lineY} мм от ${sideName(wall, 'bottom')} стены: ` +
          `подрезка ${cutY} мм плюс шов ${tile.grout} мм.`,
  );

  steps.push(
    'От пересечения этих линий выкладывайте целые плитки. Линии — это край плитки, ' +
      'а не середина шва: подрезки прикладываются к ним с обратной стороны.',
  );

  const sides: Side[] = ['left', 'right', 'bottom', 'top'];
  const th = variant.metrics.threshold;
  const cutList = sides
    .map((s) => {
      // У стены с дверью плитка уходит в проём: кусок длиннее подрезки в помещении.
      const through = s === wall && th?.seamless && cuts[s].length === 1;
      const size = through
        ? `${eff.w}×${th!.outerCut} (сквозной, с проёмом)`
        : formatPieces(cuts[s], s, eff);
      return `у ${sideName(wall, s)} — ${size}`;
    })
    .join('; ');
  steps.push(
    `Размеры кусков (ширина×длина, мм): ${cutList}. В углах кусок режется по обеим ` +
      `сторонам сразу.`,
  );

  if (variant.metrics.hiddenCutCount > 0) {
    steps.push(
      `${variant.metrics.hiddenCutCount} подрезок окажется под ванной и мебелью, когда их ` +
        `установят. Там точность по краю не важна — важно не сбить шов.`,
    );
  }

  if (th) {
    steps.push(
      th.seamless
        ? `У входа плитка идёт насквозь через проём, без шва на линии стены. ` +
            `Режьте её одним куском ${eff.w}×${th.outerCut} мм: ${th.outerCut} мм — это ` +
            `подрезка внутри помещения плюс глубина проёма. Внешний край — по стыку ` +
            `с соседним покрытием.`
        : `Внимание: в проёме попадает шов, самый узкий кусок ${th.narrowestPiece} мм. ` +
            `Лучше сдвинуть раскладку или выбрать другой вариант.`,
    );
  }

  steps.push(
    `Перед разметкой промерьте обе стены каждой пары: расчёт считает помещение ` +
      `идеально прямоугольным.`,
  );

  return steps;
}
