// app.js — 라우터 / 탭 네비게이션 / 초기화
import { sessionMode } from './util.js';
import { renderHome } from './session.js';
import { renderWorkout } from './workout.js';
import { renderWeight } from './weight.js';
import { renderSupplement } from './supplement.js';
import { renderSettings } from './settings.js';

const VIEWS = {
  home: { el: 'view-home', render: renderHome },
  workout: { el: 'view-workout', render: renderWorkout },
  weight: { el: 'view-weight', render: renderWeight },
  supplement: { el: 'view-supplement', render: renderSupplement },
  settings: { el: 'view-settings', render: renderSettings },
};

let current = null;

export function navigate(route, opts = {}) {
  if (!VIEWS[route]) route = 'home';
  if (location.hash !== '#' + route) {
    history.replaceState(null, '', '#' + route);
  }
  current = route;

  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.tabbar__btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.route === route)
  );

  const view = VIEWS[route];
  const host = document.getElementById(view.el);
  host.classList.add('active');
  view.render(host, opts);
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

/** 어느 화면에서나 호출 가능한 토스트 */
let toastTimer = null;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function updateHeaderMode() {
  const mode = sessionMode();
  const label =
    mode === 'morning' ? '🌅 오전 모드' : '🌙 저녁 모드';
  document.getElementById('header-mode').textContent = label;
}

function boot() {
  updateHeaderMode();
  setInterval(updateHeaderMode, 60 * 1000);

  document.getElementById('tabbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.tabbar__btn');
    if (btn) navigate(btn.dataset.route);
  });

  window.addEventListener('hashchange', () => {
    const route = location.hash.replace('#', '') || 'home';
    if (route !== current) navigate(route);
  });

  const initial = location.hash.replace('#', '') || 'home';
  navigate(initial);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}

boot();
