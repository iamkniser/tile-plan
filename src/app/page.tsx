'use client';

import { useEffect, useMemo, useState } from 'react';
import { LayoutPlan } from '@/components/LayoutPlan';
import { WallPlan } from '@/components/WallPlan';
import {
  OBJECT_LABEL,
  buildInstructions,
  buildRationale,
  coverRects,
  generateVariants,
  generateScreenVariants,
  generateWallVariants,
  rankWallVariants,
  rejectImpractical,
  rejectWallVariants,
  rowShiftOptions,
  viewerPoint,
  screenCovers,
  screenSurface,
  wallCoverRects,
  wallLength,
  wallOpening,
  wallSurface,
  type Side,
  type Variant,
  type WallVariant,
} from '@/engine';
import { fixtureObjects, useProject, type Surface } from '@/store';
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
    surface,
    setSurface,
    wallOrientation,
    setWallOrientation,
    points,
    setPoint,
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
  const floorVariant = variants[Math.min(selectedIndex, variants.length - 1)];

  // Раскладка стены считается от выбранного пола: так видно, расходятся ли швы.
  const { wallVariants, wallRejected } = useMemo(() => {
    if (surface === 'floor') return { wallVariants: [], wallRejected: 0 };

    // Длинная сторона плитки по горизонтали — это поворот 0, если сама плитка
    // задана длинной стороной по ширине.
    const longSideIsWidth = tile.width >= tile.height;
    const orientation: 0 | 90 =
      wallOrientation === 'horizontal' ? (longSideIsWidth ? 0 : 90) : longSideIsWidth ? 90 : 0;

    const all = surface.startsWith('screen:')
      ? generateScreenVariants(
          { room, tile, door, objects, points },
          surface.slice('screen:'.length),
          floorVariant.layout,
          orientation,
        )
      : generateWallVariants(
          { room, tile, door, objects, points },
          surface as Side,
          floorVariant.layout,
          orientation,
        );

    const { kept, rejected } = rejectWallVariants(all);
    return {
      wallVariants: kept.sort(rankWallVariants).slice(0, MAX_VARIANTS),
      wallRejected: rejected,
    };
  }, [surface, room, tile, door, objects, points, floorVariant, wallOrientation]);

  // Что именно рисуем: развёртку стены или экран ванны — данные для них разные.
  const isScreen = surface !== 'floor' && surface.startsWith('screen:');
  const screenObject = isScreen
    ? objects.find((o) => o.id === surface.slice('screen:'.length))
    : undefined;

  const activeSurface = useMemo(() => {
    if (surface === 'floor') return null;
    if (screenObject) {
      const s = screenSurface(room, screenObject);
      return s ? { width: s.width, height: s.height } : null;
    }
    return wallSurface(room, surface as Side);
  }, [surface, room, screenObject]);

  const activeCovers = useMemo(() => {
    if (surface === 'floor') return [];
    return screenObject
      ? screenCovers(room, screenObject, objects)
      : wallCoverRects(room, surface as Side, objects);
  }, [surface, room, objects, screenObject]);

  const activePoints = useMemo(
    () => (surface === 'floor' || isScreen ? [] : points.filter((p) => p.wall === surface)),
    [surface, isScreen, points],
  );

  const activeOpening = useMemo(
    () => (surface === 'floor' || isScreen ? null : wallOpening(room, surface as Side, door)),
    [surface, isScreen, room, door],
  );

  const selected = floorVariant;
  const selectedWall =
    surface === 'floor' ? null : wallVariants[Math.min(selectedIndex, wallVariants.length - 1)];

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
          <NumberField
            label="Высота"
            value={room.ceiling ?? 2500}
            onChange={(v) => setRoom({ ceiling: v })}
          />
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
                <NumberField
                  label="Верх над полом"
                  value={f.topHeight}
                  onChange={(v) => setFixture(f.id, { topHeight: v })}
                  min={0}
                />
                <label className="field field--check">
                  <span>Плитка за ним</span>
                  <input
                    type="checkbox"
                    checked={f.tiledBehind}
                    onChange={(e) => setFixture(f.id, { tiledBehind: e.target.checked })}
                  />
                </label>
              </>
            )}
          </fieldset>
        ))}

          {points.map((p) => (
            <fieldset key={p.id}>
              <legend>{p.label}</legend>
              <label className="field">
                <span>Стена</span>
                <select
                  value={p.wall}
                  onChange={(e) => setPoint(p.id, { wall: e.target.value as Side })}
                >
                  {(Object.keys(WALL_LABEL) as Side[]).map((w) => (
                    <option key={w} value={w}>
                      {WALL_LABEL[w]}
                    </option>
                  ))}
                </select>
              </label>
              <NumberField
                label="Отступ по стене"
                value={p.along}
                onChange={(v) => setPoint(p.id, { along: v })}
                min={0}
              />
              <NumberField
                label="Высота"
                value={p.height}
                onChange={(v) => setPoint(p.id, { height: v })}
                min={0}
              />
              <NumberField
                label="Диаметр"
                value={p.size}
                onChange={(v) => setPoint(p.id, { size: v })}
              />
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

      <nav className="surfaces">
        <button
          type="button"
          className={surface === 'floor' ? 'surface surface--active' : 'surface'}
          onClick={() => setSurface('floor')}
        >
          пол
        </button>
        {(Object.keys(WALL_LABEL) as Side[]).map((w) => (
          <button
            key={w}
            type="button"
            className={surface === w ? 'surface surface--active' : 'surface'}
            onClick={() => setSurface(w as Surface)}
          >
            {WALL_LABEL[w]} стена
          </button>
        ))}
        {objects
          .filter((o) => screenSurface(room, o) !== null && o.kind === 'bath')
          .map((o) => (
            <button
              key={o.id}
              type="button"
              className={surface === `screen:${o.id}` ? 'surface surface--active' : 'surface'}
              onClick={() => setSurface(`screen:${o.id}`)}
            >
              экран ванны
            </button>
          ))}
      </nav>

      {surface !== 'floor' && (
        <nav className="surfaces surfaces--sub">
          <span className="surfaces__label">плитка на стенах</span>
          <button
            type="button"
            className={wallOrientation === 'horizontal' ? 'surface surface--active' : 'surface'}
            onClick={() => setWallOrientation('horizontal')}
          >
            горизонтально
          </button>
          <button
            type="button"
            className={wallOrientation === 'vertical' ? 'surface surface--active' : 'surface'}
            onClick={() => setWallOrientation('vertical')}
          >
            вертикально
          </button>
        </nav>
      )}

      <section className="workspace">
        <div className="plan-col">
          <div className="plan-sticky">
          <div className="plan-head">
            <span className="rank">№{selectedIndex + 1}</span>
            <h2>{(selectedWall ?? selected).title}</h2>
            <span className="tags">
              {!selectedWall && selected.layout.orientation === 90 && (
                <span className="tag">плитка повёрнута</span>
              )}
              <span className="tag">
                {ROW_SHIFT_LABEL[(selectedWall ?? selected).layout.rowShift]}
              </span>
            </span>
          </div>

          {selectedWall ? (
            <WallPlan
              surface={activeSurface!}
              variant={selectedWall}
              covers={activeCovers}
              opening={activeOpening}
              points={activePoints}
              showEyeBand={!isScreen}
            />
          ) : (
            <LayoutPlan
              room={room}
              variant={selected}
              door={door}
              objects={objects}
              covers={covers}
            />
          )}
          </div>

        </div>

        <div className="variants-pane">
          <div className="variants-head">
            <h2>Варианты</h2>
            <span className="count">{variants.length}</span>
          </div>

          {!halfBlocked.allowed && <p className="notice">{halfBlocked.reason}</p>}

          {!selectedWall && rejections.length > 0 && (
            <ul className="rejections">
              {rejections.map((r) => (
                <li key={r.reason}>
                  отсеяно {r.count} — {r.reason}
                </li>
              ))}
            </ul>
          )}

          {selectedWall && wallRejected > 0 && (
            <ul className="rejections">
              <li>отсеяно {wallRejected} — подрезка тоньше 100 мм на уровне глаз</li>
            </ul>
          )}

          <ol className="variants">
            {(selectedWall ? wallVariants : variants).map((v, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={
                    i === Math.min(selectedIndex, (selectedWall ? wallVariants : variants).length - 1)
                      ? 'variant variant--active'
                      : 'variant'
                  }
                  onClick={() => select(i)}
                >
                  <span className="variant__rank">{i + 1}</span>
                  <span className="variant__body">
                    <span className="variant__title">{v.title}</span>
                    <span className="variant__meta">
                      {ROW_SHIFT_LABEL[v.layout.rowShift]}
                      {!selectedWall && v.layout.orientation === 90 && ' · повёрнута'}
                    </span>
                    <span className="variant__stats">
                      {'entry' in v.metrics
                        ? `видно от ${v.metrics.minVisibleCut} мм · резать ${v.metrics.cutTileCount}` +
                          (v.metrics.entry
                            ? ` · симметрия ${Math.round(v.metrics.entry.asymmetry)} мм`
                            : '')
                        : `${(v as WallVariant).metrics.pieceCount} кусков, ${(v as WallVariant).metrics.distinctCuts} размеров · на глазах от ${(v as WallVariant).metrics.eyeLevelCut} мм`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="details-pane">
        {selectedWall && (
          <dl className="summary">
            <div className="summary__accent">
              <dt>Кусков на стене</dt>
              <dd>{selectedWall.metrics.pieceCount}</dd>
            </div>
            <div className="summary__accent">
              <dt>Разных подрезок</dt>
              <dd>{selectedWall.metrics.distinctCuts}</dd>
            </div>
            {selectedWall.metrics.outletClearance !== null && (
              <div className="summary__accent">
                <dt>Вывод до шва</dt>
                <dd>
                  {selectedWall.metrics.outletClearance <= 0
                    ? 'шов режет отверстие'
                    : `${selectedWall.metrics.outletClearance} мм`}
                </dd>
              </div>
            )}
            <div className="summary__accent">
              <dt>Подрезка на уровне глаз</dt>
              <dd>{selectedWall.metrics.eyeLevelCut} мм</dd>
            </div>
            <div className="summary__accent">
              <dt>Шов расходится с полом на</dt>
              <dd>{selectedWall.metrics.floorJointOffset} мм</dd>
            </div>
            {selectedWall.metrics.edgeAlignment && (
              <div className="summary__accent">
                <dt>Шов и {OBJECT_LABEL[selectedWall.metrics.edgeAlignment.kind]}</dt>
                <dd>
                  {selectedWall.metrics.edgeAlignment.offset === 0
                    ? 'совпали'
                    : `${selectedWall.metrics.edgeAlignment.offset} мм`}
                </dd>
              </div>
            )}
            <div>
              <dt>Минимальная подрезка</dt>
              <dd>{selectedWall.metrics.minCut} мм</dd>
            </div>
            <div>
              <dt>Не закрыто мебелью от</dt>
              <dd>{selectedWall.metrics.minVisibleCut} мм</dd>
            </div>
            <div>
              <dt>Резать плиток</dt>
              <dd>{selectedWall.metrics.cutTileCount}</dd>
            </div>
            <div>
              <dt>Целых плиток</dt>
              <dd>{selectedWall.metrics.wholeTileCount}</dd>
            </div>
          </dl>
        )}

        {!selectedWall && (
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
        )}

        {!selectedWall && (
        <>
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

        </>
        )}

        {selectedWall && (
          <p className="hint">
            Развёртка стены: пол снизу, потолок сверху. Затенена полоса на уровне глаз —
            тонкая подрезка там читается как брак. Приглушённое закрыто ванной, мебелью
            или дверным проёмом.
          </p>
        )}

        {!selectedWall && (
        <p className="hint">
          План развёрнут так, как помещение видно с порога: вход снизу, глубина вверх.
          Зелёная линия — ось взгляда, по ней и считается симметрия. Под подвесной мебелью
          затемнена только та полоса, которую действительно не видно из-под нижней кромки.
        </p>
        )}
      </section>

      <p className="notice notice--muted">
        Комната считается идеальным прямоугольником. В реальности стены расходятся на 10–30 мм
        на три метра — перед укладкой промерьте обе стены каждой пары.
      </p>
    </main>
  );
}
