// okok-ocr.js — OKOK 체중계 스크린샷 OCR 가져오기 (참고 §1.9)
// 한글 OCR은 Tesseract.js를 CDN에서 지연 로드. OCR 결과는 검토 폼에서 수정 후 저장.
import { OKOK_METRICS, buildOkokMemoText } from './weight.js';
import { CATEGORY, makeEntry, WEIGHT_ROUTE } from './model.js';
import { add } from './store.js';
import { el, clear } from './util.js';
import { toast } from './app.js';

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

// 테스트 주입용 인식기 훅 (실제로는 Tesseract 사용)
let _recognizer = null;
export function __setRecognizer(fn) { _recognizer = fn; }

let _tesseractPromise = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!_tesseractPromise) {
    _tesseractPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT_CDN;
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => reject(new Error('OCR 엔진을 불러오지 못했습니다 (인터넷 연결 확인).'));
      document.head.appendChild(s);
    });
  }
  return _tesseractPromise;
}

// 파일 → 이미지 엘리먼트
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    img.src = URL.createObjectURL(file);
  });
}

// 인식 정확도 향상: 업스케일 + 그레이스케일 + 대비 강화
async function preprocess(file) {
  const img = await fileToImage(file);
  const scale = img.naturalWidth && img.naturalWidth < 1100 ? 2 : 1;
  const w = (img.naturalWidth || img.width) * scale;
  const h = (img.naturalHeight || img.height) * scale;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  try {
    const d = ctx.getImageData(0, 0, w, h);
    const a = d.data;
    for (let i = 0; i < a.length; i += 4) {
      let g = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
      g = (g - 128) * 1.35 + 128;           // 대비 강화
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      a[i] = a[i + 1] = a[i + 2] = g;
    }
    ctx.putImageData(d, 0, 0);
  } catch (_) { /* 일부 환경에서 getImageData 제한 시 원본 사용 */ }
  return c;
}

/** 이미지 파일 → OCR 텍스트. onProgress(0..1) 선택. */
export async function ocrImage(file, onProgress) {
  if (_recognizer) return _recognizer(file);
  const T = await loadTesseract();
  let input = file;
  try { input = await preprocess(file); } catch (_) { input = file; }
  const { data } = await T.recognize(input, 'kor+eng', {
    logger: (m) => {
      if (onProgress && m.status === 'recognizing text') onProgress(m.progress);
    },
  });
  return data.text;
}

// ── OCR 텍스트 파싱 ────────────────────────────────
// 상태/수식어·아이콘 제거 (라벨 값 [상태]↑↓ 구조에서 값만 남기기 위함)
const STATUS_WORDS = /(높음|낮음|표준|건강|비만|보통임|보통|완전함|미만|과다|적정|정상|부족|위험)/g;
function cleanLine(s) {
  return s
    .replace(STATUS_WORDS, ' ')
    .replace(/[↑↓▲▼△▽⬆⬇➤◀▶©®™ⓘ•·|]/g, ' ');
}
// 숫자 인접 오인식 글자만 보정 (참고 §1.4) — 과교정 방지
function fixDigitsToken(t) {
  return t
    .replace(/[Oo]/g, '0').replace(/[IlｌＩ]/g, '1')
    .replace(/[Ss]/g, '5').replace(/[Bb]/g, '8');
}
function toNum(raw) {
  const f = String(raw).replace(',', '.').replace(/\.(?=.*\.)/g, '');
  const n = parseFloat(f);
  return isFinite(n) ? n : null;
}
// 문자열에서 첫 숫자 추출. 정상 숫자 우선, 없으면 글자 섞인 토큰 보정 시도.
function firstNumber(s) {
  const cleaned = cleanLine(s);
  let m = cleaned.match(/-?\d+(?:[.,]\d+)?/);
  if (m) return toNum(m[0]);
  m = cleaned.match(/-?[\dOoIlSsBb]+(?:[.,][\dOoIlSsBb]+)?/);
  if (m && /[\dOoIlSsBb]/.test(m[0])) return toNum(fixDigitsToken(m[0]));
  return null;
}

