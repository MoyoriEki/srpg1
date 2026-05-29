// ═══ ユニット生成・実効ステ計算 ═══
import classesJson from '../data/classes.json';
import unitsJson from '../data/units.json';
import enemiesJson from '../data/enemies.json';
import minionsJson from '../data/minions.json';
import techsJson from '../data/techs.json';
import { getAdj } from './pathfinding.js';
import { sumStatMod, getDelayedStatMod, getTraitEffects } from './skills.js';
import { getTerrainMod } from './map.js';

const { classes: CLASS_DATA } = classesJson;
let uidCounter = 0;
export function resetUid(val = 0) { uidCounter = val; }

// 技名からランタイム技オブジェクトを生成
export function makeTech(name) {
  const def = techsJson[name];
  if (!def) return null;
  return { ...def, name, uses: def.maxUses };
}

// ── 統一入手関数 ──
// unique: true なら同名が既にあればスキップ（火傷等の内部スキル用）
export function addTech(unit, tech) {
  if (!tech) return false;
  if (tech.unique && unit.techs.some(t => t.name === tech.name)) return false;
  unit.techs.push(tech);
  return true;
}
export function addSkill(unit, skill) {
  if (!skill) return false;
  if (skill.unique && unit.skills.some(s => s.name === skill.name)) return false;
  unit.skills.push(skill);
  return true;
}

// 味方ユニット生成
export function createPlayerUnit(charData) {
  const techs = (charData.initTechs || []).map(n => makeTech(n)).filter(Boolean);
  return {
    id: `p${uidCounter++}`,
    name: charData.name,
    team: 'player',
    x: -1, y: -1,
    hp: charData.base.hp, maxHp: charData.base.hp,
    str: charData.base.str, def: charData.base.def, int: charData.base.int,
    mov: charData.base.mov, pp: charData.base.pp || 0,
    rangeMin: 1, rangeMax: 1,
    techs, skills: [], items: [{ name: '傷薬', effect: 'heal', value: 15, uses: 1, maxUses: 1, desc: 'HP15回復' }],
    acted: false, exp: 0, level: 1, cls: '冒険者',
    tags: charData.tags, initTechs: charData.initTechs,
    personalTrait: charData.trait, personalTraitDesc: charData.traitDesc,
    behavior: 'player', deployed: false,
    color: charData.color,
    chip: charData.chip || null,
    _growthAcc: { hp: 0, str: 0, def: 0, int: 0 },
    _bonusSlots: { tech: 0, skill: 0, item: 0 },
  };
}

// 味方ロスター生成（全13人）
export function createRoster() {
  uidCounter = 0;
  return unitsJson.map(c => createPlayerUnit(c));
}

// behavior → ai 互換変換
function convertBehaviorToAI(behavior) {
  switch (behavior) {
    case 'aggressive': return { movement: 'rush', action: 'attack' };
    case 'stationary': return { movement: 'reactive', action: 'attack' };
    default: return { movement: 'rush', action: 'attack' };
  }
}

// ランダム整数 [-n, +n]
function randInt(n) {
  if (n <= 0) return 0;
  return Math.floor(Math.random() * (n * 2 + 1)) - n;
}

// 敵ユニット生成
export function createEnemyUnit(templateName, x, y, overrides = {}) {
  const tmpl = enemiesJson[templateName];
  if (!tmpl) return null;
  const techs = (tmpl.techs || []).map(n => makeTech(n)).filter(Boolean);

  // レベルスケーリング: base + growth × max(0, Lv − baseLv)
  const baseLv = tmpl.baseLv || 1;
  const lv = Math.max(baseLv, overrides.level || 1);
  const growth = tmpl.growth || {};
  const lvDiff = Math.max(0, lv - baseLv);

  let hp  = Math.floor((tmpl.base.hp  || 0) + (growth.hp  || 0) * lvDiff);
  let str = Math.floor((tmpl.base.str || 0) + (growth.str || 0) * lvDiff);
  let def = Math.floor((tmpl.base.def || 0) + (growth.def || 0) * lvDiff);
  let int = Math.floor((tmpl.base.int || 0) + (growth.int || 0) * lvDiff);
  const mov = tmpl.base.mov || 3;  // MOVはスケールしない
  const pp  = tmpl.base.pp  || 0;  // PPはスケールしない

  // ステ振れ幅（variance）: 各ステに±v、HPは±v×3
  const v = tmpl.variance || 0;
  if (v > 0) {
    hp  += randInt(v * 3);
    str += randInt(v);
    def += randInt(v);
    int += randInt(v);
  }
  hp  = Math.max(1, hp);
  str = Math.max(0, str);
  def = Math.max(0, def);
  int = Math.max(0, int);

  // AI: 新形式(ai) > 旧形式(behavior)互換変換
  const aiOverrides = overrides.ai || {};
  const baseAI = tmpl.ai
    ? { ...tmpl.ai, ...aiOverrides }
    : convertBehaviorToAI(tmpl.behavior || 'aggressive');

  // チャージ: 新形式(trigger/onMiss)対応
  const charge = tmpl.charge || null;
  const chargeTrigger = charge?.trigger || { type: 'mapStart' };
  const chargeOnMiss = charge?.onMiss || 'fire';
  const chargeTriggered = chargeTrigger.type === 'mapStart'; // mapStartは即発動

  const unit = {
    id: `e${uidCounter++}`,
    name: templateName,
    team: 'enemy',
    x, y,
    hp, maxHp: hp,
    str, def, int,
    mov, pp,
    rangeMin: tmpl.range.min, rangeMax: tmpl.range.max,
    techs, skills: [], items: [],
    acted: false, exp: 0, level: lv,
    cls: 'enemy', tags: [],
    // 新AI 2軸
    ai: baseAI,
    aiRules: tmpl.aiRules || [],
    aiOverride: null,
    // 旧behavior互換（参照している箇所があれば使える）
    behavior: tmpl.behavior || 'aggressive',
    expPool: 20,
    bossRank: tmpl.bossRank || false,
    color: tmpl.color,
    chip: tmpl.chip || null,
    // チャージ拡張
    chargeTech: charge ? makeTech(charge.tech) : null,
    chargeTurns: charge?.turns || 0,
    chargeCounter: chargeTriggered ? (charge?.turns || 0) : 0,
    chargeRepeat: charge?.repeat || false,
    chargeTrigger: charge ? chargeTrigger : null,
    chargeOnMiss: chargeOnMiss,
    chargeTriggered: charge ? chargeTriggered : false,
    // ドロップ
    drop: tmpl.drop || null,
    // グループ・フラグ
    group: [],
    engaged: false,
    _aiChanged: false,
    _wasHit: false,
    _currentTurn: 1,
  };
  return unit;
}

