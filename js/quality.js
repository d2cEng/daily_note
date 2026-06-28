// quality.js — OKOK 데이터 품질 / 이상치 검출 (참고 §1.8)
import { WEIGHT_ROUTE } from './model.js';
import { OKOK_METRICS, detectWeightInputRoute, extractWeightMetricValue } from './weight.js';

// ── 검출 실패 (OKOK 한정) ───────────────────────────
// 측정일 누락 + 19개 지표 중 비어있는 라벨 목록
export function detectWeightDataIssue(entry) {
  if (detectWeightInputRoute(entry) !== WEIGHT_ROUTE.OKOK) return null;
  const text = entry.text || '';
  const measuredMissing = !/측정일\s+\d/.test(text);
  const missing = OKOK_METRICS.filter(
    (label) => extractWeightMetricValue(text, label) == null
  );
  if (!measuredMissing && missing.length === 0) return null;
  return { measuredMissing, missing };
}

// 요약 문자열: "측정일 누락 / 상세 누락 5개 (라벨1, 라벨2, 라벨3 외 2개)"
export function summarizeIssue(issue) {
  const parts = [];
  if (issue.measuredMissing) parts.push('측정일 누락');
  if (issue.missing.length) {
    const head = issue.missing.slice(0, 3).join(', ');
    const extra = issue.missing.length > 3 ? ` 외 ${issue.missing.length - 3}개` : '';
    parts.push(`상세 누락 ${issue.missing.length}개 (${head}${extra})`);
  }
  return parts.join(' / ');
}

// ── 라벨별 최소 스프레드 (참고 §1.8) ────────────────
export function minimumOutlierSpread(label, median) {
  if (label === '기초대사') return 180;
  if (label === '대사 연령') return 4;
  if (label === 'BMI') return 1.2;
  if (label === '신장(cm)' || label === '실제 나이') return 3;
  if (/\(%\)|비율|기록\(%\)/.test(label) || label.endsWith('(%)')) return 3;
  if (/\(Kg\)|\(kg\)/.test(label)) return Math.max(0.8, Math.abs(median) * 0.04);
  return Math.max(0.8, Math.abs(median) * 0.04);
}

// ── 통계 유틸 ──────────────────────────────────────
function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

/**
 * 이상치 검출 (참고 §1.8).
 * entries 전체에서 라벨별로 값을 모아 robust 범위를 벗어난 값을 표시.
 * 반환: Map<entryId, Array<{label, value, range:[lo,hi]}>>
 */
export function detectWeightOutlierIssues(entries) {
  // 라벨별 값 수집: [{id, value}]
  const byLabel = {};
  const labels = ['체중(Kg)', ...OKOK_METRICS];
  for (const e of entries) {
    for (const label of labels) {
      const v = extractWeightMetricValue(e.text || '', label);
      if (v != null) (byLabel[label] ||= []).push({ id: e.id, value: v });
    }
  }

  const result = new Map();
  for (const [label, rows] of Object.entries(byLabel)) {
    const values = rows.map((r) => r.value);
    if (values.length < 10) continue; // 최소 10개 이상이어야 판정

    const med = median(values);
    const mad = median(values.map((v) => Math.abs(v - med)));
    const minSpread = minimumOutlierSpread(label, med);

    let lo, hi;
    if (mad > 0) {
      const spread = Math.max(mad * 1.4826 * 4, minSpread);
      lo = med - spread; hi = med + spread;
    } else {
      // MAD=0 → IQR 폴백
      const sorted = values.slice().sort((a, b) => a - b);
      const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75);
      const iqr = q3 - q1;
      lo = q1 - 2 * iqr; hi = q3 + 2 * iqr;
    }

    // 값별 등장 횟수
    const freq = {};
    for (const v of values) freq[v] = (freq[v] || 0) + 1;

    for (const { id, value } of rows) {
      // 범위 밖 + 같은 값이 2건 미만으로만 등장
      if ((value < lo || value > hi) && freq[value] < 2) {
        const arr = result.get(id) || [];
        arr.push({ label, value, range: [lo, hi] });
        result.set(id, arr);
      }
    }
  }
  return result;
}