// 라벨별 매칭 키워드(고유 Korean 조각). 순서 = 우선순위(겹치는 라벨 먼저).
const LABEL_KEYS = [
  ['체질 지방량(Kg)', ['체질', '지방량']],
  ['지방을 뺀 체중(LBM)(Kg)', ['LBM', '뺀']],
  ['골격근 비율(%)', ['골격근', '비율']],
  ['골격근량(Kg)', ['골격근량']],
  ['골격 기록(Kg)', ['골격', '기록']],
  ['근육 기록(%)', ['근육', '기록']],
  ['근육량(Kg)', ['근육량']],
  ['물의 무게(Kg)', ['물']],
  ['내장지방', ['내장']],
  ['기초대사', ['기초']],
  ['단백질(%)', ['단백']],
  ['비만도(%)', ['비만']],
  ['대사 연령', ['대사', '연령']],
  ['실제 나이', ['실제', '나이']],
  ['신장(cm)', ['신장']],
  ['수분(%)', ['수분']],
  ['지방(%)', ['지방']],
  ['BMI', ['BMI']],
  ['체중(Kg)', ['체중']],
];

// 라벨별 타당 범위 — 범위 밖이면 OCR 깨진 값으로 보고 채택하지 않음
// (실측 코퍼스 기준: 화살표 오인식 '1', 조각 숫자 '9' 등 잡음 차단을 위해 정밀화)
const BOUNDS = {
  '체중(Kg)': [20, 300], 'BMI': [10, 60], '지방(%)': [3, 70],
  '체질 지방량(Kg)': [2, 150], '골격근 비율(%)': [10, 80], '골격근량(Kg)': [10, 120],
  '근육 기록(%)': [10, 200], '근육량(Kg)': [10, 200], '수분(%)': [20, 80],
  '물의 무게(Kg)': [10, 150], '내장지방': [1, 60], '골격 기록(Kg)': [0.5, 12],
  '기초대사': [500, 4000], '단백질(%)': [5, 40], '비만도(%)': [3, 400],
  '대사 연령': [5, 100], '지방을 뺀 체중(LBM)(Kg)': [30, 220],
  '실제 나이': [5, 100], '신장(cm)': [100, 250],
};
// 화면상 정수로만 표시되는 지표 — 소수값이면 오매칭으로 판단
const INTEGER_ONLY = new Set(['실제 나이', '신장(cm)']);
function inBounds(label, v) {
  const b = BOUNDS[label];
  if (b && (v < b[0] || v > b[1])) return false;
  if (INTEGER_ONLY.has(label) && !Number.isInteger(v)) return false;
  return true;
}

// 줄에서 키워드들의 마지막 끝 위치(하나라도 없으면 -1)
function keywordEnd(line, keys) {
  let end = -1;
  for (const k of keys) {
    const i = line.indexOf(k);
    if (i === -1) return -1;
    end = Math.max(end, i + k.length);
  }
  return end;
}

// ── 패스1: 줄 기반 (라벨과 값이 같은 줄에 있는 레이아웃) ──
// 근접 제약: 라벨 끝 24자 이내의 숫자만 인정(컬럼형 텍스트에서 오매칭 방지)
function lineParse(text) {
  const lines = (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const values = {};
  const used = new Set();
  for (const [label, keys] of LABEL_KEYS) {
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      const end = keywordEnd(lines[i], keys);
      if (end === -1) continue;
      const v = firstNumber(lines[i].slice(end, end + 24));
      if (v != null && inBounds(label, v)) { values[label] = v; used.add(i); break; }
    }
  }
  return { values, count: Object.keys(values).length };
}

