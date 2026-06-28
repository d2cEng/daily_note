// calendar.js — 기록일지 월간 캘린더뷰
import { CATEGORY } from './model.js';
import { getAll, subscribe } from './store.js';
import { el, clear, fmtDate, fmtYearMonth, fmtDateTime } from './util.js';
import { parseWorkoutMemoText, TYPE } from './workout.js';
import { detectWeightInputRoute, weightKg, timelineTime } from './weight.js';
import { parseSupplement } from './supplement.js';

const CAT_META = {
  WORKOUT: { color: '#ffb020', label: '운동', emoji: '💪' },
  WEIGHT: { color: '#00e5ff', label: '체중', emoji: '⚖️' },
  SUPPLEMENT: { color: '#aaff00', label: '보충제', emoji: '🥤' },
};
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 엔트리의 표시 날짜 키 (체중은 측정일 우선)
function dayKey(entry) {
  const ms = entry.category === CATEGORY.WEIGHT ? timelineTime(entry) : entry.createdAt;
  return fmtDate(ms);
}

let unsub = null;
let viewYM = null; // {y, m}
let selected = null; // 'yyyy-MM-dd'

export function renderCalendar(host) {
  if (unsub) unsub();
  clear(host);
  const now = new Date();
  if (!viewYM) viewYM = { y: now.getFullYear(), m: now.getMonth() };
  if (!selected) selected = fmtDate(now.getTime());

  const wrap = el('div');
  host.appendChild(wrap);

  const draw = () => {
    clear(wrap);
    const all = getAll();

    // 날짜별 카테고리 집계
    const byDay = {};
    for (const e of all) {
      const k = dayKey(e);
      (byDay[k] ||= new Set()).add(e.category);
    }

    // 헤더 (월 이동)
    const header = el('div', { class: 'cal-header' }, [
      el('button', { class: 'btn btn--ghost btn--sm', onClick: () => move(-1) }, '‹'),
      el('div', { class: 'cal-title' }, fmtYearMonth(new Date(viewYM.y, viewYM.m, 1).getTime())),
      el('button', { class: 'btn btn--ghost btn--sm', onClick: () => move(1) }, '›'),
    ]);
    wrap.appendChild(el('div', { class: 'card' }, [header, buildGrid(byDay), legend()]));

    // 선택일 기록
    wrap.appendChild(dayDetail(all));
  };

  function move(delta) {
    let m = viewYM.m + delta, y = viewYM.y;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    viewYM = { y, m };
    draw();
  }

  function buildGrid(byDay) {
    const grid = el('div', { class: 'cal-grid' });
    for (const wd of WEEKDAYS) grid.appendChild(el('div', { class: 'cal-wd' }, wd));

    const first = new Date(viewYM.y, viewYM.m, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(viewYM.y, viewYM.m + 1, 0).getDate();
    const todayKey = fmtDate(Date.now());

    for (let i = 0; i < startPad; i++) grid.appendChild(el('div', { class: 'cal-cell cal-cell--empty' }));
    for (let d = 1; d <= daysInMonth; d++) {
      const key = fmtDate(new Date(viewYM.y, viewYM.m, d).getTime());
      const cats = byDay[key];
      const cell = el('div', {
        class: 'cal-cell' + (key === todayKey ? ' is-today' : '') + (key === selected ? ' is-selected' : ''),
        onClick: () => { selected = key; draw(); },
      }, [el('span', { class: 'cal-day' }, String(d))]);
      if (cats) {
        const dots = el('div', { class: 'cal-dots' });
        for (const c of ['WORKOUT', 'WEIGHT', 'SUPPLEMENT']) {
          if (cats.has(c)) dots.appendChild(el('span', { class: 'cal-dot', style: { background: CAT_META[c].color } }));
        }
        cell.appendChild(dots);
      }
      grid.appendChild(cell);
    }
    return grid;
  }

  function legend() {
    const l = el('div', { class: 'legend', style: { marginTop: '12px' } });
    for (const c of ['WORKOUT', 'WEIGHT', 'SUPPLEMENT']) {
      l.appendChild(el('span', {}, [
        el('span', { class: 'dot', style: { background: CAT_META[c].color } }),
        CAT_META[c].label,
      ]));
    }
    return l;
  }

  function dayDetail(all) {
    const items = all.filter((e) => dayKey(e) === selected)
      .sort((a, b) => (a.category > b.category ? 1 : -1));
    const card = el('div', { class: 'card' });
    card.appendChild(el('h2', { class: 'card__title' }, `${selected} 기록`));
    if (!items.length) {
      card.appendChild(el('div', { class: 'empty' }, '이 날의 기록이 없습니다.'));
      return card;
    }
    for (const e of items) card.appendChild(detailRow(e));
    return card;
  }

  function detailRow(e) {
    const meta = CAT_META[e.category];
    let summary = '';
    if (e.category === CATEGORY.WORKOUT) {
      summary = parseWorkoutMemoText(e.text).map((ex) =>
        ex.type === TYPE.CARDIO
          ? `${ex.machineName} ${[ex.durationMin, ex.distanceKm && ex.distanceKm + 'km'].filter(Boolean).join(' ')}`
          : `${ex.machineName} ${ex.sets.map((s) => `${s.weightKg || 0}×${s.reps || 0}`).join(',')}`
      ).join(' / ');
    } else if (e.category === CATEGORY.WEIGHT) {
      const kg = weightKg(e);
      summary = `${kg != null ? kg + 'kg' : ''} (${detectWeightInputRoute(e)})`;
    } else {
      const p = parseSupplement(e.text);
      summary = `${p.product} ${p.dose}`;
    }
    return el('div', { class: 'entry', style: { marginBottom: '8px' } }, [
      el('div', { class: 'entry__head' }, [
        el('span', { class: 'badge', style: { color: meta.color } }, `${meta.emoji} ${meta.label}`),
        el('span', { class: 'entry__date' }, fmtDateTime(e.category === CATEGORY.WEIGHT ? timelineTime(e) : e.createdAt).slice(11)),
      ]),
      el('div', { class: 'muted', style: { fontSize: '13px' } }, summary || '—'),
    ]);
  }

  draw();
  unsub = subscribe(draw);
}
