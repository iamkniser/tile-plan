import type { Mm, Variant } from './types';

/**
 * Объяснение варианта: чем он хорош и чем платит за это.
 *
 * Всё выводится из уже посчитанных метрик правилами с порогами — никакой модели
 * здесь не нужно, сравнение вариантов это арифметика, а не языковая задача.
 * Каждую фразу можно оспорить числом, которое стоит рядом на чертеже.
 */
export interface Rationale {
  pros: string[];
  cons: string[];
  /** Чем пришлось пожертвовать ради этого варианта, если жертва есть. */
  tradeoff: string | null;
}

/** Расхождение до этого значения на глаз не читается. */
const SYMMETRY_TOLERANCE: Mm = 5;

/** Подрезка от этого размера уже не бросается в глаза. */
const COMFORTABLE_CUT: Mm = 300;

/** Подрезка мельче этого в поле зрения читается как ошибка укладки. */
const NARROW_CUT: Mm = 150;

/**
 * Подрезка мельче этого держится на клею плохо. Под мебелью такая допускается
 * (отсев в `rejectImpractical`, SPEC.md §8б), но о ней надо предупредить: именно
 * в этот ряд собирается вся погрешность помещения.
 */
const FRAGILE_CUT: Mm = 50;

/** Склонение существительного при числе: 1 плитку, 2 плитки, 5 плиток. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function best<T>(items: T[], value: (item: T) => number): T | undefined {
  return items.reduce<T | undefined>(
    (a, b) => (a === undefined || value(b) < value(a) ? b : a),
    undefined,
  );
}

export function buildRationale(variant: Variant, alternatives: Variant[]): Rationale {
  const m = variant.metrics;
  const pros: string[] = [];
  const cons: string[] = [];

  if (m.entry) {
    const dev = Math.round(m.entry.asymmetry);
    if (dev === 0) {
      pros.push('Раскладка точно симметрична относительно входа: на ось взгляда попадает шов или центр плитки.');
    } else if (dev <= SYMMETRY_TOLERANCE) {
      pros.push(`Раскладка симметрична относительно входа — отклонение ${dev} мм, на глаз не читается.`);
    } else {
      cons.push(`Относительно входа раскладка сбита на ${dev} мм.`);
    }

    if (m.entry.minCut >= COMFORTABLE_CUT) {
      pros.push(`В поле зрения от порога нет узких подрезок: самая мелкая — ${m.entry.minCut} мм.`);
    } else if (m.entry.minCut < NARROW_CUT) {
      cons.push(`Прямо по курсу от входа видна подрезка ${m.entry.minCut} мм.`);
    }
  }

  if (m.hiddenCutCount > 0) {
    pros.push(
      `${m.hiddenCutCount} ${plural(m.hiddenCutCount, 'подрезка уходит', 'подрезки уходят', 'подрезок уходит')} ` +
        `под ванну и мебель — их не будет видно после установки.`,
    );
  }

  // Тонкий ряд, спрятанный под мебелью, — сознательный приём, но он же и есть
  // тот ряд, который добирает разницу между проектом и фактом. Запаса у него нет.
  if (m.minCut < FRAGILE_CUT && m.minCut < m.minVisibleCut) {
    cons.push(
      `Самый узкий ряд — ${m.minCut} мм; его не видно под мебелью, но в него собирается ` +
        `вся погрешность помещения: промерьте по факту, иначе ряд может не сойтись.`,
    );
  }

  if (m.minVisibleCut >= COMFORTABLE_CUT) {
    pros.push(`Самая мелкая открытая подрезка — ${m.minVisibleCut} мм, это почти целая плитка.`);
  } else if (m.minVisibleCut < NARROW_CUT) {
    cons.push(`Открытая подрезка ${m.minVisibleCut} мм заметна.`);
  }

  if (m.threshold) {
    if (m.threshold.seamless) {
      pros.push('В дверном проёме плитка идёт насквозь, без шва на линии стены.');
    } else {
      cons.push(
        `В проёме попадает шов, самый узкий кусок ${m.threshold.narrowestPiece} мм — это видно с порога.`,
      );
    }
  }

  // Сравнение с самым экономным по резке вариантом: это главный компромисс,
  // который пользователь иначе не заметит.
  const others = alternatives.filter((v) => v !== variant);
  const leanest = best(others, (v) => v.metrics.cutTileCount);
  let tradeoff: string | null = null;

  if (leanest && leanest.metrics.cutTileCount < m.cutTileCount) {
    const diff = m.cutTileCount - leanest.metrics.cutTileCount;
    const theirDev = leanest.metrics.entry ? Math.round(leanest.metrics.entry.asymmetry) : null;
    const ourDev = m.entry ? Math.round(m.entry.asymmetry) : null;

    const tiles = plural(diff, 'плитку', 'плитки', 'плиток');
    tradeoff =
      theirDev !== null && ourDev !== null && theirDev > ourDev
        ? `Резать на ${diff} ${tiles} больше, чем у варианта «${leanest.title}»: тот проще ` +
          `в работе, но сбивает симметрию от входа на ${theirDev} мм против ${ourDev}.`
        : `Резать на ${diff} ${tiles} больше, чем у варианта «${leanest.title}».`;
  } else if (leanest && m.cutTileCount <= leanest.metrics.cutTileCount) {
    pros.push(
      `Меньше всего резов среди вариантов — ${m.cutTileCount} ` +
        `${plural(m.cutTileCount, 'плитка', 'плитки', 'плиток')}.`,
    );
  }

  return { pros: pros.slice(0, 4), cons: cons.slice(0, 3), tradeoff };
}