// ── 패스2: 순서 정렬 (실제 OCR의 컬럼 분리 출력 대응) ──
// 실기기 OCR은 라벨 열 전체 → 값 열 전체 순으로 읽어 라벨·값이 다른 위치에
// 나온다. 값들은 19개 지표의 화면 순서를 유지하므로, 숫자 토큰 시퀀스를
// 지표 순서에 정렬(LCS형 DP)해 복원한다.
const STATUS_AFTER = /^(높음|낮음|표준|건강|비만|보통임|보통의|보통|완전함|완전한|미만|과다|적정|정상|부족|위험)/;

function stripDatesTimes(text) {
  return text
    .replace(/\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}/g, ' ')
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ');
}

// 숫자 토큰 추출(순서 유지). 변화량(±부호)·단위 부착(%·Kg·cm 등)·날짜는 제외.
// 각 토큰에 상태어 인접 여부를 기록(실값 뒤에는 높음/비만/완전한 등이 붙음).
function extractTokens(text) {
  const t = stripDatesTimes(text).replace(/[↑↓▲▼△▽⬆⬇|]/g, ' ');
  const tokens = [];
  const re = /\d+(?:[.,]\d+)?/g;
  let m;
  while ((m = re.exec(t))) {
    const prev = t[m.index - 1] || ' ';
    if (prev === '+' || prev === '-' || prev === ',' || prev === '.') continue;
    const after = t.slice(m.index + m[0].length);
    if (/^(%|[Kk][GgQq]|[Cc][Mm]|kcal)/.test(after)) continue; // 단위 부착 수치(권장체중 등)
    const v = toNum(m[0]);
    if (v == null) continue;
    tokens.push({ value: v, status: STATUS_AFTER.test(after.trimStart()) });
  }
  return tokens;
}

function alignOnce(tokens, preferLate, metrics = OKOK_METRICS) {
  const M = metrics.length, N = tokens.length;
  const dp = Array.from({ length: M + 1 }, () => new Float64Array(N + 1));
  const bt = Array.from({ length: M + 1 }, () => new Uint8Array(N + 1)); // 0=지표 스킵 1=토큰 스킵 2=매칭
  for (let i = 1; i <= M; i++) {
    for (let j = 0; j <= N; j++) {
      let best = dp[i - 1][j], from = 0;
      if (j > 0) {
        if (dp[i][j - 1] > best) { best = dp[i][j - 1]; from = 1; }
        const tok = tokens[j - 1];
        if (inBounds(metrics[i - 1], tok.value)) {
          // 동점 해소용 미세 위치 보너스(앞쪽/뒤쪽 선호 두 후보를 만들어
          // 아래 항등식 검증으로 승자를 고른다)
          const posBias = (preferLate ? j : N - j) / (N + 1) * 0.01;
          const s = dp[i - 1][j - 1] + 1 + (tok.status ? 0.25 : 0) + posBias;
          if (s > best) { best = s; from = 2; }
        }
      }
      dp[i][j] = best; bt[i][j] = from;
    }
  }
  const values = {};
  let i = M, j = N, count = 0;
  while (i > 0 && j >= 0) {
    const f = bt[i][j];
    if (f === 2) { values[metrics[i - 1]] = tokens[j - 1].value; count++; i--; j--; }
    else if (f === 1) { j--; }
    else { i--; }
  }
  return { values, count };
}

// 생리학적 항등식 — 정렬이 한 칸이라도 밀리면 깨지므로 강력한 판별 신호
function identityScore(v) {
  const w = v['체중(Kg)'];
  if (!w) return 0;
  const near = (a, b) => a != null && b != null && Math.abs(a - b) <= Math.max(1.5, b * 0.03);
  let s = 0;
  if (near(v['지방(%)'], (v['체질 지방량(Kg)'] / w) * 100)) s++;
  if (near(v['골격근 비율(%)'], (v['골격근량(Kg)'] / w) * 100)) s++;
  if (near(v['근육 기록(%)'], (v['근육량(Kg)'] / w) * 100)) s++;
  if (near(v['수분(%)'], (v['물의 무게(Kg)'] / w) * 100)) s++;
  if (near(v['지방을 뺀 체중(LBM)(Kg)'], w - v['체질 지방량(Kg)'])) s++;
  return s;
}

