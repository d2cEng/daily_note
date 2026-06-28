// chart.js — SVG 시간축 멀티라인 추세 차트 (참고 §1.6)
import { WEIGHT_ROUTE_COLOR } from './model.js';
import { el, fmtDateTime, fmtDate } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/**
 * points: [{ t:ms, value:number, route:'MANUAL'|'INBODY'|'OKOK', label:string }]
 * X축 = 시간, Y축 = 값(min~max 정규화). 루트별로 선을 분리해 색칠.
 */
export function renderTrendChart(points, { selectedDay = null, onSelectDate = null } = {}) {
  const wrap = el('div', { class: 'chart-wrap' });
  if (!points || points.length === 0) {
    wrap.appendChild(el('div', { class: 'empty' }, '표시할 데이터가 없습니다.'));
    return wrap;
  }

  const W = 680, H = 280;
  const padL = 44, padR = 16, padT = 18, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const ts = points.map((p) => p.t);
  const vs = points.map((p) => p.value);
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  let vMin = Math.min(...vs), vMax = Math.max(...vs);
  if (vMin === vMax) { vMin -= 1; vMax += 1; }
  const tSpan = tMax - tMin || 1;
  const vSpan = vMax - vMin || 1;

  const X = (t) => padL + ((t - tMin) / tSpan) * plotW;
  const Y = (v) => padT + (1 - (v - vMin) / vSpan) * plotH;

  const svg = svgEl('svg', {
    class: 'trend',
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'xMidYMid meet',
  });

  // 가로 그리드 + Y 눈금
  for (let i = 0; i <= 4; i++) {
    const v = vMin + (vSpan * i) / 4;
    const y = Y(v);
    svg.appendChild(svgEl('line', {
      x1: padL, y1: y, x2: W - padR, y2: y,
      stroke: '#1c2536', 'stroke-width': 1,
    }));
    const txt = svgEl('text', {
      x: padL - 6, y: y + 4, fill: '#5e6b85', 'font-size': 10, 'text-anchor': 'end',
    });
    txt.textContent = v.toFixed(1);
    svg.appendChild(txt);
  }

  // 루트별 폴리라인
  const byRoute = {};
  for (const p of points) (byRoute[p.route] ||= []).push(p);
  for (const [route, pts] of Object.entries(byRoute)) {
    pts.sort((a, b) => a.t - b.t);
    const color = WEIGHT_ROUTE_COLOR[route] || '#9E9E9E';
    if (pts.length > 1) {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
      svg.appendChild(svgEl('path', {
        d, fill: 'none', stroke: color, 'stroke-width': 2.5,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        style: `filter: drop-shadow(0 0 6px ${color}88)`,
      }));
    }
  }

  // 최고/최저 라벨
  const maxP = points.reduce((a, b) => (b.value > a.value ? b : a));
  const minP = points.reduce((a, b) => (b.value < a.value ? b : a));

  // 포인트
  for (const p of points) {
    const color = WEIGHT_ROUTE_COLOR[p.route] || '#9E9E9E';
    const isSel = selectedDay && fmtDate(p.t) === selectedDay;
    const c = svgEl('circle', {
      cx: X(p.t), cy: Y(p.value), r: isSel ? 6.5 : 4,
      fill: isSel ? color : '#0b0e14', stroke: color, 'stroke-width': 2,
      style: 'cursor:pointer' + (isSel ? `;filter:drop-shadow(0 0 6px ${color})` : ''),
    });
    const title = svgEl('title');
    title.textContent = `${fmtDateTime(p.t)} [${p.route}] ${p.value}`;
    c.appendChild(title);
    if (onSelectDate) c.addEventListener('click', () => onSelectDate(fmtDate(p.t)));
    svg.appendChild(c);
  }

  for (const ext of [maxP, minP]) {
    const t = svgEl('text', {
      x: Math.min(Math.max(X(ext.t), padL + 14), W - padR - 14),
      y: Y(ext.value) - 9,
      fill: '#e7ecf5', 'font-size': 10, 'font-weight': 700, 'text-anchor': 'middle',
    });
    t.textContent = ext.value.toFixed(1);
    svg.appendChild(t);
  }

  // X축 눈금 3개
  const fmtShort = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  };
  [tMin, tMin + tSpan / 2, tMax].forEach((t, i) => {
    const txt = svgEl('text', {
      x: i === 0 ? padL : i === 2 ? W - padR : padL + plotW / 2,
      y: H - 8, fill: '#5e6b85', 'font-size': 10,
      'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle',
    });
    txt.textContent = fmtShort(t);
    svg.appendChild(txt);
  });

  wrap.appendChild(svg);
  return wrap;
}