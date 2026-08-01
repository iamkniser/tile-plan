'use client';

import { useEffect, useMemo, useState } from 'react';
import { LayoutPlan } from '@/components/LayoutPlan';
import {
  OBJECT_LABEL,
  buildInstructions,
  buildRationale,
  coverRects,
  generateVariants,
  rejectImpractical,
  rowShiftOptions,
  viewerPoint,
  wallLength,
  type Side,
  type Variant,
} from '@/engine';
import { fixtureObjects, useProject } from '@/store';
import { loadState, saveState, shareUrl } from '@/share';

const MAX_VARIANTS = 12;
const ROW_SHIFT_LABEL: Record<string, string> = {
  none: 'без смещения',
  third: 'смещение 1/3',
  half: 'смещение 1/2',
};
const WALL_LABEL: Record<Side, string> = {
  bottom: 'нижняя',
  top: 'верхняя',
  left: 'левая',
  right: 'правая',
};

/**
 * Порядок: сначала симметрия относительно оси взгляда, затем крупная видимая
 * подрезка, затем меньше резаных плиток. Симметрия округляется до 5 мм — разница
 * меньше этого на глаз не читается и не должна решать порядок.
 * Режимы оптимизации появятся отдельно (SPEC.md §7).
 */
function rank(a: Variant, b: Variant): number {
  const ea = a.metrics.entry;
  const eb = b.metrics.entry;
  if (ea && eb) {
    return (
      Math.round(ea.asymmetry / SYMMETRY_TOLERANCE) -
        Math.round(eb.asymmetry / SYMMETRY_TOLERANCE) ||
      eb.minCut - ea.minCut ||
      a.metrics.cutTileCount - b.metrics.cutTileCount
    );
  }
  return (
    b.metrics.minVisibleCut - a.metrics.minVisibleCut ||
    a.metrics.cutTileCount - b.metrics.cutTileCount
  );
}

/** Расхождение меньше этого на глаз не читается — тем же порогом группируем в rank(). */
const SYMMETRY_TOLERANCE = 5;

function symmetryText(deviation: number): string {
  const mm = Math.round(deviation);
  if (mm === 0) return 'точная';
  if (mm <= SYMMETRY_TOLERANCE) return `практически точная (${mm} мм)`;
  return `сбита на ${mm} мм`;
}

function NumberField({
  label,
  value,
  onChange,
  min = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        step={1}
        onChange={(e) => {
          const v = Math.round(Number(e.target.value));
          if (Number.isFinite(v) && v >= min) onChange(v);
        }}
      />
    </label>
  );
}

