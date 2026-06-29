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
const BOUNDS = {
  '체중(Kg)': [20, 300], 'BMI': [5, 60], '지방(%)': [1, 70],
  '체질 지방량(Kg)': [1, 200], '골격근 비율(%)': [5, 80], '골격근량(Kg)': [5, 120],
  '근육 기록(%)': [1, 200], '근육량(Kg)': [5, 200], '수분(%)': [20, 80],
  '물의 무게(Kg)': [5, 150], '내장지방': [1, 60], '골격 기록(Kg)': [0.5, 12],
  '기초대사': [500, 4000], '단백질(%)': [1, 40], '비만도(%)': [1, 400],
  '대사 연령': [1, 120], '지방을 뺀 체중(LBM)(Kg)': [5, 220],
  '실제 나이': [1, 120], '신장(cm)': [50, 250],
};
function inBounds(label, v) {
  const b = BOUNDS[label];
  return !b || (v >= b[0] && v <= b[1]);
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

/**
 * OKOK 스크린샷 OCR 텍스트 → { values:{label:number}, measuredAt }.
 * 각 라벨에 대해 키워드 매칭 줄에서 라벨 바로 뒤 첫 숫자를 추출하고,
 * 타당 범위를 통과하는 값만 채택(뒤쪽 상태어/화살표는 무시).
 */
export function parseOkokOcrText(text) {
  const lines = (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const values = {};
  const used = new Set();

  for (const [label, keys] of LABEL_KEYS) {
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      const end = keywordEnd(lines[i], keys);
      if (end === -1) continue;
      const v = firstNumber(lines[i].slice(end));
      if (v != null && inBounds(label, v)) { values[label] = v; used.add(i); break; }
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
