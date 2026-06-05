// ═══ ダメージ計算・戦闘実行 ═══
import { EXP_COMBAT_CAP, PURSUIT_RATE_PER_INT, COUNTER_DEFS } from './constants.js';
import { effectiveAtk, effectiveDef, effectiveInt, getATK, hasSkill } from './units.js';
import { getTrait, getAtkBonus, getDefReduction, getHealBonus,
         pursuitBonus,
         dispatchOnKill, dispatchOnHeal, dispatchOnHit,
         dispatchOnDamaged, dispatchOnAttackSelfEffects,
         collectEffects, applyCounterGen, collectTechEffects } from './skills.js';
import { calcCounterHit, isBreaked } from './debuff.js';
import { manhattan, getAdj, getAoeCells, getTechRange, isRangeShielded } from './pathfinding.js';
import { getTerrainDef, getPassability } from './map.js';
import { awardExp } from './levelup.js';

// ═══ 単体ダメージ計算 ═══

// 技使用条件チェック
export function canUseTech(unit, tech) {
  if (!tech || tech.uses <= 0) return false;
  if (tech.cond) {
    // ステ条件
    if (tech.cond.stat && unit[tech.cond.stat] < tech.cond.val) return false;
    if (tech.cond.stat2 && unit[tech.cond.stat2] < tech.cond.val2) return false;
    // カウンター消費条件（cond内）
    if (tech.cond.counter) {
      const counters = unit._counters?.[tech.cond.counter] || 0;
      if (counters < tech.cond.cost) return false;
    }
  }
  // counterCost: 技自体のカウンター消費条件
  if (tech.counterCost) {
    const counters = unit._counters?.[tech.counterCost.name] || 0;
    if (counters < tech.counterCost.cost) return false;
  }
  return true;
}

// bonus条件チェック
function checkBonusCond(cond, ctx) {
  if (!cond) return true;
  const { attacker, defender } = ctx;
  // カウンター条件
  if (cond.counter) {
    const count = (attacker?._counters && attacker._counters[cond.counter]) || 0;
    if (count < (cond.min || 0)) return false;
  }
  // ステータス条件（攻撃者）
  if (cond.stat) {
    const val = attacker?.[cond.stat] || 0;
    const op = cond.op || '>=';
    if (op === '>=' && !(val >= cond.val)) return false;
    if (op === '<=' && !(val <= cond.val)) return false;
    if (op === '>' && !(val > cond.val)) return false;
    if (op === '<' && !(val < cond.val)) return false;
    if (op === '==' && val !== cond.val) return false;
  }
  // 対象のクラス特性（trait）
  if (cond.targetTrait) {
    if (!defender?.trait?.includes(cond.targetTrait)) return false;
  }
  // 対象のチーム
  if (cond.targetTeam) {
    if (defender?.team !== cond.targetTeam) return false;
  }
  // 対象のクラス名
  if (cond.targetClass) {
    if (defender?.cls !== cond.targetClass) return false;
  }
  // 対象のタグ
  if (cond.targetTag) {
    if (!(defender?.tags || []).includes(cond.targetTag)) return false;
  }
  // 自HP%（例: "<=50" → HP半分以下）
  if (cond.selfHpPct && attacker) {
    const pct = (attacker.hp / attacker.maxHp) * 100;
    const m = String(cond.selfHpPct).match(/^([<>=!]+)(\d+)$/);
    if (m) { const op = m[1], v = +m[2];
      if (op === '<=' && !(pct <= v)) return false;
      if (op === '>=' && !(pct >= v)) return false;
      if (op === '<' && !(pct < v)) return false;
      if (op === '>' && !(pct > v)) return false;
      if (op === '==' && pct !== v) return false;
    }
  }
  // 対象HP%
  if (cond.targetHpPct && defender) {
    const pct = (defender.hp / defender.maxHp) * 100;
    const m = String(cond.targetHpPct).match(/^([<>=!]+)(\d+)$/);
    if (m) { const op = m[1], v = +m[2];
      if (op === '<=' && !(pct <= v)) return false;
      if (op === '>=' && !(pct >= v)) return false;
      if (op === '<' && !(pct < v)) return false;
      if (op === '>' && !(pct > v)) return false;
      if (op === '==' && pct !== v) return false;
    }
  }
  return true;
}

