// util.js — DOM / 날짜 / 포맷 헬퍼

/** 간단한 DOM 생성기: el('div', {class:'x'}, [children]) */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

const pad = (n) => String(n).padStart(2, '0');

/** Date|ms → 'yyyy/MM/dd HH:mm:ss' (측정일 토큰 포맷, 참고 §1.4) */
export function fmtDateTime(ms) {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** 'yyyy-MM-dd' */
export function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'yyyy년 M월' (참고 §1.7) */
export function fmtYearMonth(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

/** 부호 표기 (+1.2) */
export function signed(n, digits = 1) {
  const v = Number(n);
  if (!isFinite(v)) return '–';
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

/**
 * 다양한 측정일 포맷 파싱 (참고 §1.4) →  ms 또는 null
 * 허용: yyyy-M-d H:mm[:ss], 구분자 / . - 혼용.
 */
export function parseMeasuredAt(str) {
  if (!str) return null;
  const m = String(str)
    .trim()
    .match(
      /(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})[\sT]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/
    );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const dt = new Date(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
  return isNaN(dt.getTime()) ? null : dt.getTime();
}

/** 오전/저녁 모드 판별 (사용자 제약: 8시 전 / 19시 이후) */
export function sessionMode(date = new Date()) {
  const h = date.getHours();
  if (h < 8) return 'morning';
  if (h >= 19) return 'evening';
  // 그 외 시간: 가까운 쪽을 기본 제안하되 수동 선택 허용
  return h < 13 ? 'morning' : 'evening';
}

/** 숫자만 추출 (안전) */
export function num(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  return isFinite(n) ? n : null;
}

/** 파일 다운로드 트리거 */
export function downloadFile(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