// ミニオン生成
export function createMinion(templateName, x, y, ownerTeam) {
  const tmpl = minionsJson[templateName];
  if (!tmpl) return null;
  const techs = (tmpl.techs || []).map(n => makeTech(n)).filter(Boolean);
  return {
    id: `m${uidCounter++}`,
    name: templateName,
    team: ownerTeam,
    x, y,
    hp: tmpl.base.hp, maxHp: tmpl.base.hp,
    str: tmpl.base.str || 0, def: tmpl.base.def || 0, int: tmpl.base.int || 0,
    mov: tmpl.base.mov || 0, pp: tmpl.base.pp || 0,
    rangeMin: tmpl.range?.min || 0, rangeMax: tmpl.range?.max || 0,
    techs, skills: [], items: [],
    acted: true, isMinion: true,
    color: tmpl.color || '#6b7280',
    chip: tmpl.chip || null,
    level: 1, cls: 'minion', tags: [],
    exp: 0, expPool: 0,
  };
}

// マップJSONから敵一覧を生成
export function createEnemiesFromMap(mapJson) {
  uidCounter = 100;
  return (mapJson.enemies || []).map(e => {
    const overrides = e.overrides || {};
    if (e.level) overrides.level = e.level;
    const unit = createEnemyUnit(e.template, e.x, e.y, overrides);
    if (!unit) return null;
    // マップ配置でのid上書き
    if (e.id) unit.id = e.id;
    // グループ設定（マップ配置で指定）
    if (e.group) unit.group = Array.isArray(e.group) ? e.group : [e.group];
    return unit;
  }).filter(Boolean);
}

// ═══ 実効ステ計算 ═══

export function getATK(unit) {
  return (unit.str || 0) + (unit.pp || 0);
}

export function effectiveAtk(unit, units) {
  let atk = getATK(unit);
  atk += sumStatMod(unit, 'atk', units);
  atk += getDelayedStatMod(unit, 'atk');
  atk += getTerrainMod(unit.x, unit.y, 'str');
  return atk;
}

export function effectiveDef(unit, units) {
  let def = unit.def;
  def += getDelayedStatMod(unit, 'def');
  def += sumStatMod(unit, 'def', units);
  return Math.max(0, def);
}

export function effectiveInt(unit, units) {
  let int = unit.int || 0;
  if (!units) return int;
  int += sumStatMod(unit, 'int', units);
  int += getDelayedStatMod(unit, 'int');
  int += getTerrainMod(unit.x, unit.y, 'int');
  return Math.max(0, int);
}

// 枠数計算
export function getSlots(unit) {
  const base = CLASS_DATA['冒険者']?.slots || { tech: 3, skill: 999, item: 1 };
  let slots = { tech: base.tech, skill: base.skill, item: base.item };
  // 中級の追加
  const midCls = CLASS_DATA[unit.cls];
  if (midCls?.tier === '中級' && midCls.slotsAdd) {
    slots.tech += midCls.slotsAdd.tech;
    slots.skill += midCls.slotsAdd.skill;
    slots.item += midCls.slotsAdd.item;
  }
  // 上級の追加（中級分も含む）
  if (midCls?.tier === '上級') {
    // 上級はCC履歴から中級分を加算する必要がある
    // 簡易: _slotHistory に蓄積しておく
    if (unit._slotHistory) {
      slots.tech += unit._slotHistory.tech || 0;
      slots.skill += unit._slotHistory.skill || 0;
      slots.item += unit._slotHistory.item || 0;
    }
    if (midCls.slotsAdd) {
      slots.tech += midCls.slotsAdd.tech;
      slots.skill += midCls.slotsAdd.skill;
      slots.item += midCls.slotsAdd.item;
    }
  }
  // ボーナス枠
  const bonus = unit._bonusSlots || {};
  slots.tech += bonus.tech || 0;
  slots.skill += bonus.skill || 0;
  slots.item += bonus.item || 0;
  // 特性エフェクト: slotBonus
  for (const eff of getTraitEffects(unit)) {
    if (eff.type === 'slotBonus' && eff.slot && eff.value) {
      slots[eff.slot] = (slots[eff.slot] || 0) + eff.value;
    }
  }
  return slots;
}

export function getClassData(className) {
  return CLASS_DATA[className] || null;
}

// ═══ スキルヘルパー ═══

export function hasSkill(unit, name) {
  return (unit.skills || []).some(s => s.name === name);
}
