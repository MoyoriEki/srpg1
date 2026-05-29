// ═══ CC判定・CC補正・ルート解決 ═══
import classesJson from '../data/classes.json';

const { classes: CLASS_DATA, midCC: MID_CC, advCC: ADV_CC } = classesJson;

// クラスレベル制での CC タイミング判定
// 初級Lv3（=通しLv3）で中級CC、中級Lv5（=通しLv8）で上級CC
export function getCCOptions(unit) {
  const classData = CLASS_DATA[unit.cls];
  if (!classData) return null;

  // 初級 → 中級: 通しLv4到達時（初級3回成長完了後）
  if (classData.tier === '初級' && unit.level >= 4) {
    const opts = (unit.tags || []).map(t => MID_CC[t]).filter(Boolean);
    // 重複除去（同一タグ2つの場合）
    const unique = [...new Set(opts)];
    if (unique.length === 0) return null;
    return { type: 'mid', opts: unique };
  }

  // 中級 → 上級: 通しLv9到達時（中級5回成長完了後）
  if (classData.tier === '中級' && unit.level >= 9) {
    const midTag = classData.tag;
    const other = (unit.tags || []).find(t => t !== midTag);
    if (!other) return null;
    const key = `${unit.cls}_${other}`;
    const opts = ADV_CC[key] || [];
    if (opts.length === 0) return null;
    return { type: 'adv', opts };
  }

  return null;
}

// CC適用（ステ補正・PP加算・射程変更・枠加算）
export function applyCC(unit, newClassName) {
  const newClass = CLASS_DATA[newClassName];
  if (!newClass) return unit;

  const u = {
    ...unit,
    techs: unit.techs.map(t => ({ ...t })),
    skills: [...(unit.skills || [])],
    items: (unit.items || []).map(it => ({ ...it })),
  };

  // 中級CC時の枠履歴を保存（上級CC時に参照するため）
  const prevClass = CLASS_DATA[u.cls];
  if (prevClass?.tier === '中級') {
    u._slotHistory = {
      tech: (prevClass.slotsAdd?.tech || 0),
      skill: (prevClass.slotsAdd?.skill || 0),
      item: (prevClass.slotsAdd?.item || 0),
    };
  }

  u.cls = newClassName;

  // 射程変更
  if (newClass.range) {
    u.rangeMin = newClass.range.min;
    u.rangeMax = newClass.range.max;
  }

  // MOV補正（上級クラスにmov指定がある場合）
  if (newClass.mov) u.mov = newClass.mov;

  // PP加算（累積）
  if (newClass.pp !== undefined) u.pp = (u.pp || 0) + newClass.pp;

  // CC補正ステータス
  const bonus = newClass.ccBonus;
  if (bonus) {
    u.maxHp += (bonus.hp || 0);
    u.hp += (bonus.hp || 0);
    u.str += (bonus.str || 0);
    u.def += (bonus.def || 0);
    u.int += (bonus.int || 0);
  }

  return u;
}

// CCルート一覧取得（デバッグ・UI用）
export function getAllCCRoutes() {
  return { midCC: MID_CC, advCC: ADV_CC };
}

// クラスの兵種特性取得
export function getClassTrait(className) {
  const cls = CLASS_DATA[className];
  if (!cls?.trait) return null;
  const traitInfo = classesJson.traits?.[cls.trait];
  return traitInfo ? { key: cls.trait, ...traitInfo } : { key: cls.trait };
}
