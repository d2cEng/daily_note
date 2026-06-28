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
