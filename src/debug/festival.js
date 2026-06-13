// ═══ お祭りテスト用 デバッグ編成投入口（使い捨て） ═══
// 企画の生死判定用。ドラフト/CC/レベルアップを一切経ずに、
// 任意パーツ装備済み・育成完了の8体を生成する。
// ボツになったらこのディレクトリごと捨てる前提。実装方針は docs/festival_test.md 参照。
//
// ステ注入方式: ①直書き
//   ロスターの stats を最終クラス相当の「素ステ（スキル適用前）」として直書きし、
//   スキルの常時statMod（猛者の腕輪 STR+2 等）は applyPart が上乗せする。
//   → 本番と同じく「素ステ + スキル補正」の合算で実効ステになる。

import { createPlayerUnit, makeTech } from '../engine/units.js';
import { applyPart } from '../engine/draft.js';
import classesJson from '../data/classes.json';
import partsData from '../data/parts.json';
import unitsJson from '../data/units.json';
import roster from './festivalRoster.json';

const CLASS_DATA = classesJson.classes;
const SKILL_PARTS = partsData.filter(p => !p._comment && p.type === 'skill');

function findSkillPart(name) {
  return SKILL_PARTS.find(p => p.name === name) || null;
}

// ロスター1エントリ → 戦闘可能ユニット
function buildOne(entry) {
  const charData = unitsJson.find(c => c.id === entry.charId);
  if (!charData) {
    console.warn('[festival] charId 不明、スキップ:', entry.charId);
    return null;
  }

  let u = createPlayerUnit(charData);

  // ── 最終クラス / Lv の注入（CC・レベルアップをスキップ） ──
  if (entry.class && CLASS_DATA[entry.class]) {
    u.cls = entry.class; // 兵種特性(canto等)・枠は getTrait/getSlots が cls から解決する
    const cdef = CLASS_DATA[entry.class];
    if (cdef.range) { u.rangeMin = cdef.range.min; u.rangeMax = cdef.range.max; }
  } else if (entry.class) {
    console.warn('[festival] クラス不明、冒険者のまま:', entry.class);
  }
  if (entry.level != null) u.level = entry.level;
  if (entry.moveType) u.moveType = entry.moveType;

  // ── 最終ステ直書き（①方式: スキル適用前の素ステ） ──
  const s = entry.stats || {};
  if (s.hp != null)  { u.maxHp = s.hp; u.hp = s.hp; }
  if (s.str != null) u.str = s.str;
  if (s.def != null) u.def = s.def;
  if (s.int != null) u.int = s.int;
  if (s.mov != null) u.mov = s.mov;
  if (s.pp != null)  u.pp = s.pp;

  // ── 枠制限はデバッグ用に撤廃（任意パーツ装備済みを実現） ──
  u._bonusSlots = { tech: 99, skill: 99, item: 99 };

  // ── 技: ロスター指定で初期技を置き換え（onAcquire系の技は存在しないので makeTech 直で十分） ──
  if (Array.isArray(entry.techs)) {
    u.techs = entry.techs
      .map(n => { const t = makeTech(n); if (!t) console.warn('[festival] 技不明:', n); return t; })
      .filter(Boolean);
  }

  // ── スキル: 本番と同じ applyPart 経路（onAcquire・カウンター初期化込み） ──
  for (const name of (entry.skills || [])) {
    const part = findSkillPart(name);
    if (!part) { console.warn('[festival] スキル不明、スキップ:', name); continue; }
    u = applyPart(u, part); // applyPart は新オブジェクトを返す
  }

  return u;
}

// デバッグ編成8体（配置前・x/y未設定）を生成
export function buildFestivalUnits() {
  return roster.map(buildOne).filter(Boolean);
}