export default function Page() {
  const {
    room,
    tile,
    door,
    fixtures,
    selectedIndex,
    setRoom,
    setTile,
    setDoor,
    setFixture,
    select,
    restore,
    reset,
  } = useProject();

  // На телефоне форма заняла бы весь первый экран, поэтому там она свёрнута,
  // а на широком экране открыта сразу.
  const [paramsOpen, setParamsOpen] = useState(true);
  useEffect(() => {
    setParamsOpen(window.matchMedia('(min-width: 901px)').matches);
  }, []);

  // Состояние восстанавливаем после монтирования: на сервере ни ссылки,
  // ни хранилища нет, и разметка разошлась бы с клиентской.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const saved = loadState();
    if (saved) restore(saved);
    setRestored(true);
  }, [restore]);

  useEffect(() => {
    if (restored) saveState({ v: 1, room, tile, door, fixtures });
  }, [restored, room, tile, door, fixtures]);

  // Сброс стирает введённые размеры, поэтому спрашиваем второй раз — но без
  // блокирующего диалога: кнопка сама превращается в подтверждение.
  const [confirmReset, setConfirmReset] = useState(false);
  function resetAll() {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    setConfirmReset(false);
    reset();
    // Иначе состояние из адреса вернётся при следующей загрузке.
    window.history.replaceState(null, '', window.location.pathname);
  }

  const [copied, setCopied] = useState(false);
  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl({ v: 1, room, tile, door, fixtures }));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const objects = useMemo(() => fixtureObjects(fixtures, room), [fixtures, room]);
  // Зоны, реально закрытые от взгляда: под подвесной мебелью пол просматривается.
  const covers = useMemo(
    () => coverRects(objects, room, viewerPoint(room, door)),
    [objects, room, door],
  );

  const { variants, rejections } = useMemo(() => {
    const { kept, rejections } = rejectImpractical(generateVariants({ room, tile, door, objects }));
    const all = kept.sort(rank);
    const top = all.slice(0, MAX_VARIANTS);

    // Выравнивание шва по краю мебели — приём, который пользователь вряд ли
    // придумает сам, поэтому лучший такой вариант показываем всегда, даже если
    // по общему рангу он не попал в список.
    const aligned = all.find((v) => v.strategyX === 'alignObject' || v.strategyY === 'alignObject');
    if (aligned && !top.includes(aligned)) {
      top[top.length - 1] = aligned;
      top.sort(rank);
    }

    return { variants: top, rejections };
  }, [room, tile, door, objects]);
  const selected = variants[Math.min(selectedIndex, variants.length - 1)];

  const halfBlocked = rowShiftOptions(tile).find((o) => o.id === 'half')!;
  const rationale = useMemo(() => buildRationale(selected, variants), [selected, variants]);

  const total = selected.tiles.length;
  const area = (room.width * room.height) / 1_000_000;

  return (
    <main>
      <header className="stamp">
        <h1>TileLayout</h1>
        <span className="stamp__spec">
          пол {room.width}×{room.height} · плитка {tile.width}×{tile.height} · шов {tile.grout}
        </span>
        <button type="button" className="link stamp__share" onClick={copyLink}>
          {copied ? 'ссылка скопирована' : 'скопировать ссылку'}
        </button>
        <p className="lead">
          Откуда начинать раскладку и где окажутся подрезки. Вид от порога.
        </p>
      </header>

      <details className="params" open={paramsOpen}>
        <summary onClick={(e) => { e.preventDefault(); setParamsOpen((v) => !v); }}>
          Параметры помещения
        </summary>
        <section className="controls">
        <fieldset>
          <legend>Помещение, мм</legend>
          <NumberField label="Ширина" value={room.width} onChange={(v) => setRoom({ width: v })} />
          <NumberField label="Длина" value={room.height} onChange={(v) => setRoom({ height: v })} />
        </fieldset>

        <fieldset>
          <legend>Плитка, мм</legend>
          <NumberField label="Ширина" value={tile.width} onChange={(v) => setTile({ width: v })} />
          <NumberField label="Длина" value={tile.height} onChange={(v) => setTile({ height: v })} />
          <NumberField label="Шов" value={tile.grout} onChange={(v) => setTile({ grout: v })} min={0} />
        </fieldset>

        <fieldset>
          <legend>Вход</legend>
          <label className="field">
            <span>Стена</span>
            <select
              value={door.wall}
              onChange={(e) => setDoor({ wall: e.target.value as Side })}
            >
              {(Object.keys(WALL_LABEL) as Side[]).map((w) => (
                <option key={w} value={w}>
                  {WALL_LABEL[w]}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Отступ от угла"
            value={door.offset}
            onChange={(v) => setDoor({ offset: v })}
            min={0}
          />
          <NumberField
            label="Ширина проёма"
            value={door.width}
            onChange={(v) => setDoor({ width: v })}
          />
          <NumberField
            label="Глубина проёма"
            value={door.thresholdDepth ?? 0}
            onChange={(v) => setDoor({ thresholdDepth: v })}
            min={0}
          />
          <button
            type="button"
            className="link"
            onClick={() =>
              setDoor({ offset: Math.round((wallLength(room, door.wall) - door.width) / 2) })
            }
          >
            по центру стены
          </button>
        </fieldset>

        {fixtures.map((f) => (
          <fieldset key={f.id}>
            <legend>{OBJECT_LABEL[f.kind]}</legend>
            <label className="field field--check">
              <span>Есть</span>
              <input
                type="checkbox"
                checked={f.present}
                onChange={(e) => setFixture(f.id, { present: e.target.checked })}
              />
            </label>
            {f.present && (
              <>
                <label className="field">
                  <span>Стена</span>
                  <select
                    value={f.wall}
                    onChange={(e) => setFixture(f.id, { wall: e.target.value as Side })}
                  >
                    {(Object.keys(WALL_LABEL) as Side[]).map((w) => (
                      <option key={w} value={w}>
                        {WALL_LABEL[w]}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberField
                  label="Длина"
                  value={f.length}
                  onChange={(v) => setFixture(f.id, { length: v })}
                />
                <NumberField
                  label="Глубина"
                  value={f.depth}
                  onChange={(v) => setFixture(f.id, { depth: v })}
                />
                <NumberField
                  label="Отступ от угла"
                  value={f.offset}
                  onChange={(v) => setFixture(f.id, { offset: v })}
                  min={0}
                />
                <NumberField
                  label="Низ над полом"
                  value={f.bottomHeight}
                  onChange={(v) => setFixture(f.id, { bottomHeight: v })}
                  min={0}
                />
              </>
            )}
          </fieldset>
        ))}

          <button
            type="button"
            className={confirmReset ? 'link link--warn' : 'link'}
            onClick={resetAll}
          >
            {confirmReset ? 'подтвердить сброс' : 'вернуть исходные размеры'}
          </button>
        </section>
      </details>

      <section className="workspace">
        <div className="plan-col">
          <div className="plan-sticky">
          <div className="plan-head">
            <span className="rank">№{selectedIndex + 1}</span>
            <h2>{selected.title}</h2>
            <span className="tags">
              {selected.layout.orientation === 90 && <span className="tag">плитка повёрнута</span>}
              <span className="tag">{ROW_SHIFT_LABEL[selected.layout.rowShift]}</span>
            </span>
          </div>

          <LayoutPlan
            room={room}
            variant={selected}
            door={door}
            objects={objects}
            covers={covers}
          />
          </div>

        </div>

        <div className="variants-pane">
          <div className="variants-head">
            <h2>Варианты</h2>
            <span className="count">{variants.length}</span>
          </div>

          {!halfBlocked.allowed && <p className="notice">{halfBlocked.reason}</p>}

          {rejections.length > 0 && (
            <ul className="rejections">
              {rejections.map((r) => (
                <li key={r.reason}>
                  отсеяно {r.count} — {r.reason}
                </li>
              ))}
            </ul>
          )}

          <ol className="variants">
            {variants.map((v, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={v === selected ? 'variant variant--active' : 'variant'}
                  onClick={() => select(i)}
                >
                  <span className="variant__rank">{i + 1}</span>
                  <span className="variant__body">
                    <span className="variant__title">{v.title}</span>
                    <span className="variant__meta">
                      {ROW_SHIFT_LABEL[v.layout.rowShift]}
                      {v.layout.orientation === 90 && ' · повёрнута'}
                    </span>
                    <span className="variant__stats">
                      видно от {v.metrics.minVisibleCut} мм · резать {v.metrics.cutTileCount}
                      {v.metrics.entry &&
                        ` · симметрия ${Math.round(v.metrics.entry.asymmetry)} мм`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="details-pane">
        <section className="rationale">
          <h3>Почему этот вариант</h3>
          {rationale.pros.length > 0 && (
            <ul className="rationale__pros">
              {rationale.pros.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {rationale.cons.length > 0 && (
            <ul className="rationale__cons">
              {rationale.cons.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          {rationale.tradeoff && <p className="rationale__tradeoff">{rationale.tradeoff}</p>}
        </section>

        <ul className="legend">
          <li>
            <span className="swatch swatch--whole" />целая плитка
          </li>
          <li>
            <span className="swatch swatch--cut" />подрезка, число — размер куска, мм
          </li>
          <li>
            <span className="swatch swatch--hidden" />закрыто мебелью
          </li>
          <li>
            <span className="swatch swatch--gaze" />сектор обзора
          </li>
          <li>
            <span className="swatch swatch--axis" />ось взгляда
          </li>
        </ul>

        <dl className="summary">
          {selected.metrics.entry && (
            <>
              <div className="summary__accent">
                <dt>Симметрия к оси входа</dt>
                <dd>{symmetryText(selected.metrics.entry.asymmetry)}</dd>
              </div>
              <div className="summary__accent">
                <dt>В зоне обзора видно от</dt>
                <dd>{selected.metrics.entry.minCut} мм</dd>
              </div>
            </>
          )}
          {selected.metrics.threshold && (
            <div className="summary__accent">
              <dt>Плитка в проёме</dt>
              <dd>
                {selected.metrics.threshold.seamless
                  ? 'без шва'
                  : `шов внутри, узкий кусок ${selected.metrics.threshold.narrowestPiece} мм`}
              </dd>
            </div>
          )}
          <div>
            <dt>Минимальная подрезка</dt>
            <dd>{selected.metrics.minCut} мм</dd>
          </div>
          <div>
            <dt>Не закрыто мебелью от</dt>
            <dd>{selected.metrics.minVisibleCut} мм</dd>
          </div>
          <div>
            <dt>Спрятано под мебель</dt>
            <dd>{selected.metrics.hiddenCutCount}</dd>
          </div>
          <div>
            <dt>Резать плиток</dt>
            <dd>{selected.metrics.cutTileCount}</dd>
          </div>
          <div>
            <dt>Целых плиток</dt>
            <dd>{selected.metrics.wholeTileCount}</dd>
          </div>
          <div>
            <dt>Площадь пола</dt>
            <dd>{area.toFixed(2)} м²</dd>
          </div>
          <div>
            <dt>Купить с запасом 10%</dt>
            <dd>{Math.ceil(total * 1.1)}</dd>
          </div>
        </dl>

        <section className="brief">
          <h3>Задание на укладку</h3>
          <ol>
            {buildInstructions(room, tile, door, selected).map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </section>

        <p className="hint">
          План развёрнут так, как помещение видно с порога: вход снизу, глубина вверх.
          Зелёная линия — ось взгляда, по ней и считается симметрия. Под подвесной мебелью
          затемнена только та полоса, которую действительно не видно из-под нижней кромки.
        </p>
      </section>

      <p className="notice notice--muted">
        Комната считается идеальным прямоугольником. В реальности стены расходятся на 10–30 мм
        на три метра — перед укладкой промерьте обе стены каждой пары.
      </p>
    </main>
  );
}