// LBM 앵커 보정: LBM = 체중 − 체질지방량은 유일하게 절대값으로 유도 가능한
// 항등식이다. 승자의 LBM이 이를 위반하면 토큰에서 기대값과 일치하는 앵커를
// 찾아 고정(pin)하고, 앞/뒤 구간을 분할 재정렬해 꼬리 시프트를 복구한다.
const LBM_LABEL = '지방을 뺀 체중(LBM)(Kg)';
function repairWithLbmAnchor(tokens, res) {
  const v = res.values;
  const w = v['체중(Kg)'], fat = v['체질 지방량(Kg)'];
  if (w == null || fat == null) return res;
  const target = w - fat;
  const tol = Math.max(1.5, target * 0.03);
  if (v[LBM_LABEL] != null && Math.abs(v[LBM_LABEL] - target) <= tol) return res;

  // 기대 LBM과 일치하는 마지막 토큰을 앵커로
  let k = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (Math.abs(tokens[i].value - target) <= tol) { k = i; break; }
  }
  if (k === -1) { delete v[LBM_LABEL]; return res; } // 틀린 LBM은 비움

  const li = OKOK_METRICS.indexOf(LBM_LABEL);
  const head = alignOnce(tokens.slice(0, k), true, OKOK_METRICS.slice(0, li));
  const tail = alignOnce(tokens.slice(k + 1), true, OKOK_METRICS.slice(li + 1));
  const values = { ...head.values, [LBM_LABEL]: tokens[k].value, ...tail.values };
  return { values, count: head.count + 1 + tail.count };
}

function alignOkokSequence(text) {
  const tokens = extractTokens(text);
  const late = alignOnce(tokens, true);
  const early = alignOnce(tokens, false);
  const score = (r) => r.count + 2 * identityScore(r.values);
  const winner = score(late) >= score(early) ? late : early;
  return repairWithLbmAnchor(tokens, winner);
}

// 테스트/보정용: 두 정렬 후보와 점수를 노출
export function __debugAlign(text) {
  const tokens = extractTokens(text);
  const late = alignOnce(tokens, true);
  const early = alignOnce(tokens, false);
  return {
    tokens,
    late: { ...late, idScore: identityScore(late.values) },
    early: { ...early, idScore: identityScore(early.values) },
  };
}

/**
 * OKOK 스크린샷 OCR 텍스트 → { values:{label:number}, measuredAt }.
 * 줄 기반·순서 정렬 두 패스를 모두 돌려 매칭 수가 많은 쪽을 기본으로 병합.
 * (엔진이 행 단위로 읽으면 패스1, 컬럼 단위로 읽으면 패스2가 이긴다.)
 */
