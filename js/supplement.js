// supplement.js — 보충제 추천 / 기록
import { CATEGORY, makeEntry } from './model.js';
import { add, getByCategory, remove, subscribe } from './store.js';
import { el, clear, fmtDateTime, sessionMode } from './util.js';
import { toast } from './app.js';

// ── 제품 데이터 (정확한 도메인 지식) ────────────────
export const SUPPLEMENTS = {
  C4: {
    id: 'C4',
    name: 'Cellucor C4 (Original)',
    emoji: '⚡',
    stim: true,
    caffeineMg: 150,
    betaAlanineG: 1.6,
    defaultDose: '1스쿱',
    water: '180ml',
    howto: [
      '1스쿱을 찬물 약 180ml에 타서 운동 20–30분 전 섭취',
      '처음이면 ½스쿱으로 내성(자극·홍조) 확인',
      '하루 2스쿱 초과 금지',
      '카페인 ~150mg 함유 — 취침 6시간 이내 섭취 피하기',
    ],
  },
  BETA: {
    id: 'BETA',
    name: 'Nutricost Beta-Alanine',
    emoji: '🟢',
    stim: false,
    caffeineMg: 0,
    betaAlanineG: 3.2,
    defaultDose: '약 3.2g',
    water: '물 한 컵',
    howto: [
      '약 2–3.2g을 물에 타서 운동 20–30분 전 섭취',
      '따끔거림(paresthesia)은 무해한 정상 반응',
      '효과는 누적적 — 운동 안 하는 날도 매일 꾸준히 섭취 시 근육 카르노신 포화',
      '무자극(카페인 없음) → 저녁/야간 운동에도 수면 방해 없음',
    ],
  },
};

const DAILY_BETA_LIMIT_G = 6.4;

/**
 * 시간대별 추천 (사용자 제약: 오전 8시 전 / 오후 7시 이후).
 * 반환: { primary, reason, warn? }
 */
export function recommendSupplement(mode = sessionMode()) {
  if (mode === 'morning') {
    return {
      primary: SUPPLEMENTS.C4,
      reason: '오전 운동엔 카페인이 각성·집중·에너지에 도움이 됩니다. 하루를 깨우기에 적합해요.',
    };
  }
  return {
    primary: SUPPLEMENTS.BETA,
    reason:
      '저녁(19시 이후) 운동엔 무자극 베타알라닌을 권합니다. C4의 카페인(반감기 ~5–6시간)은 이 시간대에 먹으면 수면을 방해할 수 있어요.',
    warn:
      'C4를 굳이 저녁에 드시려면 취침 6시간 전 이전으로 제한하세요. 그 외엔 베타알라닌이 안전한 선택입니다.',
  };
}

// ── 인코딩 ─────────────────────────────────────────
export function buildSupplementText({ product, dose, water, when }) {
  return ['[SUPPLEMENT]', `제품 ${product}`, `용량 ${dose}`, `물 ${water}`, `시각 ${when}`]
    .join(' / ');
}

export function parseSupplement(text) {
  const get = (label) => {
    const m = text.match(new RegExp(label + '\\s+([^/]+)'));
    return m ? m[1].trim() : '';
  };
  return {
    product: get('제품'), dose: get('용량'), water: get('물'), when: get('시각'),
  };
}

// 오늘 섭취 기록으로 일일 카페인/베타알라닌 누적
export function todayIntake() {
  const today = new Date().toDateString();
  const list = getByCategory(CATEGORY.SUPPLEMENT).filter(
    (e) => new Date(e.createdAt).toDateString() === today
  );
  let caffeine = 0, beta = 0, count = 0;
  for (const e of list) {
    const { product } = parseSupplement(e.text);
    const sup = product.includes('C4') ? SUPPLEMENTS.C4 : product.includes('Beta') || product.includes('베타') ? SUPPLEMENTS.BETA : null;
    if (sup) { caffeine += sup.caffeineMg; beta += sup.betaAlanineG; count++; }
  }
  return { caffeine, beta, count };
}

/** 보충제 복용 기록 저장 (가이드 세션에서도 호출) */
export function logSupplement(sup, dose) {
  const text = buildSupplementText({
    product: sup.name,
    dose: dose || sup.defaultDose,
    water: sup.water,
    when: fmtDateTime(Date.now()),
  });
  add(makeEntry({ text, category: CATEGORY.SUPPLEMENT }));
  return text;
}

