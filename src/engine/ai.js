// ═══ 敵AIパターン（2軸設計: movement × action） ═══
import { effectiveAtk, effectiveDef, effectiveInt, getATK, hasSkill } from './units.js';
import { manhattan, getMovable, getAdj, getTechRange, bfsDistanceMap, isRangeShielded } from './pathfinding.js';
import { getTerrainDef } from './map.js';
import { canUseTech, calcDamage } from './combat.js';
import { isSealed, isBreaked as checkBreaked, hasDebuff, isTaunted, calcCounterHit } from './debuff.js';

// ═══════════════════════════════════════════════════
//  §3. AI状態解決: changeAI > aiRules > デフォルト
// ═══════════════════════════════════════════════════

/**
 * 有効なAIを解決する。優先順位:
 * 1. イベントchangeAI（aiOverride）— 最優先、aiRulesを無効化
 * 2. aiRules — 毎ターン再評価、後勝ち
 * 3. テンプレートのai — デフォルト
 */
export function resolveCurrentAI(enemy, units) {
  const base = enemy.ai || { movement: 'rush', action: 'attack' };

  // changeAIオーバーライドが最優先（aiRules無効化）
  if (enemy.aiOverride) {
    return { ...base, ...enemy.aiOverride };
  }

  // aiRules評価（上から順に、後勝ち）
  if (enemy.aiRules?.length) {
    let matched = null;
    for (const rule of enemy.aiRules) {
      if (checkTrigger(rule.trigger, enemy, units)) {
        matched = rule.ai;
      }
    }
    if (matched) {
      enemy._aiChanged = true;
      return { ...base, ...matched };
    }
  }

  return { ...base };
}

// ═══════════════════════════════════════════════════
//  トリガー判定（aiRules・チャージ共通語彙）
// ═══════════════════════════════════════════════════

export function checkTrigger(trigger, enemy, units) {
  if (!trigger) return true;

  switch (trigger.type) {
    case 'mapStart':
      return true;

    case 'hpBelow':
      return (enemy.hp / enemy.maxHp * 100) <= trigger.pct;

    case 'turn':
      return (enemy._currentTurn || 1) >= trigger.turn;

    case 'proximity': {
      const hostiles = units.filter(u => u.team !== enemy.team && u.hp > 0);
      return hostiles.some(h => manhattan(enemy, h) <= trigger.range);
    }

    case 'onHit':
      return !!enemy.engaged;

    case 'engaged':
      return !!enemy.engaged;

    case 'inRange':
      return isAnyHostileInAttackRange(enemy, units);

    case 'allyHit': {
      if (!trigger.group || !enemy.group) return false;
      return units.some(u =>
        u.team === enemy.team && u.hp > 0 && u.id !== enemy.id &&
        (u.group || []).includes(trigger.group) && u._wasHit
      );
    }

    case 'allyDefeated': {
      if (!trigger.group) return false;
      const defeated = units.filter(u =>
        u.team === enemy.team && u.hp <= 0 &&
        (u.group || []).includes(trigger.group)
      ).length;
      return defeated >= (trigger.count || 1);
    }

    case 'allyHpBelow': {
      if (!trigger.group) return false;
      return units.some(u =>
        u.team === enemy.team && u.hp > 0 && u.id !== enemy.id &&
        (u.group || []).includes(trigger.group) &&
        (u.hp / u.maxHp * 100) <= trigger.pct
      );
    }

    case 'allyAIChanged': {
      if (!trigger.group) return false;
      return units.some(u =>
        u.team === enemy.team && u.hp > 0 && u.id !== enemy.id &&
        (u.group || []).includes(trigger.group) && u._aiChanged
      );
    }

    default:
      return false;
  }
}