export function parseOkokOcrText(text) {
  const lineRes = lineParse(text);
  const seqRes = alignOkokSequence(text || '');
  const seqOk = seqRes.count >= 8; // 신뢰 하한 미달이면 시퀀스 결과 폐기

  let values;
  if (seqOk && seqRes.count > lineRes.count) {
    values = { ...lineRes.values, ...seqRes.values };
  } else {
    values = { ...(seqOk ? seqRes.values : {}), ...lineRes.values };
  }

  // 교차필드 검증: 신체 구성 값은 체중보다 클 수 없다. 위반 시 비워서
  // 검토 폼에서 직접 입력하게 한다(중복 체중값 오매칭 방지).
  const w = values['체중(Kg)'];
  if (w != null) {
    for (const l of ['지방을 뺀 체중(LBM)(Kg)', '체질 지방량(Kg)', '골격근량(Kg)', '근육량(Kg)', '물의 무게(Kg)']) {
      if (values[l] != null && values[l] >= w) delete values[l];
    }
  }

  // 측정일: yyyy/MM/dd HH:mm:ss (구분자 . - / 혼용 허용)
  let measuredAt = null;
  const dateRe = /(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/;
  const dm = (text || '').match(dateRe);
  if (dm) {
    const [, y, mo, d, h, mi, se] = dm;
    const p = (n) => String(n).padStart(2, '0');
    measuredAt = `${y}/${p(mo)}/${p(d)} ${p(h)}:${mi}:${se || '00'}`;
  }
  return { values, measuredAt };
}

// ── 검토·수정 후 저장 UI ───────────────────────────
/**
 * OCR 결과 검토 카드. 사용자가 값을 확인/수정 후 저장.
 * parsed = { values:{label:number}, measuredAt }
 */
export function okokReviewCard(parsed, { imageUrl, rawText, onSaved } = {}) {
  const card = el('div', { class: 'card card--glow' });
  card.appendChild(el('h2', { class: 'card__title' }, 'OKOK 스크린샷 검토'));
  card.appendChild(el('div', { class: 'muted', style: { marginBottom: '10px', fontSize: '13px' } },
    'OCR로 읽은 값입니다. 틀린 값을 수정한 뒤 저장하세요.'));
  if (imageUrl) {
    card.appendChild(el('img', { src: imageUrl, class: 'ocr-preview' }));
  }

  // 측정일
  const mdInput = el('input', { placeholder: 'yyyy/MM/dd HH:mm:ss', value: parsed.measuredAt || '' });
  card.appendChild(el('label', { class: 'field' }, [el('span', {}, '측정일'), mdInput]));

  // 19개 지표 입력
  const inputs = {};
  const grid = el('div', { class: 'detail-grid' });
  for (const label of OKOK_METRICS) {
    const v = parsed.values[label];
    const di = el('input', {
      type: 'number', inputmode: 'decimal', placeholder: '미인식',
      value: v != null ? String(v) : '',
    });
    if (v == null) di.classList.add('input--missing');
    inputs[label] = di;
    grid.appendChild(el('label', { class: 'field' }, [el('span', {}, label), di]));
  }
  card.appendChild(grid);

  const found = Object.keys(parsed.values).length;
  card.appendChild(el('div', { class: 'faint', style: { margin: '8px 0' } },
    `자동 인식 ${found}/${OKOK_METRICS.length}개 · 빈 칸은 직접 입력하세요.`));

  // 원본 OCR 텍스트 (접이식) — 인식 보정·문의용
  if (rawText) {
    card.appendChild(el('details', { class: 'detail-fold', style: { marginBottom: '12px' } }, [
      el('summary', {}, '원본 OCR 텍스트 보기'),
      el('pre', { class: 'ocr-raw' }, rawText),
    ]));
  }

  card.appendChild(el('button', {
    class: 'btn btn--primary btn--block',
    onClick: () => {
      const weight = inputs['체중(Kg)'].value;
      if (!weight) return toast('체중 값을 확인해주세요.');
      const details = OKOK_METRICS.map((l) => [l, inputs[l].value]);
      let text = buildOkokMemoText({
        weight,
        bodyFat: inputs['지방(%)'].value,
        bmi: inputs['BMI'].value,
        measuredAt: mdInput.value,
        details,
      });
      if (rawText) text += `\n--OCR_RAW--\n${rawText}`; // 원본 보존(표시 시 stripOcrRaw로 제거)
      add(makeEntry({ text, category: CATEGORY.WEIGHT, weightRoute: WEIGHT_ROUTE.OKOK, amount: Number(weight) }));
      toast('OKOK 스크린샷 저장 완료 📷');
      if (onSaved) onSaved();
    },
  }, '체중 저장'));
  return card;
}

// 검토 폼이 채울 표준 지표 순서
export const OKOK_REVIEW_LABELS = OKOK_METRICS;
