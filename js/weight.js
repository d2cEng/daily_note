// weight.js — 체중(WEIGHT) 탭 (참고 문서 §1)
import { CATEGORY, WEIGHT_ROUTE, WEIGHT_ROUTE_LABEL, WEIGHT_ROUTE_COLOR, makeEntry } from './model.js';
import { add, getByCategory, remove, subscribe } from './store.js';
import { el, clear, fmtDate, fmtYearMonth, fmtDateTime, signed, parseMeasuredAt, num, stripOcrRaw } from './util.js';
import { renderTrendChart } from './chart.js';
import { toast } from './app.js';
import { detectWeightDataIssue, summarizeIssue, detectWeightOutlierIssues } from './quality.js';

// ── §1.3 지표 사전 ─────────────────────────────────
export const OKOK_METRICS = [
  '체중(Kg)', 'BMI', '지방(%)', '체질 지방량(Kg)', '골격근 비율(%)', '골격근량(Kg)',
  '근육 기록(%)', '근육량(Kg)', '수분(%)', '물의 무게(Kg)', '내장지방', '골격 기록(Kg)',
  '기초대사', '단백질(%)', '비만도(%)', '대사 연령', '지방을 뺀 체중(LBM)(Kg)', '실제 나이', '신장(cm)',
];
export const INBODY_CORE = ['체중(kg)', '골격근량(kg)', '체지방률(%)', 'BMI(kg/m²)', '기초대사량(kcal)'];

// 라벨 정규화 (참고 §1.3)
const CANON = {
  체중: '체중(Kg)', 체지방률: '지방(%)', 골격근량: '골격근량(Kg)',
};
export function canonicalWeightMetricLabel(label) {
  return CANON[label] || label;
}

// ── §1.1 루트 판별 ─────────────────────────────────
export function detectWeightInputRoute(entry) {
  if (entry.weightRoute) return entry.weightRoute;
  const t = entry.text || '';
  if (/^\s*\[INBODY\]/.test(t)) return WEIGHT_ROUTE.INBODY;
  if (/^\s*\[OKOK\]/.test(t)) return WEIGHT_ROUTE.OKOK;
  if (/인바디|INBODY/i.test(t)) return WEIGHT_ROUTE.INBODY;
  if (/측정일/.test(t) && /BMI/i.test(t)) return WEIGHT_ROUTE.OKOK;
  return WEIGHT_ROUTE.MANUAL;
}

// ── §1.2 인코딩 ────────────────────────────────────
function ensureUnit(value, unit) {
  const s = String(value).trim();
  if (s === '') return s;
  return /[a-zA-Z%]$/.test(s) ? s : s + unit;
}

export function buildInbodyMemoText({ weight, skeletalMuscle, bodyFat, note }) {
  const parts = ['[INBODY]', `체중 ${ensureUnit(weight, 'kg')}`];
  if (skeletalMuscle) parts.push(`골격근량 ${ensureUnit(skeletalMuscle, 'kg')}`);
  if (bodyFat) parts.push(`체지방률 ${ensureUnit(bodyFat, '%')}`);
  if (note) parts.push(`메모 ${note}`);
  return parts.join(' / ');
}

export function buildOkokMemoText({ weight, bodyFat, bmi, measuredAt, note, details }) {
  const parts = ['[OKOK]', `체중 ${ensureUnit(weight, 'kg')}`];
  if (bodyFat) parts.push(`체지방률 ${ensureUnit(bodyFat, '%')}`);
  if (bmi) parts.push(`BMI ${bmi}`);
  if (measuredAt) parts.push(`측정일 ${measuredAt}`);
  // 상세 19개 지표: [label, value] 배열. 값 있는 것만 라벨 토큰으로 추가.
  if (Array.isArray(details)) {
    for (const [label, value] of details) {
      if (value !== '' && value != null) parts.push(`${label} ${value}`);
    }
  }
  if (note) parts.push(`메모 ${note}`);
  return parts.join(' / ');
}

