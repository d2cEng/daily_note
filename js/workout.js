// workout.js — 운동(WORKOUT) 탭 (참고 문서 §2)
import { CATEGORY } from './model.js';
import { makeEntry } from './model.js';
import { add, getByCategory, remove, update, subscribe } from './store.js';
import { el, clear, fmtDate } from './util.js';
import { navigate, toast } from './app.js';

// ── §2.1 데이터 모델 ───────────────────────────────
export const TYPE = { STRENGTH: 'STRENGTH', CARDIO: 'CARDIO' };

// 머신 카테고리 사전 (참고 §2.2, 순서 고정)
export const WORKOUT_MACHINE_CATEGORIES = [
  { name: 'Cardio', type: TYPE.CARDIO, machines: ['Elliptical', 'Outdoor Run'] },
  { name: 'Chest', type: TYPE.STRENGTH, machines: ['Chest Press', 'Pec Fly'] },
  {
    name: 'Back',
    type: TYPE.STRENGTH,
    machines: ['Lat Pulldown', 'Low Row', 'Vertical Traction', 'Pulley'],
  },
  { name: 'Shoulder', type: TYPE.STRENGTH, machines: ['Shoulder Press'] },
  { name: 'Arm', type: TYPE.STRENGTH, machines: ['Arm Curl', 'Arm Extension'] },
  {
    name: 'Leg',
    type: TYPE.STRENGTH,
    machines: [
      'Leg Press',
      'Leg Extension',
      'Leg Curl',
      'Rotary Calf',
      'Adductor',
      'Abductor',
    ],
  },
  { name: 'Core', type: TYPE.STRENGTH, machines: ['Ab Machine', 'Low Back'] },
  {
    name: 'Free Rack',
    type: TYPE.STRENGTH,
    machines: ['Squat', 'Bench Press', 'Deadlift', 'Overhead Press'],
  },
  // 홈 보유 장비 (로잉머신·벤치·10kg덤벨2·전완근·AB슬라이더·스테퍼)
  {
    name: 'Home',
    type: TYPE.STRENGTH,
    machines: [
      'Rowing Machine', 'Stepper', 'DB Bench Press', 'DB Fly',
      'DB Shoulder Press', 'DB Curl', 'DB Row', 'Goblet Squat',
      'DB Lunge', 'Wrist Curl', 'Ab Roller',
    ],
  },
];

// 유산소 타입인 머신명 (Home 카테고리는 기본 STRENGTH라 예외 처리)
const CARDIO_MACHINES = new Set(['Rowing Machine', 'Stepper']);

// 머신명 → 타입 사전
export const ALL_WORKOUT_MACHINES = (() => {
  const map = {};
  for (const c of WORKOUT_MACHINE_CATEGORIES) {
    for (const m of c.machines) map[m] = CARDIO_MACHINES.has(m) ? TYPE.CARDIO : c.type;
  }
  return map;
})();

// ── §2.4 키워드 추천 ───────────────────────────────
const KEYWORDS = [
  '일립티컬', '트레드밀', '자전거', '실내로잉', '머신', '덤벨',
  '아침식사', '점심식사', '저녁식사', '야식', '회식',
];
export function suggestKeywords(text, max = 7) {
  const tokens = String(text).split(/[\s/,;:|+*=\-\[\](){}]+/);
  const last = (tokens[tokens.length - 1] || '').trim();
  if (!last) return [];
  const lower = last.toLowerCase();
  return KEYWORDS.filter((k) => k.toLowerCase().includes(lower))
    .sort((a, b) => {
      const ap = a.toLowerCase().startsWith(lower) ? 0 : 1;
      const bp = b.toLowerCase().startsWith(lower) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    })
    .slice(0, max);
}

// ── §2.3 인코딩 ────────────────────────────────────
function strengthToken(ex) {
  const sets = ex.sets.filter((s) => s.weightKg !== '' || s.reps !== '');
  if (!sets.length) return null;
  const allSame = sets.every(
    (s) => s.weightKg === sets[0].weightKg && s.reps === sets[0].reps
  );
  if (allSame) {
    return `${ex.machineName} ${sets[0].weightKg}kg x ${sets[0].reps} x ${sets.length}`;
  }
  const parts = sets.map((s) => `${s.weightKg}kg x ${s.reps}`);
  return `${ex.machineName} ${parts.join(' + ')}`;
}

function cardioToken(ex) {
  const dur = String(ex.durationMin || '').trim();
  const dist = String(ex.distanceKm || '').trim();
  if (!dur && !dist) return null;
  let t = ex.machineName;
  if (dur) t += ' ' + (dur.includes(':') ? dur : dur + 'min');
  if (dist) t += ' ' + dist + 'km';
  return t;
}