// bonus配列のダメージ加算を解決
function resolveBonus(tech, ctx) {
  if (!tech?.bonus?.length) return 0;
  let total = 0;
  const counters = ctx?.attacker?._counters;
  for (const b of tech.bonus) {
    if (!checkBonusCond(b.cond, ctx || {})) continue;
    if (b.source === 'counter' && counters) {
      total += (counters[b.counter] || 0) * (b.mult || 1);
    } else {
      total += b.value || 0;
    }
  }
  return total;
}

// 基本ダメージ計算（type別分岐）
// ctx: { attacker, defender }（bonus解決用、省略可）
export function calcDamage(atk, def, tech, attackerInt, defenderInt, terrDef, ctx) {
  const totalDef = def + terrDef;

  // debuffOnly: ダメージなし
  if (tech?.type === 'debuffOnly') return 0;

  // buff: ダメージなし
  if (tech?.type === 'buff' || tech?.type === 'selfBuff') return 0;

  // special: ダメージなし（救出・踊り等）
  if (tech?.type === 'special') return 0;

  // 固定ダメージ（DEF無視）
  if (tech?.type === 'fixed') return tech.fixed + resolveBonus(tech, ctx);

  // INT参照攻撃
  if (tech?.type === 'intRef') {
    const effDef = tech.defIgnore ? 0 : defenderInt;
    return Math.max(1, Math.floor(attackerInt * (tech.intMult || 1.0)) + (tech.flatAdd || 0) - effDef + resolveBonus(tech, ctx));
  }

  // 回復技（combatでは使わないが念のため）
  if (tech?.type === 'heal') return 0;

  // mult倍率: ATK × mult - DEF
  if (tech?.type === 'mult') {
    return Math.max(1, Math.floor(atk * (tech.mult || 1.0)) - totalDef + resolveBonus(tech, ctx));
  }

  // flatAdd: ATK + mod - DEF（デフォルト）
  const mod = tech?.mod || 0;
  return Math.max(1, atk + mod - totalDef + resolveBonus(tech, ctx));
}

// ═══ 技命中率 ═══

export function calcTechHit(attacker, defender, tech, units) {
  if (!tech?.hitRate) return 100; // hitRate未設定 = 必中
  const baseHit = tech.hitRate;
  const intDiff = (effectiveInt(attacker, units) - effectiveInt(defender, units)) * DEBUFF_HIT_PER_INT;
  return Math.max(0, Math.min(100, baseHit + intDiff));
}

// ═══ 追撃判定 ═══

export function calcPursuit(atkUnit, defUnit, units) {
  const intDiff = effectiveInt(atkUnit, units) - effectiveInt(defUnit, units);
  const bonus = pursuitBonus(atkUnit);
  return Math.max(0, Math.min(100, intDiff * PURSUIT_RATE_PER_INT + bonus));
}

// ═══ 回復技実行 ═══

export function executeHeal(healerUnit, targetUnit, tech, units) {
  const us = cloneUnits(units);
  const h = us.find(u => u.id === healerUnit.id);
  const tgt = us.find(u => u.id === targetUnit.id);
  const logs = [];

  // 回復量計算
  let healAmt = 0;
  if (tech.healFixed) {
    healAmt = tech.healFixed;
  } else {
    healAmt = Math.floor(effectiveInt(h, us) * (tech.healMult || 1.0));
  }

  // 回復補正（healBoost特性 + 治癒の知識スキル）: collectEffects経由
  for (const eff of collectEffects(h, 'onHeal', { target: tgt })) {
    if (eff.type === 'healMult') healAmt = Math.floor(healAmt * (eff.mult || 1));
  }
  healAmt += getHealBonus(h);

  if (healAmt <= 0) healAmt = 1;
  const amt = Math.min(healAmt, tgt.maxHp - tgt.hp);
  tgt.hp += amt;

  // 技回数消費
  consumeTech(h, tech);

  // counterCost消費
  if (tech?.counterCost) {
    if (!h._counters) h._counters = {};
    h._counters[tech.counterCost.name] = (h._counters[tech.counterCost.name] || 0) - tech.counterCost.cost;
    logs.push({ text: `  ${tech.counterCost.name}${tech.counterCost.cost}消費`, type: 'info' });
  }

  logs.push({ text: `${h.name} の ${tech.name} → ${tgt.name} を ${amt}回復`, type: 'heal' });

  // 共鳴スキル（ディスパッチャ）
  dispatchOnHeal(h, tgt, us, logs);

  return { units: us, logs, healAmt: amt };
}