// ── 추천 카드 (재사용: 가이드 세션 + 보충제 탭) ─────
export function recommendationCard(mode, { onLogged } = {}) {
  const rec = recommendSupplement(mode);
  const sup = rec.primary;
  const card = el('div', { class: 'card card--glow' });

  card.appendChild(el('div', { class: 'supp-rec' }, [
    el('div', { class: 'supp-rec__emblem' }, sup.emoji),
    el('div', { style: { flex: '1' } }, [
      el('div', { class: 'faint' }, mode === 'morning' ? '🌅 오전 추천' : '🌙 저녁 추천'),
      el('div', { style: { fontWeight: '800', fontSize: '16px' } }, sup.name),
      el('div', { class: 'muted', style: { fontSize: '13px', marginTop: '2px' } }, rec.reason),
    ]),
  ]));

  const ul = el('ul', { class: 'pill-list' });
  for (const line of sup.howto) ul.appendChild(el('li', {}, line));
  card.appendChild(ul);

  if (rec.warn) card.appendChild(el('div', { class: 'note note--warn' }, [
    el('strong', {}, '⚠ 주의 '), rec.warn,
  ]));

  // 대체 선택지
  const other = sup.id === 'C4' ? SUPPLEMENTS.BETA : SUPPLEMENTS.C4;

  card.appendChild(el('div', { class: 'btn-row', style: { marginTop: '12px' } }, [
    el('button', {
      class: 'btn btn--primary',
      onClick: () => doLog(sup),
    }, `${sup.emoji} ${sup.id === 'C4' ? 'C4' : '베타알라닌'} 복용 기록`),
    el('button', {
      class: 'btn btn--ghost btn--sm',
      onClick: () => doLog(other),
    }, `대신 ${other.id === 'C4' ? 'C4' : '베타알라닌'} 기록`),
  ]));

  function doLog(s) {
    logSupplement(s);
    const { caffeine } = todayIntake();
    toast(`${s.id === 'C4' ? 'C4' : '베타알라닌'} 복용 기록됨 🥤`);
    if (caffeine > 400) toast('⚠ 오늘 카페인 400mg 초과 — 섭취량을 확인하세요.');
    if (onLogged) onLogged(s);
  }

  card.appendChild(el('div', { class: 'disclaimer' },
    '※ 일반 정보이며 의학적 조언이 아닙니다. 기저질환이 있거나 약을 복용 중이면 전문가와 상담하세요.'));
  return card;
}

// ── 보충제 탭 ──────────────────────────────────────
let unsub = null;
export function renderSupplement(host) {
  if (unsub) unsub();
  clear(host);

  const draw = () => {
    clear(host);
    host.appendChild(recommendationCard(sessionMode(), { onLogged: draw }));

    // 오늘 누적
    const { caffeine, beta, count } = todayIntake();
    host.appendChild(el('div', { class: 'card' }, [
      el('h2', { class: 'card__title' }, '오늘 누적'),
      el('div', { class: 'stat-grid' }, [
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__label' }, '카페인'),
          el('div', { class: 'stat__value' + (caffeine > 400 ? ' up' : '') }, `${caffeine}mg`),
        ]),
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__label' }, '베타알라닌'),
          el('div', { class: 'stat__value' + (beta > DAILY_BETA_LIMIT_G ? ' up' : '') }, `${beta.toFixed(1)}g`),
        ]),
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat__label' }, '섭취 횟수'),
          el('div', { class: 'stat__value' }, String(count)),
        ]),
      ]),
    ]));

    // 이력
    host.appendChild(el('div', { class: 'section-title' }, '복용 이력'));
    const list = getByCategory(CATEGORY.SUPPLEMENT);
    if (!list.length) {
      host.appendChild(el('div', { class: 'empty' }, '아직 복용 기록이 없습니다.'));
    } else {
      for (const e of list) {
        const p = parseSupplement(e.text);
        const card = el('div', { class: 'entry' }, [
          el('div', { class: 'entry__head' }, [
            el('span', { class: 'badge tag-cardio' }, p.product.includes('C4') ? 'C4' : '베타알라닌'),
            el('span', { class: 'entry__date' }, p.when || fmtDateTime(e.createdAt)),
            el('button', { class: 'x', onClick: () => { remove(e.id); draw(); } }, '✕'),
          ]),
          el('div', { class: 'muted', style: { fontSize: '13px' } }, `${p.dose} · ${p.water}`),
        ]);
        host.appendChild(card);
      }
    }
  };

  draw();
  unsub = subscribe(draw);
}