/** 운동 배열 → [WORKOUT] 본문 (참고 §2.3) */
export function encodeWorkout(exercises) {
  const tokens = exercises
    .map((ex) => (ex.type === TYPE.CARDIO ? cardioToken(ex) : strengthToken(ex)))
    .filter(Boolean);
  return '[WORKOUT] ' + tokens.join(' / ');
}

export function isWorkoutMemoText(text) {
  return String(text).trimStart().startsWith('[WORKOUT]');
}

/** [WORKOUT] 본문 → 운동 배열 (참고 §2.3 역파싱) */
export function parseWorkoutMemoText(text) {
  const body = String(text).replace(/^\s*\[WORKOUT\]\s*/, '');
  if (!body.trim()) return [];
  return body
    .split('/')
    .map((t) => t.trim())
    .filter(Boolean)
    .map(parseToken)
    .filter(Boolean);
}

function parseToken(token) {
  // 근력 (kg 포함)
  if (/kg/i.test(token)) {
    // 균일: machine 50kg x 10 x 3
    const uniform = token.match(
      /^(.+?)\s+(\d+(?:\.\d+)?)kg\s*x\s*(\d+)\s*x\s*(\d+)$/i
    );
    if (uniform) {
      const [, name, kg, reps, count] = uniform;
      const sets = Array.from({ length: +count }, () => ({
        weightKg: kg,
        reps,
      }));
      return { machineName: name.trim(), type: TYPE.STRENGTH, sets, durationMin: '', distanceKm: '' };
    }
    // 가변: machine 50kg x 10 + 45kg x 8
    const setRe = /(\d+(?:\.\d+)?)kg\s*x\s*(\d+)/gi;
    const sets = [];
    let m;
    let firstIdx = -1;
    while ((m = setRe.exec(token))) {
      if (firstIdx === -1) firstIdx = m.index;
      sets.push({ weightKg: m[1], reps: m[2] });
    }
    if (sets.length) {
      const name = token.slice(0, firstIdx).trim();
      return { machineName: name, type: TYPE.STRENGTH, sets, durationMin: '', distanceKm: '' };
    }
  }
  // 유산소: machine 30:00 5km  또는  machine 30min 5km
  const cardio = token.match(
    /^(.+?)\s+(\d+(?::\d+)?|\d+)(?:min)?(?:\s+(\d+(?:\.\d+)?)km)?$/i
  );
  if (cardio && /[:]|min|km/i.test(token)) {
    const [, name, dur, dist] = cardio;
    return {
      machineName: name.trim(),
      type: TYPE.CARDIO,
      sets: [],
      durationMin: dur || '',
      distanceKm: dist || '',
    };
  }
  // 머신명만
  const name = token.trim();
  const type = ALL_WORKOUT_MACHINES[name] || TYPE.STRENGTH;
  return type === TYPE.CARDIO
    ? { machineName: name, type, sets: [], durationMin: '', distanceKm: '' }
    : { machineName: name, type, sets: [{ weightKg: '', reps: '' }], durationMin: '', distanceKm: '' };
}

