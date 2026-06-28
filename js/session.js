// session.js — "오늘의 세션" 가이드 플로우 (홈)
import { CATEGORY, makeEntry } from './model.js';
import { add } from './store.js';
import { el, clear, sessionMode, num } from './util.js';
import { toast, navigate } from './app.js';
import { recommendationCard, SUPPLEMENTS } from './supplement.js';
import { recommendWorkout } from './recommend.js';
import { createWorkoutEditor } from './workout.js';

const TOTAL_STEPS = 6;

export function renderHome(host) {
  const state = {
    step: 1,
    mode: sessionMode(),
    suppLogged: null, // 보충제 객체
    suppAt: null,
    routine: null,
    workoutSaved: false,
    weightSaved: false,
    startedAt: Date.now(),
  };

  function setStep(n) {
    state.step = Math.max(state.step, n);
    render();
  }

  function render() {
    clear(host);

    // 진행 표시
    const steps = el('div', { class: 'steps' });
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      steps.appendChild(el('div', { class: 'seg' + (i < state.step ? ' done' : '') }));
    }
    host.appendChild(steps);
    host.appendChild(el('div', { class: 'faint', style: { marginBottom: '12px' } },
      `오늘의 세션 · ${state.step}/${TOTAL_STEPS} 단계`));

    stepStart();
    if (state.step >= 2) stepSupplement();
    if (state.step >= 3) stepRecommend();
    if (state.step >= 4) stepWorkout();
    if (state.step >= 5) stepWeight();
    if (state.step >= 6) stepSummary();
  }

  // ── 1) 세션 시작 ──
  function stepStart() {
    const card = el('div', { class: 'card' + (state.step === 1 ? ' card--glow' : '') });
    card.appendChild(stepTitle(1, '세션 시작'));
    card.appendChild(el('div', { class: 'muted', style: { marginBottom: '10px' } },
      '오늘 운동 시간대를 확인하세요. 보충제·운동 추천이 시간대에 맞춰 바뀝니다.'));
    const seg = el('div', { class: 'segment' });
    for (const [m, label] of [['morning', '🌅 오전 (8시 전)'], ['evening', '🌙 저녁 (19시 이후)']]) {
      seg.appendChild(el('button', {
        'data-route': m === 'morning' ? 'INBODY' : 'OKOK',
        class: state.mode === m ? 'active' : '',
        onClick: () => { state.mode = m; render(); },
      }, label));
    }
    card.appendChild(seg);
    if (state.step === 1) {
      card.appendChild(el('button', {
        class: 'btn btn--primary btn--block',
        onClick: () => setStep(2),
      }, '시작하기 →'));
    }
    host.appendChild(card);
  }

  // ── 2) 보충제 추천 + 기록 ──
  function stepSupplement() {
    host.appendChild(stepHeader(2, '보충제'));
    const wrap = el('div');
    wrap.appendChild(recommendationCard(state.mode, {
      onLogged: (sup) => {
        state.suppLogged = sup;
        state.suppAt = Date.now();
        render();
        startTimer();
      },
    }));
    host.appendChild(wrap);
    if (state.suppLogged && state.step === 2) {
      host.appendChild(timerCard());
    }
  }

  // 25분 운동 시작 타이머
  let timerInt = null;
  function startTimer() {
    clearInterval(timerInt);
  }
  function timerCard() {
    const card = el('div', { class: 'card card--glow' });
    card.appendChild(el('div', { class: 'faint' }, '⏱ 효과 대기 — 약 25분 후 운동 시작 권장'));
    const display = el('div', { class: 'timer' }, '25:00');
    card.appendChild(display);
    const target = state.suppAt + 25 * 60 * 1000;
    const tick = () => {
      const left = Math.max(0, target - Date.now());
      const mm = Math.floor(left / 60000);
      const ss = Math.floor((left % 60000) / 1000);
      display.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
      if (left <= 0) { clearInterval(timerInt); display.textContent = '준비 완료 🔥'; }
    };
    clearInterval(timerInt);
    timerInt = setInterval(tick, 1000);
    tick();
    card.appendChild(el('button', {
      class: 'btn btn--block',
      style: { marginTop: '10px' },
      onClick: () => setStep(3),
    }, '운동 추천 보기 →'));
    return card;
  }

  // ── 3) 운동 추천 ──
  function stepRecommend() {
    host.appendChild(stepHeader(3, '운동 추천'));
    state.routine = state.routine || recommendWorkout(state.mode);
    const r = state.routine;
    const card = el('div', { class: 'card' + (state.step === 3 ? ' card--glow' : '') });
    card.appendChild(el('div', { class: 'faint' }, '오늘의 추천 분할'));
    card.appendChild(el('div', { style: { fontWeight: '800', fontSize: '17px', marginBottom: '8px' } }, r.split));
    for (const m of r.machines) {
      card.appendChild(el('div', { class: 'set-row', style: { borderBottom: '1px solid var(--border-soft)', paddingBottom: '6px' } }, [
        el('span', { class: 'badge ' + (m.type === 'CARDIO' ? 'tag-cardio' : 'tag-strength') }, m.type === 'CARDIO' ? '유산소' : '근력'),
        el('b', { style: { flex: 'none', minWidth: '120px' } }, m.name),
        el('span', { class: 'muted', style: { fontSize: '12.5px' } }, m.guide),
      ]));
    }
    card.appendChild(el('div', { class: 'note' }, r.note));
    if (state.step === 3) {
      card.appendChild(el('button', {
        class: 'btn btn--primary btn--block',
        style: { marginTop: '12px' },
        onClick: () => setStep(4),
      }, '이 루틴으로 기록 시작 →'));
    }
    host.appendChild(card);
  }

  // ── 4) 운동 기록 ──
  function stepWorkout() {
    host.appendChild(stepHeader(4, '운동 기록'));
    const card = el('div', { class: 'card' + (state.step === 4 ? ' card--glow' : '') });
    if (state.workoutSaved) {
      card.appendChild(el('div', { class: 'muted' }, '✓ 운동 기록 저장됨'));
    } else {
      const editorHost = el('div');
      card.appendChild(editorHost);
      const machines = (state.routine?.machines || []).map((m) => m.name);
      createWorkoutEditor(editorHost, {
        initialMachines: machines,
        onSaved: () => { state.workoutSaved = true; setStep(5); },
      });
    }
    host.appendChild(card);
  }

  // ── 5) (선택) 체중 기록 ──
  function stepWeight() {
    host.appendChild(stepHeader(5, '체중 기록 (선택)'));
    const card = el('div', { class: 'card' + (state.step === 5 ? ' card--glow' : '') });
    if (state.weightSaved) {
      card.appendChild(el('div', { class: 'muted' }, '✓ 체중 기록 저장됨'));
    } else {
      const input = el('input', { type: 'number', inputmode: 'decimal', placeholder: '예: 72.4 (kg)' });
      card.appendChild(el('label', { class: 'field' }, [el('span', {}, '오늘 체중'), input]));
      card.appendChild(el('div', { class: 'btn-row' }, [
        el('button', {
          class: 'btn btn--primary',
          onClick: () => {
            const v = num(input.value);
            if (v == null) return toast('체중을 입력해주세요.');
            add(makeEntry({ text: `${v}kg`, category: CATEGORY.WEIGHT, weightRoute: 'MANUAL', amount: v }));
            state.weightSaved = true;
            toast('체중 저장 완료 ⚖️');
            setStep(6);
          },
        }, '저장'),
        el('button', { class: 'btn btn--ghost', onClick: () => setStep(6) }, '건너뛰기'),
      ]));
    }
    host.appendChild(card);
  }

  // ── 6) 세션 요약 ──
  function stepSummary() {
    const mins = Math.round((Date.now() - state.startedAt) / 60000);
    const card = el('div', { class: 'card card--glow' });
    card.appendChild(el('h2', { class: 'card__title' }, '🎉 세션 요약'));
    const rows = [
      ['시간대', state.mode === 'morning' ? '🌅 오전' : '🌙 저녁'],
      ['보충제', state.suppLogged ? state.suppLogged.name : '기록 안 함'],
      ['운동', state.workoutSaved ? `${state.routine?.split || ''} 완료` : '기록 안 함'],
      ['체중', state.weightSaved ? '기록함' : '건너뜀'],
      ['소요 시간', `약 ${mins}분`],
    ];
    for (const [k, v] of rows) {
      card.appendChild(el('div', { class: 'set-row' }, [
        el('span', { class: 'muted', style: { flex: 'none', minWidth: '90px' } }, k),
        el('b', {}, v),
      ]));
    }
    card.appendChild(el('div', { class: 'btn-row', style: { marginTop: '14px' } }, [
      el('button', { class: 'btn btn--primary', onClick: () => navigate('weight') }, '체중 추세 보기'),
      el('button', { class: 'btn btn--ghost', onClick: () => location.reload() }, '새 세션'),
    ]));
    host.appendChild(card);
  }

  // ── 헬퍼 ──
  function stepTitle(n, label) {
    return el('h2', { class: 'card__title' }, [
      el('span', { class: 'step-no' }, String(n)), label,
    ]);
  }
  function stepHeader(n, label) {
    return el('div', { class: 'section-title' }, `STEP ${n} · ${label}`);
  }

  render();
}
