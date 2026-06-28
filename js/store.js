// store.js — localStorage 기반 MemoEntry 저장소 + JSON 백업
import { makeId } from './model.js';

const STORAGE_KEY = 'daily_note_entries_v1';
const SETTINGS_KEY = 'daily_note_settings_v1';

let cache = null;
const listeners = new Set();

function read() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(cache)) cache = [];
  } catch (e) {
    console.warn('store read failed', e);
    cache = [];
  }
  return cache;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.error('store persist failed', e);
  }
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (_) {}
  });
}

/** 변경 구독 (반환: 해제 함수) */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 전체 엔트리 (createdAt 내림차순 복사본) */
export function getAll() {
  return read().slice().sort((a, b) => b.createdAt - a.createdAt);
}

/** 카테고리 키로 필터 */
export function getByCategory(category) {
  return getAll().filter((e) => e.category === category);
}

/** 엔트리 추가 */
export function add(entry) {
  read();
  if (!entry.id) entry.id = makeId();
  cache.push(entry);
  persist();
  return entry;
}

/** 엔트리 갱신 (id 기준 병합) */
export function update(id, patch) {
  read();
  const idx = cache.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  cache[idx] = { ...cache[idx], ...patch };
  persist();
  return cache[idx];
}

/** 엔트리 삭제 */
export function remove(id) {
  read();
  const before = cache.length;
  cache = cache.filter((e) => e.id !== id);
  if (cache.length !== before) persist();
}

/** 전체 삭제 */
export function clearAll() {
  cache = [];
  persist();
}

// ── 백업 ──────────────────────────────────────────────
export function exportJson() {
  return JSON.stringify(
    { version: 1, exportedAt: Date.now(), entries: read() },
    null,
    2
  );
}

/**
 * JSON 가져오기. mode: 'replace' | 'merge'
 * 반환: 추가/대체된 건수
 */
export function importJson(text, mode = 'merge') {
  const parsed = JSON.parse(text);
  const incoming = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(incoming)) throw new Error('유효한 백업 형식이 아닙니다.');
  read();
  if (mode === 'replace') {
    cache = incoming.slice();
  } else {
    const ids = new Set(cache.map((e) => e.id));
    for (const e of incoming) {
      if (!e.id) e.id = makeId();
      if (!ids.has(e.id)) {
        cache.push(e);
        ids.add(e.id);
      }
    }
  }
  persist();
  return incoming.length;
}

// ── 설정 ──────────────────────────────────────────────
export function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

export function setSetting(key, value) {
  const s = getSettings();
  s[key] = value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
