// store.js — localStorage 기반 MemoEntry 저장소 + JSON/TSV 백업
import { makeId, CATEGORY } from './model.js';

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
 * 들어온 엔트리들을 현재 캐시에 병합. mode: 'replace' | 'merge'
 * merge는 id 기준으로 기존 항목을 갱신, 없으면 추가. 반환: 처리 건수.
 */
function mergeEntries(incoming, mode = 'merge') {
  read();
  if (mode === 'replace') {
    cache = incoming.slice();
  } else {
    const byId = new Map(cache.map((e) => [e.id, e]));
    for (const e of incoming) {
      if (!e.id) e.id = makeId();
      const existing = byId.get(e.id);
      if (existing) Object.assign(existing, e);
      else { cache.push(e); byId.set(e.id, e); }
    }
  }
  persist();
  return incoming.length;
}

/**
 * JSON 가져오기. mode: 'replace' | 'merge'
 * 반환: 추가/대체된 건수
 */
export function importJson(text, mode = 'merge') {
  const parsed = JSON.parse(text);
  const incoming = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(incoming)) throw new Error('유효한 백업 형식이 아닙니다.');
  return mergeEntries(incoming, mode);
}

/**
 * 메모앱 TSV(탭 구분 + 헤더행)를 MemoEntry 배열로 변환.
 * 헤더 기반 매핑이라 컬럼 순서에 의존하지 않음.
 * 예상 컬럼: id, createdAt, category, text, weightRoute, weight, measuredAt ...
 */
export function parseMemoTsv(tsv) {
  const lines = (tsv || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.length);
  if (lines.length < 2) return [];
  const header = lines[0].split('\t').map((h) => h.trim());
  const col = (name) => header.indexOf(name);
  const iId = col('id'), iCreated = col('createdAt'), iCat = col('category'),
    iText = col('text'), iRoute = col('weightRoute'), iWeight = col('weight');
  if (iCat === -1 || iText === -1) {
    throw new Error('메모앱 TSV 형식이 아닙니다 (category/text 컬럼 없음).');
  }
  const known = new Set(Object.values(CATEGORY));
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    const category = (c[iCat] || '').trim();
    const text = c[iText] != null ? c[iText] : '';
    if (!text || !known.has(category)) continue;
    const createdAt = iCreated !== -1 ? Number(c[iCreated]) : NaN;
    const weight = iWeight !== -1 ? Number(c[iWeight]) : NaN;
    const entry = {
      id: (iId !== -1 && c[iId]) ? c[iId].trim() : makeId(),
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      category,
      text,
    };
    if (iRoute !== -1 && c[iRoute]) entry.weightRoute = c[iRoute].trim();
    if (Number.isFinite(weight)) entry.amount = weight;
    out.push(entry);
  }
  return out;
}

/**
 * 메모앱 TSV 가져오기. mode: 'replace' | 'merge'
 * 반환: 가져온 건수.
 */
export function importTsv(tsv, mode = 'merge') {
  const incoming = parseMemoTsv(tsv);
  if (!incoming.length) throw new Error('가져올 기록이 없습니다.');
  return mergeEntries(incoming, mode);
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