// ── §3 지표값 추출 ─────────────────────────────────
export function extractWeightMetricValue(text, label) {
  text = stripOcrRaw(text); // 원본 OCR 영역의 잡음 숫자 배제
  const idx = text.indexOf(label);
  if (idx === -1) return null;
  const after = text.slice(idx + label.length);
  const m = after.match(/(-?\d+(?:[.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

// 체중 kg 값 (캐시 amount 우선)
export function weightKg(entry) {
  if (entry.amount != null) return entry.amount;
  const m = (entry.text || '').match(/(\d+(?:[.,]\d+)?)\s*kg/i);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

// 타임라인 정렬 기준 시각 (측정일 우선, 참고 §1.4)
export function timelineTime(entry) {
  const m = (entry.text || '').match(/측정일\s+([\d/.\-:\s]+)/);
  if (m) {
    const ms = parseMeasuredAt(m[1]);
    if (ms) return ms;
  }
  return entry.createdAt;
}

// 차트 포인트 빌드
export function buildPoints(entries, label) {
  const pts = [];
  for (const e of entries) {
    const route = detectWeightInputRoute(e);
    const value =
      label && label !== '체중'
        ? extractWeightMetricValue(e.text, label)
        : weightKg(e);
    if (value == null) continue;
    pts.push({ t: timelineTime(e), value, route, id: e.id });
  }
  return pts.sort((a, b) => a.t - b.t);
}

// 데이터가 존재하는 추이 지표 목록 (드롭다운용)
export function availableMetrics(entries) {
  const set = new Set(['체중']);
  for (const e of entries) {
    for (const label of [...OKOK_METRICS, ...INBODY_CORE]) {
      if (extractWeightMetricValue(e.text, label) != null) set.add(label);
    }
  }
  return [...set];
}

// ── 입력 폼 (Composer, 참고 §1.5) ──────────────────
function composer(onSaved) {
  let route = WEIGHT_ROUTE.MANUAL;
  const card = el('div', { class: 'card card--glow' }, [
    el('h2', { class: 'card__title' }, '체중 입력'),
  ]);
  const seg = el('div', { class: 'segment' });
  const formHost = el('div');

  for (const r of [WEIGHT_ROUTE.MANUAL, WEIGHT_ROUTE.INBODY, WEIGHT_ROUTE.OKOK]) {
    seg.appendChild(
      el('button', {
        'data-route': r,
        class: r === route ? 'active' : '',
        onClick: () => {
          route = r;
          seg.querySelectorAll('button').forEach((b) =>
            b.classList.toggle('active', b.dataset.route === r)
          );
          renderForm();
        },
      }, WEIGHT_ROUTE_LABEL[r])
    );
  }

  function field(labelText, input) {
    return el('label', { class: 'field' }, [el('span', {}, labelText), input]);
  }
  const inp = (ph, type = 'number') =>
    el('input', { type, inputmode: type === 'number' ? 'decimal' : 'text', placeholder: ph });

  function renderForm() {
    clear(formHost);
    if (route === WEIGHT_ROUTE.MANUAL) {
      const ta = el('textarea', { placeholder: '예: 72.4kg (일반 체중 메모)' });
      formHost.appendChild(field('체중 메모', ta));
      formHost.appendChild(saveBtn(() => {
        if (!ta.value.trim()) return toast('체중 메모를 입력해주세요.');
        save(ta.value.trim(), WEIGHT_ROUTE.MANUAL, num(ta.value));
      }));
    } else if (route === WEIGHT_ROUTE.INBODY) {
      const w = inp('필수'), sm = inp('선택'), bf = inp('선택');
      const note = el('input', { placeholder: '선택' });
      formHost.appendChild(field('체중(kg) *', w));
      formHost.appendChild(field('골격근량(kg)', sm));
      formHost.appendChild(field('체지방률(%)', bf));
      formHost.appendChild(field('메모', note));
      formHost.appendChild(saveBtn(() => {
        if (!w.value) return toast('인바디 체중 값을 입력해주세요.');
        const text = buildInbodyMemoText({
          weight: w.value, skeletalMuscle: sm.value, bodyFat: bf.value, note: note.value,
        });
        save(text, WEIGHT_ROUTE.INBODY, num(w.value));
      }));
    } else {
      const w = inp('필수'), bf = inp('선택'), bmi = inp('선택');
      const md = el('input', { placeholder: 'yyyy/MM/dd HH:mm:ss' });
      const note = el('input', { placeholder: '선택' });
      formHost.appendChild(field('체중(kg) *', w));
      formHost.appendChild(field('체지방률(%)', bf));
      formHost.appendChild(field('BMI', bmi));
      formHost.appendChild(field('측정일', md));
      formHost.appendChild(field('메모', note));

      // 상세 19개 지표 (접이식) — 메인 입력과 겹치는 3개 제외
      const detailLabels = OKOK_METRICS.filter(
        (l) => !['체중(Kg)', 'BMI', '지방(%)'].includes(l)
      );
      const detailInputs = {};
      const grid = el('div', { class: 'detail-grid' });
      for (const label of detailLabels) {
        const di = el('input', { type: 'number', inputmode: 'decimal', placeholder: '선택' });
        detailInputs[label] = di;
        grid.appendChild(el('label', { class: 'field' }, [el('span', {}, label), di]));
      }
      const det = el('details', { class: 'detail-fold' }, [
        el('summary', {}, '상세 19개 지표 입력 (선택)'),
        grid,
      ]);
      formHost.appendChild(det);

      formHost.appendChild(saveBtn(() => {
        if (!w.value) return toast('OKOK 체중 값을 입력해주세요.');
        if (md.value && !parseMeasuredAt(md.value))
          return toast('측정일을 yyyy/MM/dd HH:mm:ss 형식으로 입력해주세요.');
        // 메인 필드를 표준 라벨로도 기록 → 품질/이상치 검출 일관성 확보
        const details = [
          ['체중(Kg)', w.value],
          ['BMI', bmi.value],
          ['지방(%)', bf.value],
          ...detailLabels.map((l) => [l, detailInputs[l].value]),
        ];
        const text = buildOkokMemoText({
          weight: w.value, bodyFat: bf.value, bmi: bmi.value,
          measuredAt: md.value, note: note.value, details,
        });
        save(text, WEIGHT_ROUTE.OKOK, num(w.value));
      }));
    }
  }
  function saveBtn(fn) {
    return el('button', { class: 'btn btn--primary btn--block', onClick: fn }, '체중 저장');
  }
  function save(text, weightRoute, amount) {
    add(makeEntry({ text, category: CATEGORY.WEIGHT, weightRoute, amount }));
    toast('체중 저장 완료 ⚖️');
    renderForm();
    if (onSaved) onSaved();
  }

  card.appendChild(seg);
  card.appendChild(formHost);
  renderForm();
  return card;
}

// ── 인사이트 패널 (참고 §1.6) ──────────────────────
const PERIODS = [
  { label: '7일', days: 7 }, { label: '14일', days: 14 },
  { label: '30일', days: 30 }, { label: '60일', days: 60 },
  { label: '90일', days: 90 }, { label: '180일', days: 180 },
  { label: '1년', days: 365 }, { label: '전체', days: Infinity },
];

function insightPanel(allEntries, selectedDay, onSelectDay) {
  let periodDays = 30;
  let metric = '체중';
  const card = el('div', { class: 'card' });

  function render() {
    clear(card);
    card.appendChild(el('h2', { class: 'card__title' }, '체중 경과 인사이트'));

    // 기간 탭
    const tabs = el('div', { class: 'chip-row' });
    for (const p of PERIODS) {
      tabs.appendChild(el('button', {
        class: 'chip' + (p.days === periodDays ? ' active' : ''),
        onClick: () => { periodDays = p.days; render(); },
      }, p.label));
    }
    card.appendChild(tabs);

    // 측정일 기준 정렬 + 기간 필터
    const sorted = allEntries.slice().sort((a, b) => timelineTime(a) - timelineTime(b));
    let filtered = sorted;
    if (periodDays !== Infinity && sorted.length) {
      const latest = timelineTime(sorted[sorted.length - 1]);
      const cutoff = latest - periodDays * 86400000;
      filtered = sorted.filter((e) => timelineTime(e) >= cutoff);
      if (!filtered.length) filtered = [sorted[sorted.length - 1]];
    }

    // 추이 항목 드롭다운
    const metrics = availableMetrics(allEntries);
    const sel = el('select', {
      onChange: (e) => { metric = e.target.value; render(); },
    });
    for (const m of metrics) {
      const o = el('option', { value: m }, m);
      if (m === metric) o.selected = true;
      sel.appendChild(o);
    }
    card.appendChild(el('label', { class: 'field' }, [
      el('span', {}, '추이 항목'), sel,
    ]));

    const points = buildPoints(filtered, metric);
    const values = points.map((p) => p.value);

    // 통계 7종
    if (values.length) {
      const cur = values[values.length - 1];
      const prev = values.length > 1 ? values[values.length - 2] : cur;
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const lo = Math.min(...values), hi = Math.max(...values);
      const grid = el('div', { class: 'stat-grid' });
      const stat = (label, val, cls) =>
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__label' }, label),
          el('div', { class: 'stat__value ' + (cls || '') }, val),
        ]);
      const dir = (d) => (d > 0 ? 'up' : d < 0 ? 'down' : '');
      grid.appendChild(stat('현재', cur.toFixed(1)));
      grid.appendChild(stat('직전 대비', signed(cur - prev), dir(cur - prev)));
      grid.appendChild(stat('평균', avg.toFixed(1)));
      grid.appendChild(stat('최저 대비', signed(cur - lo), dir(cur - lo)));
      grid.appendChild(stat('최고 대비', signed(cur - hi), dir(cur - hi)));
      grid.appendChild(stat('범위', (hi - lo).toFixed(1)));
      grid.appendChild(stat('최고', hi.toFixed(1)));
      grid.appendChild(stat('최저', lo.toFixed(1)));
      grid.appendChild(stat('기록 수', String(values.length)));
      card.appendChild(grid);
    }

    // 차트 (포인트 클릭 → 해당 일자 선택)
    card.appendChild(el('div', { class: 'faint', style: { marginBottom: '4px' } },
      '그래프의 점을 누르면 그 날짜의 데이터만 아래에 표시됩니다.'));
    card.appendChild(renderTrendChart(points, { selectedDay, onSelectDate: onSelectDay }));

    // 범례 + 루트 카운트
    const counts = { MANUAL: 0, INBODY: 0, OKOK: 0 };
    for (const e of allEntries) counts[detectWeightInputRoute(e)]++;
    const legend = el('div', { class: 'legend' });
    for (const r of ['INBODY', 'OKOK', 'MANUAL']) {
      legend.appendChild(el('span', {}, [
        el('span', { class: 'dot', style: { background: WEIGHT_ROUTE_COLOR[r] } }),
        `${WEIGHT_ROUTE_LABEL[r]} ${counts[r]}`,
      ]));
    }
    card.appendChild(legend);
    card.appendChild(el('div', { class: 'faint', style: { marginTop: '6px' } },
      `기록 ${points.length}건 · 전체 ${allEntries.length}건`));
  }

  render();
  return card;
}

// ── 데이터 품질 / 이상치 필터 패널 (참고 §1.8) ──────
let qualityFilter = 'ALL'; // ALL | FAIL | OUTLIER
function qualityPanel(all) {
  const outliers = detectWeightOutlierIssues(all);
  const rows = all.map((e) => ({
    entry: e,
    fail: detectWeightDataIssue(e),
    outlier: outliers.get(e.id) || null,
  })).filter((r) => r.fail || r.outlier);

  const failCount = rows.filter((r) => r.fail).length;
  const outCount = rows.filter((r) => r.outlier).length;

  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { class: 'card__title' }, '데이터 품질 점검'));

  if (!rows.length) {
    card.appendChild(el('div', { class: 'empty' }, '검출된 누락·이상치가 없습니다. 👍'));
    return card;
  }

  const tabs = el('div', { class: 'chip-row' });
  for (const [key, label] of [['ALL', '전체'], ['FAIL', '검출 실패만'], ['OUTLIER', '이상치만']]) {
    tabs.appendChild(el('button', {
      class: 'chip' + (qualityFilter === key ? ' active' : ''),
      onClick: () => { qualityFilter = key; card.replaceWith(qualityPanel(all)); },
    }, label));
  }
  card.appendChild(tabs);

  const visible = rows.filter((r) =>
    qualityFilter === 'ALL' ? true : qualityFilter === 'FAIL' ? r.fail : r.outlier
  );
  for (const r of visible) {
    const box = el('div', { class: 'issue ' + (r.outlier ? 'issue--outlier' : 'issue--fail') });
    box.appendChild(el('div', { class: 'entry__head' }, [
      el('b', {}, weightKg(r.entry) != null ? `${weightKg(r.entry)}kg` : '기록'),
      el('span', { class: 'entry__date' }, fmtDateTime(timelineTime(r.entry))),
    ]));
    if (r.fail) {
      box.appendChild(el('div', { class: 'muted', style: { fontSize: '13px' } }, [
        el('span', { class: 'issue__tag' }, '검출실패'), summarizeIssue(r.fail),
      ]));
    }
    if (r.outlier) {
      const txt = r.outlier
        .map((o) => `${o.label} ${o.value} (정상 ${o.range[0].toFixed(1)}~${o.range[1].toFixed(1)})`)
        .join(', ');
      box.appendChild(el('div', { class: 'muted', style: { fontSize: '13px' } }, [
        el('span', { class: 'issue__tag' }, '이상치'), txt,
      ]));
    }
    card.appendChild(box);
  }
  card.appendChild(el('div', { class: 'faint', style: { marginTop: '6px' } },
    `전체 ${rows.length}건 · 검출실패 ${failCount}건 · 이상치 ${outCount}건`));
  return card;
}

// ── 체중 탭 렌더 ────────────────────────────────────
let unsub = null;
let selectedDay = null;

export function renderWeight(host) {
  if (unsub) unsub();
  clear(host);

  const draw = () => {
    clear(host);
    const all = getByCategory(CATEGORY.WEIGHT);

    host.appendChild(composer(draw));

    if (!all.length) {
      host.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'empty' }, '체중 기록을 추가하면 인사이트 차트가 나타납니다.'),
      ]));
      return;
    }

    // 최신 측정일을 기본 선택
    const sorted = all.slice().sort((a, b) => timelineTime(a) - timelineTime(b));
    if (!selectedDay) selectedDay = fmtDate(timelineTime(sorted[sorted.length - 1]));

    host.appendChild(insightPanel(all, selectedDay, (day) => { selectedDay = day; draw(); }));
    host.appendChild(qualityPanel(all));

    // 선택한 날짜의 데이터만 표시
    host.appendChild(el('div', { class: 'section-title' }, '선택한 날짜 기록'));
    host.appendChild(dayDetailCard(all, selectedDay, draw));
  };

  draw();
  unsub = subscribe(draw);
}

