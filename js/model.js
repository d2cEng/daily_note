// model.js — 공통 데이터 모델 / 상수
// 참고 문서 §0: 모든 기록은 단일 MemoEntry 의 text 필드에 인코딩된다.

export const CATEGORY = Object.freeze({
  WEIGHT: 'WEIGHT',
  WORKOUT: 'WORKOUT',
  SUPPLEMENT: 'SUPPLEMENT', // 웹앱 확장
});

export const CATEGORY_LABEL = Object.freeze({
  WEIGHT: '체중',
  WORKOUT: '운동',
  SUPPLEMENT: '보충제',
});

// 체중 입력 루트 (참고 §1.1)
export const WEIGHT_ROUTE = Object.freeze({
  MANUAL: 'MANUAL',
  INBODY: 'INBODY',
  OKOK: 'OKOK',
});

export const WEIGHT_ROUTE_LABEL = Object.freeze({
  MANUAL: '일반',
  INBODY: '인바디',
  OKOK: 'OKOK',
});

// 차트 색상 (참고 §1.1)
export const WEIGHT_ROUTE_COLOR = Object.freeze({
  MANUAL: '#9E9E9E',
  INBODY: '#2196F3',
  OKOK: '#4CAF50',
});

/**
 * 카테고리 키 (참고 §0): customCategory 가 있으면 그 값, 아니면 category.
 */
export function categoryKey(entry) {
  if (entry && entry.customCategory && String(entry.customCategory).trim()) {
    return String(entry.customCategory).trim();
  }
  return entry ? entry.category : '';
}

/** 고유 ID 생성 */
export function makeId() {
  return (
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9)
  );
}

/**
 * MemoEntry 팩토리. (참고 §0 필드 구조)
 */
export function makeEntry({
  text = '',
  createdAt = Date.now(),
  category,
  customCategory = null,
  amount = null,
  weightRoute = null,
} = {}) {
  return {
    id: makeId(),
    text,
    createdAt,
    category,
    customCategory,
    amount,
    weightRoute,
  };
}
