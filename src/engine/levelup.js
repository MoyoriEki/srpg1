// ═══ 経験値・レベルアップ・成長率 ═══
import { EXP_PER_HIT, EXP_NEXT, LEVEL_CAP } from './constants.js';
import { getClassData } from './units.js';
import { collectEffects, applyCounterGen } from './skills.js';

// レベル差による経験値倍率
function expLvMod(playerLv, enemyLv) {
  const diff = playerLv - enemyLv;
  if (diff <= 0) return 1.0;
  if (diff <= 2) return 0.75;
  if (diff <= 4) return 0.5;
  return 0.25;
}

// 次レベルに必要な経験値
export function expNext() {
  return EXP_NEXT;
}

// 経験値付与（プール方式）
// 敵1体あたりプール20: ヒットで5、トドメで残り総取り
export function awardExp(playerUnit, enemyUnit, isKill, logs) {
  // ミニオンは経験値を貰わない
  if (playerUnit.isMinion) return 0;
  // ミニオンは経験値を与えない（ただしexpPoolは消費）
  if (enemyUnit.isMinion) {
    if (enemyUnit.expPool > 0) enemyUnit.expPool = Math.max(0, enemyUnit.expPool - EXP_PER_HIT);
    return 0;
  }
  if (!enemyUnit.expPool || enemyUnit.expPool <= 0) return 0;
  if (playerUnit.level >= LEVEL_CAP) return 0;

  const raw = isKill ? enemyUnit.expPool : Math.min(EXP_PER_HIT, enemyUnit.expPool);
  enemyUnit.expPool -= raw;

  const mod = expLvMod(playerUnit.level, enemyUnit.level || 1);
  const actual = Math.floor(raw * mod);

  if (actual > 0) {
    playerUnit.exp += actual;
    logs.push({
      text: `  ${playerUnit.name} は ${actual}EXP を獲得${mod < 1 ? ` (Lv差補正${Math.round(mod * 100)}%)` : ''} [残プール${enemyUnit.expPool}]`,
      type: 'exp',
    });
  }

  return actual;
}

// レベルアップ処理（端数蓄積・切り捨て方式）
// クラスレベル制: 初級3 + 中級5 + 上級3 = 11回成長
export function applyLevelUp(unit) {
  const u = {
    ...unit,
    techs: unit.techs.map(t => ({ ...t })),
    skills: [...(unit.skills || [])],
    items: (unit.items || []).map(it => ({ ...it })),
    _counters: unit._counters ? { ...unit._counters } : undefined,
  };

  u.exp -= expNext();
  u.level++;

  const classData = getClassData(u.cls);
  const g = classData?.growth || { hp: 1, str: 0.7, def: 0.7, int: 0.7 };

  // 端数蓄積
  if (!u._growthAcc) u._growthAcc = { hp: 0, str: 0, def: 0, int: 0 };
  const gains = { hp: 0, str: 0, def: 0, int: 0 };

  for (const s of ['hp', 'str', 'def', 'int']) {
    u._growthAcc[s] += (g[s] || 0);
    const inc = Math.floor(u._growthAcc[s]);
    u._growthAcc[s] -= inc;
    gains[s] = inc;
  }

  u.maxHp += gains.hp;
  u.hp += gains.hp;
  u.str += gains.str;
  u.def += gains.def;
  u.int += gains.int;

  // onLevelUp トリガーのeffect実行（悪魔との契約の呪い+1等）
  const lvEffs = collectEffects(u, 'onLevelUp', {});
  for (const eff of lvEffs) {
    if (eff.type === 'counterGen') {
      applyCounterGen(u, eff, null, eff._skill?.name);
      gains._cursedCounter = eff.counter; // UI表示用（カウンター名を渡す）
    }
  }

  return { unit: u, gains };
}

// レベルアップ可能かチェック
export function canLevelUp(unit) {
  return unit.exp >= expNext() && unit.level < LEVEL_CAP;
}

// クラスレベル上限チェック（初級3/中級5/上級3）
export function atClassLevelCap(unit) {
  const classData = getClassData(unit.cls);
  if (!classData) return false;

  const tier = classData.tier;
  const classLevel = getClassLevel(unit);

  if (tier === '初級') return classLevel >= 3;
  if (tier === '中級') return classLevel >= 5;
  if (tier === '上級') return classLevel >= 3;
  return false;
}

// 現在のクラス内レベル算出
// 初級: Lv1-3(3回), 中級: Lv4-8(5回), 上級: Lv9-11(3回)
export function getClassLevel(unit) {
  const classData = getClassData(unit.cls);
  if (!classData) return unit.level;

  const tier = classData.tier;
  if (tier === '初級') return Math.min(unit.level, 3);
  if (tier === '中級') return Math.min(unit.level - 3, 5);
  if (tier === '上級') return Math.min(unit.level - 8, 3);
  return unit.level;
}