// ═══ 1v1戦闘実行 ═══

export function executeCombat(atkUnit, defUnit, tech, units) {
  const us = cloneUnits(units);
  const a = us.find(u => u.id === atkUnit.id);
  let d = us.find(u => u.id === defUnit.id);
  const logs = [];
  const hits = [];
  let totalExp = 0;
  let expUid = null;

  const label = tech ? tech.name : '通常攻撃';
  const numHits = tech?.hits || 1;
  const isDebuffOnly = tech?.type === 'debuffOnly';
  let techMissed = false;
  a._techCanto = false; // 前回の戦闘フラグをリセット

  // ── 射程2遮蔽チェック（安全弁: UI/AIで弾かれるはずだが念のため） ──
  if (a.team !== d.team && isRangeShielded(a.x, a.y, d.x, d.y, us, d.team)) {
    logs.push({ text: `${d.name} への攻撃は遮蔽された！`, type: 'info' });
    return { units: us, logs, hits: [], expGain: 0, expUid: null };
  }

  // ── 身代わり判定（substitute特性 — collectEffects経由） ──
  if (a.team !== d.team) {
    const adjCells = getAdj(d.x, d.y);
    const sub = us.find(u => {
      if (u.hp <= 0 || u.id === d.id || u.id === a.id || u.team !== d.team) return false;
      if (!adjCells.some(c => c.x === u.x && c.y === u.y)) return false;
      const subEffs = collectEffects(u, 'onEnemyAttackBefore', { attacker: a });
      return subEffs.some(e => e.type === 'substitute' && (!e.perTurn || !u._substituteUsed));
    });
    if (sub) {
      sub._substituteUsed = true;
      logs.push({ text: `${sub.name} が ${d.name} を庇った！`, type: 'info' });
      d = sub;
    }
  }

  // ── preemptive（迎撃体制）判定 ──
  // 敵ターン（攻撃側が敵）かつ防御側スキルにpreemptiveがあれば反撃→攻撃の順に入れ替え
  let preemptive = false;
  if (a.team === 'enemy' && d.team === 'player' && !isDebuffOnly) {
    const preEffs = collectEffects(d, 'onEnemyAttackBefore', { attacker: a });
    for (const eff of preEffs) {
      if (eff.type !== 'preemptive') continue;
      // ステ閾値条件
      if (eff.cond?.stat && (d[eff.cond.stat] || 0) < (eff.cond.val || 0)) continue;
      // perTurn: 敵ターン中1回のみ
      if (eff.perTurn && d._preemptiveUsed) continue;
      // 射程チェック（プレーン射程内のみ）
      const dist = manhattan(a, d);
      if (d.rangeMax > 0 && dist >= d.rangeMin && dist <= d.rangeMax) {
        preemptive = true;
        if (eff.perTurn) d._preemptiveUsed = true;
        break;
      }
    }
  }

  // ── Special自己対象技（curseHeal, uncurse等） ──
  if (tech?.type === 'special' && tech.subType) {
    if (tech) consumeTech(a, tech);
    switch (tech.subType) {
      case 'curseHeal': {
        const cn = tech.counter;
        if (!a._counters) a._counters = {};
        a._counters[cn] = (a._counters[cn] || 0) + 1;
        const count = a._counters[cn];
        const healAmt = Math.min(count, a.maxHp - a.hp);
        a.hp += healAmt;
        logs.push({ text: `${a.name}は${cn}を受け入れた（${cn}→${count}）`, type: 'info' });
        logs.push({ text: `${a.name}はHP${healAmt}回復した`, type: 'heal' });
        break;
      }
      case 'uncurse': {
        const cn = tech.counter;
        const maxRm = tech.maxRemove || 6;
        const dmgPer = tech.dmgPerRemove || 6;
        if (!a._counters) a._counters = {};
        const count = a._counters[cn] || 0;
        const removeCount = Math.min(count, maxRm);
        a._counters[cn] = count - removeCount;
        if (a._counters[cn] <= 0) delete a._counters[cn];
        if (Object.keys(a._counters).length === 0) a._counters = undefined;
        const selfDmg = removeCount * dmgPer;
        a.hp = Math.max(1, a.hp - selfDmg);
        logs.push({ text: `${a.name}は${cn}を${removeCount}個解除した`, type: 'info' });
        logs.push({ text: `${a.name}は${selfDmg}ダメージを受けた（HP${a.hp}）`, type: 'atk' });
        break;
      }
    }
    return { units: us, logs, hits: [], expGain: null };
  }

  // カウンター消費
  if (tech?.cond?.counter) {
    if (!a._counters) a._counters = {};
    a._counters[tech.cond.counter] -= tech.cond.cost;
  }

  // HP消費（砕撃等）
  if (tech?.hpCost && a.hp > tech.hpCost) {
    a.hp -= tech.hpCost;
    logs.push({ text: `${a.name} はHP${tech.hpCost}消費`, type: 'info' });
  }

  // ── Step 0: 迎撃（preemptive） ──
  if (preemptive && a.hp > 0 && d.hp > 0) {
    const pDAtk = effectiveAtk(d, us);
    const pADef = effectiveDef(a, us);
    const pTDef = getTerrainDef(a.x, a.y);
    let pDmg = Math.max(1, pDAtk - (pADef + pTDef));
    a.hp = Math.max(0, a.hp - pDmg);
    // 被ダメフラグ（AIトリガー用）
    if (pDmg > 0) { a._wasHit = true; a.engaged = true; }
    logs.push({ text: `  迎撃！ ${d.name} → ${a.name} に ${pDmg}ダメージ${a.hp <= 0 ? ' 【撃破】' : ''}`, type: 'counter' });
    hits.push({ uid: a.id, dmg: pDmg, delay: 0, phase: 'preemptive' });
    if (a.hp <= 0) {
      // 攻撃側が迎撃で倒された
      if (d.team === 'player' && a.team === 'enemy') {
        const e = awardExp(d, a, true, logs);
        totalExp += e; expUid = d.id;
      }
      dispatchOnKill(d, a, us, logs);
      if (tech) consumeTech(a, tech);
      if (tech?.counterCost) {
        if (!a._counters) a._counters = {};
        a._counters[tech.counterCost.name] = (a._counters[tech.counterCost.name] || 0) - tech.counterCost.cost;
      }
      const expGain = totalExp > 0 && expUid ? { uid: expUid, xp: totalExp } : null;
      return { units: us, logs, hits, expGain };
    }
  }

  // ── Step 1: 攻撃 ──
  if (!isDebuffOnly) {
    let aAtk = effectiveAtk(a, us);
    const dDef = effectiveDef(d, us);
    const tDef = getTerrainDef(d.x, d.y);

    // 射程ボーナス（rangeBoost等）: collectEffects経由
    for (const eff of collectEffects(a, 'onAttack', { target: d, units: us, tech })) {
      if (eff.type === 'statMod' && eff.mods?.atk) aAtk += eff.mods.atk;
    }
    // 技自体の onAttack effects
    for (const eff of collectTechEffects(tech, 'onAttack')) {
      if (eff.type === 'statMod') {
        const tgt = eff.scope === 'target' ? d : a;
        if (eff.mods) for (const [k, v] of Object.entries(eff.mods)) {
          if (tgt === a && k === 'atk') aAtk += v;
          // target側のステ補正は戦闘中のみの一時効果として直接反映しない（カウンターで処理すべき）
        }
      }
      if (eff.type === 'counterGen') {
        const tgt = eff.scope === 'self' ? a : d;
        if (tgt.hp > 0) applyCounterGen(tgt, eff, logs, tech?.name || '技');
      }
      if (eff.type === 'heal') {
        const tgt = eff.scope === 'self' ? a : d;
        if (tgt.hp > 0 && tgt.hp < tgt.maxHp) {
          const amt = Math.min(eff.value || 0, tgt.maxHp - tgt.hp);
          if (amt > 0) { tgt.hp += amt; logs.push({ text: `  ${tech?.name}: ${tgt.name} HP${amt}回復`, type: 'heal' }); }
        }
      }
    }

    const am = getAtkBonus(a, d, us);
    const dm = getDefReduction(d, us);
    let totalDrain = 0;

    // 技命中判定（hitRate設定時のみ）
    const techHitPct = calcTechHit(a, d, tech, us);
    if (techHitPct < 100) {
      const roll = Math.random() * 100;
      if (roll >= techHitPct) {
        techMissed = true;
        logs.push({ text: `${a.name} の ${label} → ${d.name} に回避された！（命中${techHitPct}%）`, type: 'info' });
        hits.push({ uid: d.id, dmg: 'MISS', delay: 200, phase: 'miss' });
      }
    }

    for (let hit = 0; hit < numHits; hit++) {
      if (d.hp <= 0 || techMissed) break;
      let dmg = calcDamage(aAtk + am, dDef, tech, effectiveInt(a, us), effectiveInt(d, us), tDef, { attacker: a, defender: d });
      dmg = Math.max(1, dmg - dm);

      // 被ダメ時スキルディスパッチ（護りの加護negate + 棘の鎧 + 反逆の意志）
      const { negated } = dispatchOnDamaged(d, a, dmg, us, logs);
      if (negated) dmg = 0;

      d.hp = Math.max(0, d.hp - dmg);

      // 被ダメフラグ（AIトリガー用）
      if (dmg > 0) { d._wasHit = true; d.engaged = true; }

      // 不屈（miracle — dispatchOnDamaged経由でHP1復帰）
      if (d.hp <= 0) dispatchOnDamaged(d, a, 0, us, logs);

      const hitLabel = numHits > 1 ? ` (${hit + 1}/${numHits})` : '';
      logs.push({ text: `${hit === 0 ? '' : '  '}${a.name} の ${label}${hitLabel} → ${d.name} に ${dmg}ダメージ${d.hp <= 0 ? ' 【撃破】' : ''}`, type: 'atk' });
      hits.push({ uid: d.id, dmg, delay: hit * 250, phase: 'atk' });

      if (tech?.drain) totalDrain += Math.floor(dmg * tech.drain);

      // 生命吸収スキル（ディスパッチャ）
      dispatchOnAttackSelfEffects(a, logs);

      // 経験値
      if (a.team === 'player' && d.team === 'enemy') {
        const e = awardExp(a, d, d.hp <= 0, logs);
        totalExp += e;
        expUid = a.id;
      }
    }

    // ドレイン技のHP回収
    if (totalDrain > 0 && a.hp > 0) {
      const heal = Math.min(totalDrain, a.maxHp - a.hp);
      if (heal > 0) {
        a.hp += heal;
        logs.push({ text: `  ${a.name} は ${heal}HP吸収`, type: 'heal' });
        hits.push({ uid: a.id, dmg: heal, delay: numHits * 250, phase: 'heal' });
      }
    }

    // 押出(push)処理
    if (tech?.push && d.hp > 0) {
      const dx = d.x - a.x, dy = d.y - a.y;
      const len = Math.abs(dx) + Math.abs(dy);
      if (len > 0) {
        const dirX = dx === 0 ? 0 : dx / Math.abs(dx);
        const dirY = dy === 0 ? 0 : dy / Math.abs(dy);
        let pushed = false;
        for (let i = 0; i < tech.push; i++) {
          const nx = d.x + dirX, ny = d.y + dirY;
          if (getPassability(nx, ny) === 'impassable') break;
          if (us.some(u => u.x === nx && u.y === ny && u.hp > 0)) break;
          d.x = nx; d.y = ny; pushed = true;
        }
        if (pushed) logs.push({ text: `  ${d.name} を押し出した！`, type: 'info' });
      }
    }

    // 命中時スキル+技エフェクト
    if (d.hp > 0 || a.hp > 0) dispatchOnHit(a, d, us, logs, tech);

    // 撃破時効果
    if (d.hp <= 0) dispatchOnKill(a, d, us, logs, tech);
  }

  // 技回数消費
  if (tech) consumeTech(a, tech);

  // counterCost消費（衝動解放等）
  if (tech?.counterCost) {
    if (!a._counters) a._counters = {};
    a._counters[tech.counterCost.name] = (a._counters[tech.counterCost.name] || 0) - tech.counterCost.cost;
    logs.push({ text: `  ${tech.counterCost.name}${tech.counterCost.cost}消費`, type: 'info' });
  }

  // ── Step 2: 反撃（preemptive発動済みならスキップ） ──
  if (d.hp > 0 && a.hp > 0 && !isDebuffOnly && !preemptive) {
    const dist = manhattan(a, d);
    if (isBreaked(d)) {
      logs.push({ text: `  ${d.name} は反撃不能！`, type: 'info' });
    } else if (d.rangeMax > 0 && dist >= d.rangeMin && dist <= d.rangeMax) {
      const dAtk = effectiveAtk(d, us);
      const aDef = effectiveDef(a, us);
      const aTDef = getTerrainDef(a.x, a.y);
      const dmC = getDefReduction(a, us);

      let cd = Math.max(1, dAtk - (aDef + aTDef));
      cd = Math.max(1, cd - dmC);
      a.hp = Math.max(0, a.hp - cd);

      // 被ダメフラグ（AIトリガー用）
      if (cd > 0) { a._wasHit = true; a.engaged = true; }

      // 不屈（miracle）
      if (a.hp <= 0) dispatchOnDamaged(a, d, 0, us, logs);

      logs.push({ text: `  ${d.name} の反撃 → ${a.name} に ${cd}ダメージ${a.hp <= 0 ? ' 【撃破】' : ''}`, type: 'counter' });
      hits.push({ uid: a.id, dmg: cd, delay: numHits * 250 + 200, phase: 'counter' });

      // 反撃側の経験値
      if (d.team === 'player' && a.team === 'enemy') {
        const e = awardExp(d, a, a.hp <= 0, logs);
        totalExp += e;
        expUid = d.id;
      }

      // 撃破時効果
      if (a.hp <= 0) dispatchOnKill(d, a, us, logs);
    } else if (d.rangeMax <= 0) {
      logs.push({ text: `  ${d.name} は反撃手段がない`, type: 'info' });
    } else {
      logs.push({ text: `  ${d.name} は反撃できない（射程外）`, type: 'info' });
    }
  }

  // ── Step 3: 追撃（攻撃側のみ） ──
  if (a.hp > 0 && d.hp > 0 && !isDebuffOnly) {
    const dist = manhattan(a, d);
    const inRange = dist >= a.rangeMin && dist <= a.rangeMax;
    const pPct = inRange ? calcPursuit(a, d, us) : 0;
    if (pPct > 0) {
      const roll = Math.random() * 100;
      if (roll < pPct) {
        const pAtk = effectiveAtk(a, us);
        const pDef = effectiveDef(d, us) + getTerrainDef(d.x, d.y);
        const pd = Math.max(1, pAtk - pDef);
        d.hp = Math.max(0, d.hp - pd);
        // 被ダメフラグ（AIトリガー用）
        if (pd > 0) { d._wasHit = true; d.engaged = true; }
        // 不屈（miracle）
        if (d.hp <= 0) dispatchOnDamaged(d, a, 0, us, logs);
        logs.push({ text: `  追撃判定 ${pPct}% → 成功！ ${a.name} → ${d.name} に ${pd}ダメージ${d.hp <= 0 ? ' 【撃破】' : ''}`, type: 'followup' });
        hits.push({ uid: d.id, dmg: pd, delay: numHits * 250 + 500, phase: 'pursuit' });

        if (a.team === 'player' && d.team === 'enemy') {
          const e = awardExp(a, d, d.hp <= 0, logs);
          totalExp += e;
          expUid = a.id;
        }
        if (d.hp <= 0) dispatchOnKill(a, d, us, logs);
      } else {
        logs.push({ text: `  追撃判定 ${pPct}% → 失敗`, type: 'info' });
      }
    }
  }

  // ── Step 4: onCombat エフェクト（カウンター付与=デバフ等） ──
  {
    const combatEffs = collectTechEffects(tech, 'onCombat');
    for (const eff of combatEffs) {
      if (eff.type !== 'counterGen') continue;
      const tgt = eff.scope === 'self' ? a : d; // scope: self→自分、それ以外→相手
      if (tgt.hp <= 0) continue;
      // debuffOnDamage: debuffOnly技ではスキップ（ダメージなし→付与なし）
      if (tech?.debuffOnDamage && isDebuffOnly) continue;
      // 技ミス時: 対象へのカウンター付与スキップ（自分へのは通す）
      if (techMissed && eff.scope !== 'self') continue;
      const src = tech?.name || '技';
      if (eff.hitCheck) {
        const hitPct = calcCounterHit(a, tgt, eff.hitCheck.baseHit || 75);
        const roll = Math.random() * 100;
        if (roll < hitPct) {
          applyCounterGen(tgt, eff, logs, src);
          hits.push({ uid: tgt.id, dmg: eff.counter, delay: numHits * 250 + 700, phase: 'debuff_pop' });
          if (COUNTER_DEFS[eff.counter]?.status === 'タゲ固定') tgt._tauntSource = a.id;
          if (tgt === d && d.chargeCounter > 0) {
            d.chargeCounter = d.chargeTurns;
            logs.push({ text: `  ${d.name} のチャージが中断された！`, type: 'info' });
          }
        } else {
          logs.push({ text: `  ${eff.counter}判定 ${hitPct}% → 失敗`, type: 'info' });
        }
      } else {
        applyCounterGen(tgt, eff, logs, src);
        hits.push({ uid: tgt.id, dmg: eff.counter, delay: numHits * 250 + 700, phase: 'debuff_pop' });
        if (COUNTER_DEFS[eff.counter]?.status === 'タゲ固定') tgt._tauntSource = a.id;
      }
    }
  }

  const expGain = totalExp > 0 && expUid ? { uid: expUid, xp: totalExp } : null;
  return { units: us, logs, hits, expGain };
}