// 선택한 날짜의 체중 기록(들)만 상세 표시
function dayDetailCard(all, day, refresh) {
  const items = all
    .filter((e) => fmtDate(timelineTime(e)) === day)
    .sort((a, b) => timelineTime(b) - timelineTime(a));
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'cal-title', style: { marginBottom: '10px' } }, day));
  if (!items.length) {
    card.appendChild(el('div', { class: 'empty' }, '이 날짜의 기록이 없습니다.'));
    return card;
  }
  for (const e of items) card.appendChild(weightDetailEntry(e, refresh));
  return card;
}

function weightDetailEntry(entry, refresh) {
  const route = detectWeightInputRoute(entry);
  const kg = weightKg(entry);
  const card = el('div', { class: 'entry', style: { marginBottom: '8px' } });
  card.appendChild(el('div', { class: 'entry__head' }, [
    el('span', { class: 'badge', style: { color: WEIGHT_ROUTE_COLOR[route] } }, WEIGHT_ROUTE_LABEL[route]),
    kg != null ? el('b', {}, `${kg}kg`) : null,
    el('span', { class: 'entry__date' }, fmtDateTime(timelineTime(entry))),
    el('button', { class: 'x', title: '삭제', onClick: () => { remove(entry.id); refresh(); } }, '✕'),
  ]));
  // 측정된 지표 전체를 칩으로 나열
  const metrics = stripOcrRaw(entry.text)
    .replace(/^\s*\[(INBODY|OKOK)\]\s*\/\s*/, '')
    .split(' / ')
    .map((s) => s.trim())
    .filter((s) => s && !/^메모\s/.test(s));
  const grid = el('div', { class: 'metric-chips' });
  for (const m of metrics) grid.appendChild(el('span', { class: 'metric-chip' }, m));
  card.appendChild(grid);
  return card;
}
