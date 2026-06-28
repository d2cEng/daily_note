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

/** 이미지 파일 → OCR 텍스트. onProgress(0..1) 선택. */
export async function ocrImage(file, onProgress) {
  if (_recognizer) return _recognizer(file);
  const T = await loadTesseract();
  const { data } = await T.recognize(file, 'kor+eng', {
    logger: (m) => {
      if (onProgress && m.status === 'recognizing text') onProgress(m.progress);
    },
  });
  return data.text;
}

// ── OCR 텍스트 파싱 ────────────────────────────────
// 숫자 주변 흔한 오인식 글자 교정 (참고 §1.4)
function fixDigits(s) {
  return s
    .replace(/[Oo]/g, '0').replace(/[IlｌＩ]/g, '1')
    .replace(/[Ss]/g, '5').replace(/[Bb]/g, '8')
    .replace(/[^0-9.,\-]/g, '');
}
function toNum(raw) {
  const f = fixDigits(raw).replace(',', '.').replace(/\.(?=.*\.)/g, '');
  const n = parseFloat(f);
  return isFinite(n) ? n : null;
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

function lineMatchesKeys(line, keys) {
  return keys.every((k) => line.includes(k));
}

/**
 * OKOK 스크린샷 OCR 텍스트 → { values:{label:number}, measuredAt }.
 * 라인 단위로 라벨 키워드 + 끝 숫자를 매칭. 검토 폼 프리필용.
 */
export function parseOkokOcrText(text) {
  const lines = (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const values = {};
  const used = new Set();

  for (const [label, keys] of LABEL_KEYS) {
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      const line = lines[i];
      if (!lineMatchesKeys(line, keys)) continue;
      // 줄 끝의 숫자 토큰 추출
      const m = line.match(/(-?[\dOoIlSsBb][\dOoIlSsBb.,]*)\s*$/);
      const v = m ? toNum(m[1]) : null;
      if (v != null) { values[label] = v; used.add(i); break; }
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
export function okokReviewCard(parsed, { imageUrl, onSaved } = {}) {
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

  card.appendChild(el('button', {
    class: 'btn btn--primary btn--block',
    onClick: () => {
      const weight = inputs['체중(Kg)'].value;
      if (!weight) return toast('체중 값을 확인해주세요.');
      const details = OKOK_METRICS.map((l) => [l, inputs[l].value]);
      const text = buildOkokMemoText({
        weight,
        bodyFat: inputs['지방(%)'].value,
        bmi: inputs['BMI'].value,
        measuredAt: mdInput.value,
        details,
      });
      add(makeEntry({ text, category: CATEGORY.WEIGHT, weightRoute: WEIGHT_ROUTE.OKOK, amount: Number(weight) }));
      toast('OKOK 스크린샷 저장 완료 📷');
      if (onSaved) onSaved();
    },
  }, '체중 저장'));
  return card;
}

// 검토 폼이 채울 표준 지표 순서
export const OKOK_REVIEW_LABELS = OKOK_METRICS;
