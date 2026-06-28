// inbody.js — InBody CSV 가져오기 (참고 §1.9)
// 헤더: 날짜,측정장비,체중(kg),골격근량(kg),근육량(kg),체지방량(kg),BMI(kg/m²),체지방률(%),기초대사량(kcal),...
import { CATEGORY } from './model.js';

// yyyyMMddHHmmss → {ms, measuredAt 'yyyy/MM/dd HH:mm:ss'}
function parseInbodyDate(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const ms = new Date(+y, +mo - 1, +d, +h, +mi, +se).getTime();
  return { ms, measuredAt: `${y}/${mo}/${d} ${h}:${mi}:${se}` };
}

// 간단한 CSV 행 분할 (InBody 내보내기는 따옴표 미사용, 콤마 구분)
function splitCsvLine(line) {
  return line.split(',').map((c) => c.trim());
}

/**
 * InBody CSV → MemoEntry[] (INBODY 루트).
 * 모든 컬럼을 `라벨 값` 토큰으로 인코딩해 인사이트 지표로 활용.
 */
export function parseInbodyCsv(text) {
  const lines = (text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]);
  const iDate = header.indexOf('날짜');
  const iWeight = header.findIndex((h) => /^체중\(kg\)/.test(h));
  if (iDate === -1 || iWeight === -1) {
    throw new Error('InBody CSV 형식이 아닙니다 (날짜/체중 컬럼 없음).');
  }
  // 토큰화에서 제외할 컬럼 + 결측 표기
  const skipCols = new Set(['날짜', '측정장비']);
  const isMissing = (v) => v === '' || v === '-' || v == null;

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const dt = parseInbodyDate(cells[iDate]);
    const weight = cells[iWeight];
    if (!dt || isMissing(weight)) continue;

    const parts = ['[INBODY]', `체중 ${weight}kg`];
    for (let c = 0; c < header.length; c++) {
      const label = header[c];
      if (skipCols.has(label)) continue;
      const val = cells[c];
      if (isMissing(val)) continue;
      parts.push(`${label} ${val}`);
    }
    parts.push(`측정일 ${dt.measuredAt}`);

    out.push({
      id: `inbody-${cells[iDate]}`, // 측정시각 기반 안정적 id → 재가져오기 중복 방지
      createdAt: dt.ms,
      category: CATEGORY.WEIGHT,
      weightRoute: 'INBODY',
      text: parts.join(' / '),
      amount: Number(weight),
    });
  }
  return out;
}