// 攻撃可能範囲（BFS移動+射程）内にhostileがいるか
function isAnyHostileInAttackRange(enemy, units) {
  const hostiles = units.filter(u => u.team !== enemy.team && u.hp > 0);
  if (!hostiles.length) return false;
  const movable = getMovable(enemy, units);
  for (const cell of movable) {
    for (const h of hostiles) {
      const d = manhattan(cell, h);
      if (d >= enemy.rangeMin && d <= enemy.rangeMax) return true;
      for (const t of enemy.techs) {
        if (t.uses <= 0 || !canUseTech(enemy, t)) continue;
        const range = getTechRange(t, enemy);
        if (d >= range.min && d <= range.max) return true;
      }
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════
//  §3.3 changeAIイベントアクション
// ═══════════════════════════════════════════════════

/** changeAI適用。targetの敵にAIオーバーライドを設定 */
export function applyChangeAI(targetSpec, aiOverride, units) {
  const targets = resolveTargets(targetSpec, units);
  for (const enemy of targets) {
    if (aiOverride === null) {
      // リセット: テンプレートai + aiRulesに戻す
      enemy.aiOverride = null;
    } else {
      enemy.aiOverride = { ...(enemy.aiOverride || {}), ...aiOverride };
    }
    enemy._aiChanged = true;
  }
}

// target指定を解決（group名 / enemyID / "all"）
function resolveTargets(targetSpec, units) {
  const enemies = units.filter(u => u.team === 'enemy' && u.hp > 0);
  if (targetSpec === 'all') return enemies;
  // enemyID直指定
  const byId = enemies.find(u => u.id === targetSpec);
  if (byId) return [byId];
  // グループ名
  return enemies.filter(u => (u.group || []).includes(targetSpec));
}

// ═══════════════════════════════════════════════════
//  敵フェーズ全体実行
// ═══════════════════════════════════════════════════

export function runEnemyPhase(units) {
  const enemies = units.filter(u => u.team === 'enemy' && u.hp > 0);
  const sortedIds = aiSortEnemies(enemies.map(e => e.id), units);
  const actions = [];

  for (const eid of sortedIds) {
    const enemy = units.find(u => u.id === eid);
    if (!enemy || enemy.hp <= 0) continue;

    const action = decideAction(enemy, units);
    if (action) actions.push({ enemyId: eid, ...action });
  }

  return actions;
}

// ═══════════════════════════════════════════════════
//  1体の行動決定（メインディスパッチ）
// ═══════════════════════════════════════════════════

export function decideAction(enemy, units) {
  // チャージ技: トリガー+カウントダウン優先
  if (enemy.chargeTech) {
    const chargeAction = ai_charge(enemy, units);
    if (chargeAction) return chargeAction;
  }

  // AI解決
  const ai = resolveCurrentAI(enemy, units);
  const sealed = isSealed(enemy);
  const taunter = getTaunter(enemy, units);

  // flee は特殊フロー
  if (ai.movement === 'flee') {
    return handleFlee(enemy, units, ai, sealed, taunter);
  }

  // 移動候補
  const movable = getMoveCandidates(enemy, units, ai);

  // 行動決定（action軸）
  const action = resolveActionForCells(enemy, units, movable, ai, sealed, taunter);
  if (action) return action;

  // フォールバック移動
  if (ai.movement === 'rush') {
    return rushFallback(enemy, units);
  }
  // reactive / fixed: 攻撃不可なら何もしない
  return null;
}

// ═══════════════════════════════════════════════════
//  移動候補取得
// ═══════════════════════════════════════════════════

function getMoveCandidates(enemy, units, ai) {
  switch (ai.movement) {
    case 'fixed':
      return [{ x: enemy.x, y: enemy.y }];
    case 'reactive':
    case 'rush':
    default:
      return getMovable(enemy, units);
  }
}

// rush攻撃不可時: 最寄りの敵に接近（BFS実距離で壁・地形コスト考慮: Bug1修正）
function rushFallback(enemy, units) {
  const hostiles = units.filter(u => u.team !== enemy.team && u.hp > 0);
  if (!hostiles.length) return null;

  // マンハッタン距離で大まかに最寄りの敵を絞り込み
  const nearest = hostiles.reduce((b, p) =>
    manhattan(enemy, p) < manhattan(enemy, b) ? p : b
  );

  // 逆BFS: 目標地点からの実距離マップ（壁・地形コスト考慮）
  const distMap = bfsDistanceMap(nearest.x, nearest.y, enemy.moveType);
  const key = (x, y) => `${x},${y}`;

  const movable = getMovable(enemy, units);
  let bestCell = { x: enemy.x, y: enemy.y };
  let bestDist = distMap[key(enemy.x, enemy.y)] ?? Infinity;

  for (const c of movable) {
    const d = distMap[key(c.x, c.y)];
    if (d !== undefined && d < bestDist) {
      bestDist = d;
      bestCell = c;
    }
  }

  if (bestCell.x !== enemy.x || bestCell.y !== enemy.y) {
    return { move: bestCell, target: null, tech: null };
  }
  return null;
}

// ═══════════════════════════════════════════════════
//  flee（逃避型）: 脅威範囲から離脱
// ═══════════════════════════════════════════════════

function handleFlee(enemy, units, ai, sealed, taunter) {
  const movable = getMovable(enemy, units);
  const hostiles = units.filter(u => u.team !== enemy.team && u.hp > 0);

  // 各候補セルの脅威スコア（低いほど安全）
  const scored = movable.map(cell => {
    let threat = 0;
    for (const h of hostiles) {
      const effectiveRange = (h.mov || 0) + (h.rangeMax || 1);
      const dist = manhattan(cell, h);
      if (dist <= effectiveRange) {
        threat += (effectiveRange - dist + 1);
      }
    }
    return { cell, threat };
  });

  // 脅威が最小のセルを選ぶ（タイブレーク: hostileから最も遠い）
  scored.sort((a, b) => {
    if (a.threat !== b.threat) return a.threat - b.threat;
    const aDist = Math.min(...hostiles.map(h => manhattan(a.cell, h)));
    const bDist = Math.min(...hostiles.map(h => manhattan(b.cell, h)));
    return bDist - aDist;
  });

  const safeCell = scored[0]?.cell || { x: enemy.x, y: enemy.y };

  // 安全セルから行動を試みる
  const action = resolveActionForCells(enemy, units, [safeCell], ai, sealed, taunter);
  if (action) return action;

  // 行動不可でも移動はする
  if (safeCell.x !== enemy.x || safeCell.y !== enemy.y) {
    return { move: safeCell, target: null, tech: null };
  }
  return null;
}

// ═══════════════════════════════════════════════════
//  行動パターン別解決（action軸ディスパッチ）
// ═══════════════════════════════════════════════════

function resolveActionForCells(enemy, units, movable, ai, sealed, taunter) {
  switch (ai.action) {
    case 'support':
      return resolveSupport(enemy, units, movable, sealed)
          || resolveAttack(enemy, units, movable, sealed, taunter);
    case 'debuff':
      return resolveDebuffAction(enemy, units, movable, sealed, taunter)
          || resolveAttack(enemy, units, movable, sealed, taunter);
    case 'techFocus':
      return resolveTechFocus(enemy, units, movable, sealed, taunter, ai.focusTech)
          || resolveAttack(enemy, units, movable, sealed, taunter);
    case 'attack':
    default:
      return resolveAttack(enemy, units, movable, sealed, taunter);
  }
}

// ═══════════════════════════════════════════════════
//  action: attack（攻撃優先）
// ═══════════════════════════════════════════════════

function resolveAttack(enemy, units, movable, sealed, taunter) {
  const targets = getEffectiveTargets(enemy, units, taunter);
  if (!targets.length) return null;

  let bestOption = null;
  let bestScore = -Infinity;

  for (const cell of movable) {
    for (const p of targets) {
      const dist = manhattan(cell, p);

      // プレーン射程
      if (dist >= enemy.rangeMin && dist <= enemy.rangeMax) {
        // 遮蔽チェック
        if (!isRangeShielded(cell.x, cell.y, p.x, p.y, units, p.team)) {
          const tech = sealed ? null : aiSelectTech(enemy, p, dist);
          if (tech !== undefined) {
            const score = aiScoreTarget(enemy, p, cell, tech || null);
            if (score > bestScore) {
              bestScore = score;
              bestOption = { move: cell, target: p, tech: tech || null };
            }
          }
        }
      }

      // 技固有射程
      if (!sealed) {
        for (const t of enemy.techs) {
          if (t.type === 'heal' || t.uses <= 0 || !canUseTech(enemy, t)) continue;
          const range = getTechRange(t, enemy);
          if (dist >= range.min && dist <= range.max) {
            // 遮蔽チェック
            if (isRangeShielded(cell.x, cell.y, p.x, p.y, units, p.team)) continue;
            const score = aiScoreTarget(enemy, p, cell, t);
            if (score > bestScore) {
              bestScore = score;
              bestOption = { move: cell, target: p, tech: t };
            }
          }
        }
      }
    }
  }

  return bestOption;
}

// ═══════════════════════════════════════════════════
//  action: support（回復・支援優先）
// ═══════════════════════════════════════════════════

function resolveSupport(enemy, units, movable, sealed) {
  if (sealed) return null;

  // 回復技チェック
  const healTech = enemy.techs.find(t =>
    t.type === 'heal' && t.uses > 0 && canUseTech(enemy, t)
  );
  if (healTech) {
    const healAction = findHealTarget(enemy, units, movable, healTech);
    if (healAction) return healAction;
  }

  // バフ技チェック（自己バフ or 味方バフ）
  const buffTech = enemy.techs.find(t =>
    (t.type === 'buff' || t.type === 'selfBuff') && t.uses > 0 && canUseTech(enemy, t)
  );
  if (buffTech) {
    if (buffTech.selfOnly || buffTech.type === 'selfBuff') {
      // 自己バフ → 移動先のどこからでも使える
      const bestCell = movable[0] || { x: enemy.x, y: enemy.y };
      return { move: bestCell, target: enemy, tech: buffTech, isBuff: true };
    } else {
      // 味方バフ → 射程内の味方を探す
      const allyEnemies = units.filter(u => u.team === enemy.team && u.hp > 0 && u.id !== enemy.id);
      const range = getTechRange(buffTech, enemy);
      for (const cell of movable) {
        for (const ally of allyEnemies) {
          const dist = manhattan(cell, ally);
          if (dist >= range.min && dist <= range.max) {
            return { move: cell, target: ally, tech: buffTech, isBuff: true };
          }
        }
      }
    }
  }

  return null; // フォールバック→attackは呼び出し元で処理
}

function findHealTarget(enemy, units, movable, healTech) {
  const range = getTechRange(healTech, enemy);
  let bestOption = null;
  let bestNeed = 0;

  for (const cell of movable) {
    const injured = units.filter(u =>
      u.team === 'enemy' && u.hp > 0 && u.hp < u.maxHp && u.id !== enemy.id
    );
    for (const ally of injured) {
      const d = manhattan(cell, ally);
      if (d >= range.min && d <= range.max) {
        const need = ally.maxHp - ally.hp;
        if (need > bestNeed) {
          bestNeed = need;
          bestOption = { move: cell, target: ally, tech: healTech, isHeal: true };
        }
      }
    }
  }
  return bestOption;
}

// ═══════════════════════════════════════════════════
//  action: debuff（妨害優先）
// ═══════════════════════════════════════════════════

function getDebuffCounterGen(tech) {
  return (tech.effects || []).find(e => e.trigger === 'onCombat' && e.type === 'counterGen');
}

function resolveDebuffAction(enemy, units, movable, sealed, taunter) {
  if (sealed) return null;
  const targets = getEffectiveTargets(enemy, units, taunter);
  if (!targets.length) return null;

  const debuffTechs = enemy.techs.filter(t =>
    getDebuffCounterGen(t) && t.uses > 0 && canUseTech(enemy, t) && t.type !== 'heal'
  );
  if (!debuffTechs.length) return null;

  let best = null;
  let bestScore = -Infinity;

  for (const cell of movable) {
    for (const target of targets) {
      const dist = manhattan(cell, target);
      for (const tech of debuffTechs) {
        const range = getTechRange(tech, enemy);
        if (dist < range.min || dist > range.max) continue;

        const cg = getDebuffCounterGen(tech);
        const baseHit = cg.hitCheck?.baseHit || 100;
        const hitPct = calcCounterHit(enemy, target, baseHit);
        const threat = getATK(target) + (target.level || 1);
        const alreadyHas = hasDebuff(target, cg.counter);
        const score = alreadyHas ? hitPct * 0.1 : hitPct * threat;

        if (score > bestScore) {
          bestScore = score;
          best = { move: cell, target, tech };
        }
      }
    }
  }
  return best;
}

// ═══════════════════════════════════════════════════
//  action: techFocus（技指定）
// ═══════════════════════════════════════════════════

function resolveTechFocus(enemy, units, movable, sealed, taunter, focusTechName) {
  if (sealed || !focusTechName) return null;
  const tech = enemy.techs.find(t =>
    t.name === focusTechName && t.uses > 0 && canUseTech(enemy, t)
  );
  if (!tech) return null;

  // 回復技ならsupport扱い
  if (tech.type === 'heal') {
    return findHealTarget(enemy, units, movable, tech);
  }

  const targets = getEffectiveTargets(enemy, units, taunter);
  const range = getTechRange(tech, enemy);

  let best = null;
  let bestScore = -Infinity;

  for (const cell of movable) {
    for (const target of targets) {
      const dist = manhattan(cell, target);
      if (dist >= range.min && dist <= range.max) {
        const score = aiScoreTarget(enemy, target, cell, tech);
        if (score > bestScore) {
          bestScore = score;
          best = { move: cell, target, tech };
        }
      }
    }
  }
  return best;
}

// ═══════════════════════════════════════════════════
//  §2. チャージシステム（トリガー拡張）
// ═══════════════════════════════════════════════════

export function ai_charge(enemy, units) {
  if (!enemy.chargeTech) return null;

  const trigger = enemy.chargeTrigger || { type: 'mapStart' };
  const onMiss = enemy.chargeOnMiss || 'fire';

  // トリガー未発動: 条件チェック
  if (!enemy.chargeTriggered) {
    if (checkTrigger(trigger, enemy, units)) {
      enemy.chargeTriggered = true;
      enemy.chargeCounter = enemy.chargeTurns;
      return { move: { x: enemy.x, y: enemy.y }, target: null, tech: null, charging: enemy.chargeTurns };
    }
    return null; // トリガー待ち → 通常AIへフォールスルー
  }

  // カウントダウン中
  if (enemy.chargeCounter > 0) {
    enemy.chargeCounter--;
    if (enemy.chargeCounter > 0) {
      return { move: { x: enemy.x, y: enemy.y }, target: null, tech: null, charging: enemy.chargeCounter };
    }

    // カウンター0到達 → 発動試行
    const hostiles = units.filter(u => u.team !== enemy.team && u.hp > 0);
    const target = findBestTarget(enemy, hostiles, enemy.chargeTech);

    if (target) {
      // ターゲットあり→発動
      const result = { move: { x: enemy.x, y: enemy.y }, target, tech: enemy.chargeTech, isCharge: true };
      afterChargeFire(enemy);
      return result;
    }

    // ターゲット不在（onMiss分岐）
    if (onMiss === 'fire') {
      // 空撃ち消費
      afterChargeFire(enemy);
      return { move: { x: enemy.x, y: enemy.y }, target: null, tech: null, isCharge: true, missed: true };
    }
    // onMiss === 'keep': カウンターを戻して次ターン再判定
    enemy.chargeCounter = 1;
    return { move: { x: enemy.x, y: enemy.y }, target: null, tech: null, charging: 1 };
  }

  return null;
}

// チャージ発動後の状態リセット
function afterChargeFire(enemy) {
  if (enemy.chargeRepeat) {
    // repeat=true: トリガー待ちに戻る
    enemy.chargeTriggered = false;
    enemy.chargeCounter = 0;
  } else {
    // repeat=false: チャージ終了
    enemy.chargeTriggered = true; // もうトリガーは発動済み
    enemy.chargeCounter = 0;
  }
}

// ═══════════════════════════════════════════════════
//  挑発・ターゲットヘルパー
// ═══════════════════════════════════════════════════

function getTaunter(enemy, units) {
  if (!isTaunted(enemy)) return null;
  if (!enemy._tauntSource) return null;
  return units.find(u => u.id === enemy._tauntSource && u.hp > 0 && u.team !== enemy.team) || null;
}

function getEffectiveTargets(enemy, units, taunter) {
  if (taunter) return [taunter];
  return units.filter(u => u.team !== enemy.team && u.hp > 0);
}

// ═══════════════════════════════════════════════════
//  技選択（attack行動用）
// ═══════════════════════════════════════════════════

function aiSelectTech(enemy, target, dist) {
  const atkTechs = enemy.techs.filter(t => {
    if (t.type === 'heal') return false;
    if (t.uses <= 0 || !canUseTech(enemy, t)) return false;
    const range = getTechRange(t, enemy);
    return dist >= range.min && dist <= range.max;
  });

  const targetDef = target.def + getTerrainDef(target.x, target.y);

  // キルできる技があるなら回数温存（maxUsesが多い技を優先）
  const killTechs = atkTechs.filter(t => {
    const dmg = aiCalcDmg(enemy, target, t, targetDef);
    return dmg >= target.hp;
  });
  if (killTechs.length > 0) {
    return killTechs.reduce((a, b) => a.maxUses > b.maxUses ? a : b);
  }

  // デバフ技: 相手にデバフカウンターがない場合優先
  const hasAnyDebuffCounter = target._counters && Object.keys(target._counters).some(k => (target._counters[k] || 0) > 0);
  if (!hasAnyDebuffCounter) {
    const dbTech = atkTechs.find(t => getDebuffCounterGen(t));
    if (dbTech) return dbTech;
  }

  // 最大ダメージの技
  if (atkTechs.length > 0) {
    return atkTechs.reduce((a, b) =>
      aiCalcDmg(enemy, target, a, targetDef) >= aiCalcDmg(enemy, target, b, targetDef) ? a : b
    );
  }

  // 素の射程内なら通常攻撃（tech=null）
  if (dist >= enemy.rangeMin && dist <= enemy.rangeMax) return null;

  return undefined; // 攻撃不可
}

// ═══════════════════════════════════════════════════
//  ターゲットスコアリング
// ═══════════════════════════════════════════════════

function aiScoreTarget(enemy, target, fromPos, tech) {
  const dist = manhattan(fromPos, target);
  const targetDef = target.def + getTerrainDef(target.x, target.y);
  const dmg = tech ? aiCalcDmg(enemy, target, tech, targetDef)
                   : Math.max(1, getATK(enemy) - targetDef);
  const canKill = dmg >= target.hp;

  // 反撃を受けるか
  const isBreaked = checkBreaked(target);
  const canCounter = !isBreaked && target.rangeMax > 0 && dist >= target.rangeMin && dist <= target.rangeMax;
  const safe = !canCounter;

  let score = 0;
  if (canKill) score += 10000 + (target.level * 10 + getATK(target));
  if (safe) score += dmg * 10;
  score += dmg * 10;
  score -= dist;
  return score;
}

// ═══════════════════════════════════════════════════
//  AI用ダメージ計算
// ═══════════════════════════════════════════════════

function aiCalcDmg(enemy, target, tech, targetDef) {
  return calcDamage(getATK(enemy), targetDef, tech, enemy.int, target.int, 0, { attacker: enemy, defender: target });
}

// ═══════════════════════════════════════════════════
//  最寄りターゲット検索（チャージ発動用）
// ═══════════════════════════════════════════════════

function findBestTarget(enemy, targets, tech) {
  if (!targets.length) return null;
  const range = getTechRange(tech, enemy);
  const inRange = targets.filter(t => {
    const d = manhattan(enemy, t);
    return d >= range.min && d <= range.max;
  });
  if (inRange.length > 0) return inRange.reduce((a, b) => a.hp < b.hp ? a : b);
  return null; // 射程外→ターゲットなし（onMiss判定に回す）
}

// ═══════════════════════════════════════════════════
//  敵行動順ソート
// ═══════════════════════════════════════════════════

export function aiSortEnemies(eids, units) {
  return [...eids].sort((a, b) => {
    const ea = units.find(u => u.id === a);
    const eb = units.find(u => u.id === b);
    if (!ea || !eb) return 0;

    // デバッファー優先
    const aDebuff = ea.techs.some(t => getDebuffCounterGen(t) && t.uses > 0 && t.type !== 'heal');
    const bDebuff = eb.techs.some(t => getDebuffCounterGen(t) && t.uses > 0 && t.type !== 'heal');
    if (aDebuff && !bDebuff) return -1;
    if (!aDebuff && bDebuff) return 1;

    // ヒーラー優先
    const aHeal = ea.techs.some(t => t.type === 'heal' && t.uses > 0);
    const bHeal = eb.techs.some(t => t.type === 'heal' && t.uses > 0);
    if (aHeal && !bHeal) return -1;
    if (!aHeal && bHeal) return 1;

    // ATK高い順
    return getATK(eb) - getATK(ea);
  });
}
