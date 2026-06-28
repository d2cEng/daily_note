// recommend.js — 운동 추천 엔진 (최근 이력 기반 분할)
import { CATEGORY } from './model.js';
import { getByCategory } from './store.js';
import {
  WORKOUT_MACHINE_CATEGORIES,
  ALL_WORKOUT_MACHINES,
  parseWorkoutMemoText,
  TYPE,
} from './workout.js';

// 근육군 분할 그룹 (균형 잡힌 추천용)
const SPLITS = [
  { name: 'Push (가슴·어깨)', cats: ['Chest', 'Shoulder'] },
  { name: 'Pull (등·팔)', cats: ['Back', 'Arm'] },
  { name: 'Legs (하체·코어)', cats: ['Leg', 'Core'] },
];

/**
 * 최근 운동 이력에서 각 카테고리의 마지막 훈련 시각을 구한다.
 */
function lastTrained() {
  const map = {};
  const entries = getByCategory(CATEGORY.WORKOUT);
  for (const e of entries) {
    const exs = parseWorkoutMemoText(e.text);
    for (const ex of exs) {
      const cat = WORKOUT_MACHINE_CATEGORIES.find((c) =>
        c.machines.includes(ex.machineName)
      );
      if (cat) {
        map[cat.name] = Math.max(map[cat.name] || 0, e.createdAt);
      }
    }
  }
  return map;
}

/**
 * 오늘의 추천. mode: 'morning' | 'evening'
 * 반환: { split, focusCats, machines:[{name,type,guide}], note }
 */
export function recommendWorkout(mode = 'evening') {
  const last = lastTrained();

  // 가장 오래 안 한 그룹 선택 (이력 없으면 첫 분할)
  let best = SPLITS[0];
  let bestTime = Infinity;
  for (const sp of SPLITS) {
    const t = Math.min(...sp.cats.map((c) => last[c] || 0));
    if (t < bestTime) { bestTime = t; best = sp; }
  }

  const isMorning = mode === 'morning';
  const machines = [];

  // 오전: 유산소 1종 우선 + 가벼운 근력 / 저녁: 근력 위주
  if (isMorning) {
    machines.push({
      name: 'Elliptical', type: TYPE.CARDIO,
      guide: '워밍업 겸 20–25분, 가벼운~중간 강도',
    });
  }

  for (const catName of best.cats) {
    const cat = WORKOUT_MACHINE_CATEGORIES.find((c) => c.name === catName);
    const pick = cat.machines.slice(0, isMorning ? 1 : 2);
    for (const m of pick) {
      machines.push({
        name: m, type: ALL_WORKOUT_MACHINES[m],
        guide: isMorning ? '3세트 × 12–15회 (가볍게)' : '4세트 × 8–12회',
      });
    }
  }

  if (!isMorning) {
    machines.push({
      name: 'Outdoor Run', type: TYPE.CARDIO,
      guide: '마무리 유산소 15–20분 (선택)',
    });
  }

  const note = isMorning
    ? '오전엔 관절 부담을 줄이도록 가볍게 시작하고 유산소 비중을 높였습니다.'
    : '저녁엔 근력 비중을 높였습니다. 충분한 수분과 보충제 섭취 후 시작하세요.';

  return {
    split: best.name,
    focusCats: best.cats,
    machines,
    note,
  };
}

// ── 홈트레이닝 추천 (보유 장비 기반) ─────────────────
// 로잉머신 · 벤치 · 10kg 덤벨 2개 · 전완근 기구 · AB 슬라이더 · 스테퍼
const HOME_SPLITS = [
  {
    name: 'Push + Core (가슴·어깨·코어)',
    machines: [
      { name: 'DB Bench Press', type: TYPE.STRENGTH, guide: '벤치 + 10kg 덤벨, 4세트 × 10–12회' },
      { name: 'DB Fly', type: TYPE.STRENGTH, guide: '벤치, 3세트 × 12–15회' },
      { name: 'DB Shoulder Press', type: TYPE.STRENGTH, guide: '3–4세트 × 10–12회' },
      { name: 'Ab Roller', type: TYPE.STRENGTH, guide: 'AB 슬라이더, 3세트 × 8–12회' },
    ],
  },
  {
    name: 'Pull + 전완 (등·이두·전완)',
    machines: [
      { name: 'Rowing Machine', type: TYPE.CARDIO, guide: '워밍업 겸 10–15분' },
      { name: 'DB Row', type: TYPE.STRENGTH, guide: '벤치 한 손 로우, 4세트 × 10–12회' },
      { name: 'DB Curl', type: TYPE.STRENGTH, guide: '3세트 × 12회' },
      { name: 'Wrist Curl', type: TYPE.STRENGTH, guide: '전완근 기구, 3세트 × 15–20회' },
    ],
  },
  {
    name: 'Legs + 유산소 (하체·심폐)',
    machines: [
      { name: 'Goblet Squat', type: TYPE.STRENGTH, guide: '10kg 덤벨, 4세트 × 12–15회' },
      { name: 'DB Lunge', type: TYPE.STRENGTH, guide: '3세트 × 좌우 10회' },
      { name: 'Stepper', type: TYPE.CARDIO, guide: '15–20분 꾸준히' },
      { name: 'Rowing Machine', type: TYPE.CARDIO, guide: '마무리 10분 (선택)' },
    ],
  },
];

function lastTrainedHome() {
  const map = {};
  const entries = getByCategory(CATEGORY.WORKOUT);
  for (const e of entries) {
    for (const ex of parseWorkoutMemoText(e.text)) {
      map[ex.machineName] = Math.max(map[ex.machineName] || 0, e.createdAt);
    }
  }
  return map;
}

export function recommendHomeWorkout(mode = 'evening') {
  const last = lastTrainedHome();
  // 가장 오래 안 한 분할 선택
  let best = HOME_SPLITS[0], bestTime = Infinity;
  for (const sp of HOME_SPLITS) {
    const t = Math.min(...sp.machines.map((m) => last[m.name] || 0));
    if (t < bestTime) { bestTime = t; best = sp; }
  }
  const isMorning = mode === 'morning';
  const note = isMorning
    ? '오전 홈트는 로잉/스테퍼로 가볍게 몸을 깨우고 덤벨 중량을 가볍게 가져가세요.'
    : '저녁 홈트는 덤벨 근력 위주로, 마지막에 로잉/스테퍼로 마무리하면 좋습니다.';
  return {
    split: best.name,
    focusCats: ['Home'],
    machines: best.machines,
    note,
    home: true,
  };
}