// ── 운동 에디터 (참고 §2.2) ─────────────────────────
// 재사용 가능: 가이드 세션에서 머신 프리필 후 사용.
export function createWorkoutEditor(host, { initialMachines = [], editEntry = null, onSaved, onCancel } = {}) {
  let activeCat = WORKOUT_MACHINE_CATEGORIES[0].name;
  let exercises = []; // {machineName,type,sets,durationMin,distanceKm}

  function newExercise(machineName, type) {
    return type === TYPE.CARDIO
      ? { machineName, type, sets: [], durationMin: '', distanceKm: '' }
      : { machineName, type, sets: [{ weightKg: '', reps: '' }], durationMin: '', distanceKm: '' };
  }

  function addMachine(machineName, type) {
    if (exercises.some((e) => e.machineName === machineName)) return;
    exercises.push(newExercise(machineName, type));
    render();
  }

  // 프리필: 수정 모드면 기존 항목 복원, 아니면 추천 머신
  if (editEntry) {
    exercises = parseWorkoutMemoText(editEntry.text);
  } else {
    for (const mn of initialMachines) {
      if (ALL_WORKOUT_MACHINES[mn]) addMachine(mn, ALL_WORKOUT_MACHINES[mn]);
    }
  }

  function render() {
    clear(host);

    // 1) 카테고리 칩
    const catRow = el('div', { class: 'chip-row' });
    for (const c of WORKOUT_MACHINE_CATEGORIES) {
      catRow.appendChild(
        el(
          'button',
          {
            class: 'chip' + (c.name === activeCat ? ' active' : ''),
            onClick: () => {
              activeCat = c.name;
              render();
            },
          },
          c.name
        )
      );
    }
    host.appendChild(catRow);

    // 2) 머신 칩
    const cat = WORKOUT_MACHINE_CATEGORIES.find((c) => c.name === activeCat);
    const machineRow = el('div', { class: 'chip-row' });
    for (const m of cat.machines) {
      const added = exercises.some((e) => e.machineName === m);
      machineRow.appendChild(
        el(
          'button',
          {
            class: 'chip' + (added ? ' chip--added' : ''),
            onClick: () => addMachine(m, ALL_WORKOUT_MACHINES[m] || cat.type),
          },
          added ? `✓ ${m}` : m
        )
      );
    }
    host.appendChild(machineRow);

    // 3) 운동 카드
    const list = el('div', { style: { marginTop: '12px' } });
    if (!exercises.length) {
      list.appendChild(
        el('div', { class: 'empty' }, '머신 칩을 눌러 운동을 추가하세요.')
      );
    }
    exercises.forEach((ex, i) => list.appendChild(exerciseCard(ex, i)));
    host.appendChild(list);

    // 저장 (+ 수정 모드면 취소)
    host.appendChild(
      el(
        'button',
        {
          class: 'btn btn--primary btn--block',
          style: { marginTop: '8px' },
          onClick: save,
        },
        editEntry ? '수정 저장' : '운동 저장'
      )
    );
    if (editEntry && onCancel) {
      host.appendChild(
        el('button', {
          class: 'btn btn--ghost btn--block',
          style: { marginTop: '8px' },
          onClick: onCancel,
        }, '취소')
      );
    }
  }

  function exerciseCard(ex, i) {
    const card = el('div', { class: 'ex-card' });
    const head = el('div', { class: 'ex-card__head' }, [
      el('b', {}, ex.machineName),
      el(
        'span',
        {
          class: 'badge ' + (ex.type === TYPE.CARDIO ? 'tag-cardio' : 'tag-strength'),
          style: { marginLeft: '8px' },
        },
        ex.type === TYPE.CARDIO ? '유산소' : '근력'
      ),
      el(
        'button',
        {
          class: 'x',
          style: { marginLeft: 'auto' },
          onClick: () => {
            exercises.splice(i, 1);
            render();
          },
        },
        '✕'
      ),
    ]);
    card.appendChild(head);

    if (ex.type === TYPE.CARDIO) {
      card.appendChild(cardioEditor(ex));
    } else {
      card.appendChild(strengthEditor(ex));
    }
    return card;
  }

  function strengthEditor(ex) {
    const box = el('div');
    ex.sets.forEach((s, si) => {
      const row = el('div', { class: 'set-row' }, [
        el('span', { class: 'idx' }, String(si + 1)),
        el('input', {
          type: 'number',
          inputmode: 'decimal',
          placeholder: 'kg',
          value: s.weightKg,
          onInput: (e) => (s.weightKg = e.target.value),
        }),
        el('span', { class: 'muted' }, '×'),
        el('input', {
          type: 'number',
          inputmode: 'numeric',
          placeholder: '회',
          value: s.reps,
          onInput: (e) => (s.reps = e.target.value),
        }),
        ex.sets.length > 1
          ? el(
              'button',
              {
                class: 'x',
                onClick: () => {
                  ex.sets.splice(si, 1);
                  render();
                },
              },
              '−'
            )
          : el('span', { style: { width: '24px' } }),
      ]);
      box.appendChild(row);
    });
    box.appendChild(
      el(
        'button',
        {
          class: 'btn btn--ghost btn--sm',
          onClick: () => {
            const last = ex.sets[ex.sets.length - 1] || { weightKg: '', reps: '' };
            ex.sets.push({ weightKg: last.weightKg, reps: last.reps });
            render();
          },
        },
        '+ 세트 추가'
      )
    );
    return box;
  }

  function cardioEditor(ex) {
    const minInput = el('input', {
      type: 'number',
      inputmode: 'numeric',
      placeholder: '분',
      value: ex.durationMin.split(':')[0] || '',
    });
    const secInput = el('input', {
      type: 'number',
      inputmode: 'numeric',
      placeholder: '초',
      value: ex.durationMin.split(':')[1] || '',
    });
    const sync = () => {
      const mm = minInput.value || '0';
      const ss = secInput.value;
      ex.durationMin = ss !== '' ? `${mm}:${String(ss).padStart(2, '0')}` : mm;
    };
    minInput.addEventListener('input', () => {
      sync();
      if (minInput.value.length >= 2) secInput.focus();
    });
    secInput.addEventListener('input', sync);
    const kmInput = el('input', {
      type: 'number',
      inputmode: 'decimal',
      placeholder: 'km',
      value: ex.distanceKm,
      onInput: (e) => (ex.distanceKm = e.target.value),
    });
    return el('div', { class: 'set-row' }, [
      minInput,
      el('span', { class: 'muted' }, ':'),
      secInput,
      el('span', { style: { width: '6px' } }),
      kmInput,
    ]);
  }

  function save() {
    if (!exercises.length) {
      toast('운동 항목을 추가해주세요.');
      return;
    }
    const text = encodeWorkout(exercises);
    if (text.replace('[WORKOUT]', '').trim() === '') {
      toast('운동 데이터를 입력해주세요.');
      return;
    }
    if (editEntry) {
      update(editEntry.id, { text });
      toast('운동 수정 완료 ✏️');
    } else {
      add(makeEntry({ text, category: CATEGORY.WORKOUT }));
      toast('운동 저장 완료 💪');
      exercises = [];
      render();
    }
    if (onSaved) onSaved(text);
  }

  render();
  return {
    addMachine,
    getExercises: () => exercises,
  };
}