// ═══ 範囲攻撃実行 ═══

export function executeAoeCombat(atkUnit, dir, tech, units) {
  const us = cloneUnits(units);
  const a = us.find(u => u.id === atkUnit.id);
  const logs = [];
  const hits = [];
  let totalExp = 0;
  let expUid = null;

  const enemyTeam = a.team === 'player' ? 'enemy' : 'player';
  const areaCells = getAoeCells(a.x, a.y, tech.aoe, dir);
  a._techCanto = false; // 前回の戦闘フラグをリセット
  // 技回数消費
  consumeTech(a, tech);
  // カウンター消費
  if (tech?.cond?.counter) {
    if (!a._counters) a._counters = {};
    a._counters[tech.cond.counter] -= tech.cond.cost;
  }

  const am = getAtkBonus(a, { hp: 0, maxHp: 1 }, us);
  let hitIdx = 0;

  for (const tc of areaCells) {
    const d = us.find(u => u.x === tc.x && u.y === tc.y && u.hp > 0 && u.team === enemyTeam);
    if (!d) continue;
    const dm = getDefReduction(d, us);
    const dDef = effectiveDef(d, us);
    const tDef = getTerrainDef(d.x, d.y);
    let dmg = calcDamage(effectiveAtk(a, us) + am, dDef, tech, effectiveInt(a, us), effectiveInt(d, us), tDef, { attacker: a, defender: d });
    dmg = Math.max(1, dmg - dm);
    d.hp = Math.max(0, d.hp - dmg);

    // 被ダメフラグ（AIトリガー用）
    if (dmg > 0) { d._wasHit = true; d.engaged = true; }
    // 不屈（miracle）
    if (d.hp <= 0) dispatchOnDamaged(d, a, 0, us, logs);

    logs.push({ text: `${a.name} の ${tech.name} → ${d.name} に ${dmg}ダメージ${d.hp <= 0 ? ' 【撃破】' : ''}`, type: 'atk' });
    hits.push({ uid: d.id, dmg, delay: hitIdx * 200, phase: 'atk' });

    if (totalExp < EXP_COMBAT_CAP && a.team === 'player' && d.team === 'enemy') {
      const e = awardExp(a, d, d.hp <= 0, logs);
      totalExp += e;
      expUid = a.id;
    }
    if (d.hp <= 0) dispatchOnKill(a, d, us, logs, tech);
    hitIdx++;
  }

  // 範囲攻撃の反撃（生存者のみ）
  for (const tc of areaCells) {
    const d = us.find(u => u.x === tc.x && u.y === tc.y && u.hp > 0 && u.team === enemyTeam);
    if (!d || a.hp <= 0) continue;
    if (isBreaked(d)) continue;
    const dist = manhattan(a, d);
    if (d.rangeMax > 0 && dist >= d.rangeMin && dist <= d.rangeMax) {
      const cd = Math.max(1, effectiveAtk(d, us) - (effectiveDef(a, us) + getTerrainDef(a.x, a.y)));
      a.hp = Math.max(0, a.hp - cd);
      // 被ダメフラグ（AIトリガー用）
      if (cd > 0) { a._wasHit = true; a.engaged = true; }
      logs.push({ text: `  ${d.name} の反撃 → ${a.name} に ${cd}ダメージ${a.hp <= 0 ? ' 【撃破】' : ''}`, type: 'counter' });
      hits.push({ uid: a.id, dmg: cd, delay: hitIdx * 200 + 200, phase: 'counter' });
      hitIdx++;
    }
  }

  // 追撃（最近接対象1体）
  const survivingTargets = us.filter(u => u.team === enemyTeam && u.hp > 0 && areaCells.some(c => c.x === u.x && c.y === u.y));
  const primaryTarget = survivingTargets.sort((a2, b) => manhattan(a, a2) - manhattan(a, b))[0];
  if (primaryTarget && a.hp > 0) {
    const dist = manhattan(a, primaryTarget);
    const inRange = dist >= a.rangeMin && dist <= a.rangeMax;
    const pPct = inRange ? calcPursuit(a, primaryTarget, us) : 0;
    if (pPct > 0 && Math.random() * 100 < pPct) {
      const pd = Math.max(1, effectiveAtk(a, us) - (effectiveDef(primaryTarget, us) + getTerrainDef(primaryTarget.x, primaryTarget.y)));
      primaryTarget.hp = Math.max(0, primaryTarget.hp - pd);
      // 被ダメフラグ（AIトリガー用）
      if (pd > 0) { primaryTarget._wasHit = true; primaryTarget.engaged = true; }
      // 不屈（miracle）
      if (primaryTarget.hp <= 0) dispatchOnDamaged(primaryTarget, a, 0, us, logs);
      logs.push({ text: `  追撃 ${pPct}% → 成功！ ${a.name} → ${primaryTarget.name} に ${pd}ダメージ${primaryTarget.hp <= 0 ? ' 【撃破】' : ''}`, type: 'followup' });
      hits.push({ uid: primaryTarget.id, dmg: pd, delay: hitIdx * 200 + 400, phase: 'pursuit' });
    }
  }

  const expGain = totalExp > 0 && expUid ? { uid: expUid, xp: totalExp } : null;
  return { units: us, logs, hits, expGain };
}

// ═══ ヘルパー ═══

function cloneUnits(units) {
  return units.map(u => ({
    ...u,
    techs: u.techs.map(t => ({ ...t })),
    skills: [...(u.skills || [])],
    items: (u.items || []).map(it => ({ ...it })),
    _counters: u._counters ? { ...u._counters } : undefined,
    ...(u.expPool !== undefined ? { expPool: u.expPool } : {}),
  }));
}

function consumeTech(unit, tech) {
  if (!tech) return;
  const t = unit.techs.find(t => t.name === tech.name);
  if (t && t.maxUses < 99) {
    t.uses--;
    // consumable技: uses 0で配列から除去
    if (t.uses <= 0 && t.consumable) {
      unit.techs = unit.techs.filter(tt => tt !== t);
    }
  }
}