// ── 운동 탭 렌더 ────────────────────────────────────
let unsub = null;
export function renderWorkout(host) {
  if (unsub) unsub();
  clear(host);

  let editingId = null;

  const editorCard = el('div', { class: 'card card--glow' });
  const editorTitle = el('h2', { class: 'card__title' }, '운동 편집');
  const editorHost = el('div');
  editorCard.appendChild(editorTitle);
  editorCard.appendChild(editorHost);
  host.appendChild(editorCard);

  const historyHost = el('div');

  const drawEditor = () => {
    clear(editorHost);
    const entry = editingId
      ? getByCategory(CATEGORY.WORKOUT).find((e) => e.id === editingId)
      : null;
    editorTitle.textContent = entry ? `운동 수정 · ${fmtDate(entry.createdAt)}` : '운동 편집';
    editorCard.classList.toggle('card--glow', true);
    createWorkoutEditor(editorHost, {
      editEntry: entry,
      onSaved: () => { editingId = null; drawEditor(); renderHistory(); },
      onCancel: () => { editingId = null; drawEditor(); },
    });
  };

  const startEdit = (entry) => {
    editingId = entry.id;
    drawEditor();
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  drawEditor();

  host.appendChild(el('div', { class: 'section-title' }, '운동 이력'));
  host.appendChild(historyHost);

  const renderHistory = () => {
    clear(historyHost);
    const items = getByCategory(CATEGORY.WORKOUT);
    if (!items.length) {
      historyHost.appendChild(
        el('div', { class: 'empty' }, '아직 기록된 운동이 없습니다.')
      );
      return;
    }
    for (const entry of items) {
      historyHost.appendChild(workoutHistoryCard(entry, renderHistory, startEdit));
    }
  };
  renderHistory();
  unsub = subscribe(renderHistory);
}

function workoutHistoryCard(entry, refresh, onEdit) {
  const exercises = parseWorkoutMemoText(entry.text);
  const card = el('div', { class: 'entry' });
  card.appendChild(
    el('div', { class: 'entry__head' }, [
      el('span', { class: 'badge tag-strength' }, '운동'),
      el('span', { class: 'entry__date' }, fmtDate(entry.createdAt)),
      el(
        'button',
        {
          class: 'x',
          title: '수정',
          onClick: () => onEdit && onEdit(entry),
        },
        '✎'
      ),
      el(
        'button',
        {
          class: 'x',
          title: '삭제',
          onClick: () => {
            remove(entry.id);
            refresh();
          },
        },
        '✕'
      ),
    ])
  );
  const lines = exercises.map((ex) => {
    if (ex.type === TYPE.CARDIO) {
      const d = [ex.durationMin, ex.distanceKm ? ex.distanceKm + 'km' : '']
        .filter(Boolean)
        .join(' · ');
      return `${ex.machineName} — ${d || '유산소'}`;
    }
    const setStr = ex.sets
      .map((s) => `${s.weightKg || 0}kg×${s.reps || 0}`)
      .join(', ');
    return `${ex.machineName} — ${setStr}`;
  });
  for (const ln of lines) {
    card.appendChild(
      el('div', { class: 'muted', style: { fontSize: '13.5px' } }, ln)
    );
  }
  return card;
}