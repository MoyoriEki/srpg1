// ═══ スキルエフェクト・ディスパッチャ ═══
import { getAdj } from './pathfinding.js';
import { makeTech, addSkill } from './units.js';
import { COUNTER_DEFS } from './constants.js';
import classesJson from '../data/classes.json';
import traitsJson from '../data/traits.json';
import partsData from '../data/parts.json';

const ALL_PARTS = partsData.filter(p => !p._comment);

// ── カウンター由来のeffects収集 ──
export function collectCounterEffects(unit, trigger) {
  if (!unit._counters) return [];
  const results = [];
  for (const [name, count] of Object.entries(unit._counters)) {
    if (count <= 0) continue;
    const def = COUNTER_DEFS[name];
    if (!def?.effects) continue;
    for (const eff of def.effects) {
      if (eff.trigger !== trigger) continue;
      results.push({ ...eff, _counterName: name, _counterCount: count });
    }
  }
  return results;
}

// ── ヘルパー: counterGen共通処理（マイナス対応+0以下削除） ──
export function applyCounterGen(unit, eff, logs, src) {
  if (!unit._counters) unit._counters = {};
  const def = COUNTER_DEFS[eff.counter];
  const cap = def?.max ?? eff.max ?? 99;
  const prev = unit._counters[eff.counter] || 0;
  const newVal = prev + (eff.amount || 1);
  if (newVal <= 0) {
    delete unit._counters[eff.counter];
    if (Object.keys(unit._counters).length === 0) unit._counters = undefined;
    if (logs) logs.push({ text: `  ${src}: ${eff.counter} 消滅`, type: 'info' });
  } else {
    unit._counters[eff.counter] = Math.min(cap, newVal);
    const amt = eff.amount || 1;
    if (logs) logs.push({ text: `  ${src}: ${eff.counter}${amt > 0 ? '+' : ''}${amt} (${unit._counters[eff.counter]}/${cap})`, type: 'info' });
  }
}

// ── ヘルパー: エフェクトの値をカウンター参照で解決 ──
function resolveValue(eff, unit) {
  if (eff.source === 'counter') {
    return ((unit._counters && unit._counters[eff.counter]) || 0) * (eff.mult || 1);
  }
  return eff.value || 0;
}

// ── ヘルパー: パーツ名からスキルオブジェクト生成 ──
function makeSkillFromPart(name) {
  const part = ALL_PARTS.find(p => p.type === 'skill' && p.name === name);
  if (!part) return null;
  const sk = { name: part.name, effects: part.effects || [], desc: part.desc || '', _tag: part.tag };
  if (part.unique) sk.unique = true;
  if (part.locked) sk.locked = true;
  return sk;
}

// ── 共通変異エフェクト（grantSkill/removeTech/removeSkill） ──
// 全dispatchから呼べる。処理したらtrue返す
function applyMutationEffect(unit, eff, logs, src) {
  switch (eff.type) {
    case 'grantSkill': {
      const sk = makeSkillFromPart(eff.skill);
      if (sk && addSkill(unit, sk)) {
        if (logs) logs.push({ text: `  ${src}: ${unit.name} がスキル「${sk.name}」を獲得`, type: 'info' });
      }
      return true;
    }
    case 'removeTech': {
      const idx = unit.techs.findIndex(t => t.name === eff.tech);
      if (idx >= 0 && !unit.techs[idx].locked) {
        unit.techs.splice(idx, 1);
        if (logs) logs.push({ text: `  ${src}: ${unit.name} の技「${eff.tech}」が消失`, type: 'info' });
      }
      return true;
    }
    case 'removeSkill': {
      const idx = unit.skills.findIndex(s => s.name === eff.skill);
      if (idx >= 0 && !unit.skills[idx].locked) {
        unit.skills.splice(idx, 1);
        if (logs) logs.push({ text: `  ${src}: ${unit.name} のスキル「${eff.skill}」が消失`, type: 'info' });
      }
      return true;
    }
  }
  return false;
}

// ── 兵種特性 ──
const CLASS_TRAITS = {};
for (const [name, data] of Object.entries(classesJson.classes)) {
  if (data.trait) CLASS_TRAITS[name] = data.trait;
}
export function getTrait(unit) {
  return CLASS_TRAITS[unit.cls] || null;
}

// ── 特性effects収集（兵種特性+個人特性） ──
export function getTraitEffects(unit) {
  const results = [];
  const traitId = getTrait(unit);
  const personalId = unit.personalTrait;
  if (traitId && traitsJson[traitId]?.effects) {
    results.push(...traitsJson[traitId].effects);
  }
  if (personalId && traitsJson[personalId]?.effects) {
    results.push(...traitsJson[personalId].effects);
  }
  return results;
}

// ── hasSkillName（pathfinding.js等で名前チェック用） ──
export function hasSkillName(unit, name) {
  return (unit.skills || []).some(s => s.name === name);
}

// ── 技エフェクト収集（使用中の技のeffects配列からtrigger一致を返す） ──

export function collectTechEffects(tech, trigger) {
  if (!tech?.effects) return [];
  return tech.effects.filter(e => e.trigger === trigger);
}

// ── ユニットの全技からeffects収集（turnStart/turnEnd等、特定の技に限定しない場面用） ──

export function collectAllTechEffects(unit, trigger) {
  const results = [];
  for (const tech of (unit.techs || [])) {
    for (const eff of (tech.effects || [])) {
      if (eff.trigger === trigger) results.push({ ...eff, _techName: tech.name });
    }
  }
  return results;
}

// ── 付与技収集（grantTech） ──

export function getGrantedTechs(unit) {
  const results = [];
  for (const skill of (unit.skills || [])) {
    for (const eff of (skill.effects || [])) {
      if (eff.type !== 'grantTech') continue;
      // cond: カウンター閾値チェック
      if (eff.cond?.counter) {
        const count = unit._counters?.[eff.cond.counter] || 0;
        if (count < (eff.cond.min || 0)) continue;
      }
      const tech = makeTech(eff.tech);
      if (!tech) continue;
      tech._granted = true;
      tech._grantSkill = skill.name;
      results.push(tech);
    }
  }
  return results;
}

// ── エフェクト収集 ──

export function collectEffects(unit, trigger, ctx = {}) {
  const results = [];
  // スキルのeffects
  for (const skill of (unit.skills || [])) {
    for (const eff of (skill.effects || [])) {
      if (eff.trigger !== trigger) continue;
      if (eff.cond && !checkCond(eff.cond, unit, ctx)) continue;
      if (eff.once && skill._usedOnce) continue;
      if (eff.perTurn && skill._usedThisTurn) continue;
      results.push({ ...eff, _skill: skill });
    }
  }
  // 特性のeffects
  for (const eff of getTraitEffects(unit)) {
    if (eff.trigger !== trigger) continue;
    if (eff.cond && !checkCond(eff.cond, unit, ctx)) continue;
    results.push({ ...eff, _trait: true });
  }
  return results;
}

export function collectAdjEffects(unit, units, scope) {
  const results = [];
  if (!units) return results;
  const adj = getAdj(unit.x, unit.y);
  for (const pos of adj) {
    const other = units.find(u => u.x === pos.x && u.y === pos.y && u.hp > 0 && u.id !== unit.id);
    if (!other) continue;
    const isSameTeam = other.team === unit.team;
    if (scope === 'adjAlly' && !isSameTeam) continue;
    if (scope === 'adjEnemy' && isSameTeam) continue;
    for (const skill of (other.skills || [])) {
      for (const eff of (skill.effects || [])) {
        if (eff.trigger !== 'always') continue;
        if (eff.scope !== scope) continue;
        results.push({ ...eff, _skill: skill, _source: other });
      }
    }
  }
  return results;
}

// ── 条件チェック ──

function checkCond(cond, unit, ctx) {
  if (cond.selfHpPct) {
    const pct = (unit.hp / unit.maxHp) * 100;
    if (!evalOp(pct, cond.selfHpPct)) return false;
  }
  if (cond.targetHpPct && ctx.target) {
    const pct = (ctx.target.hp / ctx.target.maxHp) * 100;
    if (!evalOp(pct, cond.targetHpPct)) return false;
  }
  if (cond.stat) {
    const val = unit[cond.stat] || 0;
    const op = cond.op || '>=';
    if (!evalOpNum(val, op, cond.val)) return false;
  }
  if (cond.barehanded) {
    const hasItems = (unit.items || []).filter(it => it.uses > 0).length > 0;
    if (hasItems) return false;
  }
  if (cond.counter) {
    const count = unit._counters?.[cond.counter] || 0;
    if (count < (cond.cost || cond.min || 0)) return false;
  }
  if (cond.techRangeMin && ctx.tech) {
    const rangeMin = ctx.tech.rangeMin || (ctx.tech.rangeType === 'intDiv' ? 2 : 1);
    if (rangeMin < cond.techRangeMin) return false;
  }
  if (cond.ownTurn && !unit._isOwnTurn) return false;
  return true;
}

function evalOp(val, expr) {
  const m = expr.match(/^([<>=!]+)(\d+)$/);
  if (!m) return true;
  const num = Number(m[2]);
  switch (m[1]) {
    case '<=': return val <= num;
    case '>=': return val >= num;
    case '<':  return val < num;
    case '>':  return val > num;
    case '==': return val === num;
    default: return true;
  }
}

function evalOpNum(val, op, num) {
  switch (op) {
    case '<=': return val <= num;
    case '>=': return val >= num;
    case '<':  return val < num;
    case '>':  return val > num;
    case '==': return val === num;
    default: return val >= num;
  }
}

// ── ステ補正集計（cond付きself + adjAlly + adjEnemy） ──

export function sumStatMod(unit, stat, units) {
  let total = 0;
  // cond付きのself always（無手の誇り等）を動的に評価
  for (const eff of collectEffects(unit, 'always')) {
    if (eff.type === 'statMod' && eff.scope === 'self' && eff.cond && eff.mods?.[stat]) {
      total += eff.mods[stat];
    }
    // statScale: カウンター数に応じたステ加算（苦痛の印等）
    if (eff.type === 'statScale' && eff.stat === stat) {
      if (eff.source === 'counter') {
        const count = (unit._counters && unit._counters[eff.counter]) || 0;
        total += count * (eff.mult || 1);
      }
    }
  }
  // カウンター由来の常時効果
  for (const eff of collectCounterEffects(unit, 'always')) {
    if (eff.type === 'statMod' && eff.mods?.[stat]) {
      total += eff.mods[stat];
    }
    if (eff.type === 'statScale' && eff.stat === stat) {
      if (eff.source === 'counter') {
        total += eff._counterCount * (eff.mult || 1);
      }
    }
  }
  // 隣接味方のadjAllyスキル
  for (const eff of collectAdjEffects(unit, units, 'adjAlly')) {
    if (eff.type === 'statMod' && eff.mods?.[stat]) total += eff.mods[stat];
  }
  // 隣接敵のadjEnemyスキル
  for (const eff of collectAdjEffects(unit, units, 'adjEnemy')) {
    if (eff.type === 'statMod' && eff.mods?.[stat]) total += eff.mods[stat];
  }
  return total;
}

// ── 戦闘時補正 ──

export function getAtkBonus(attacker, defender, units) {
  let bonus = 0;
  const effs = [...collectEffects(attacker, 'onAttack', { target: defender, units }), ...collectCounterEffects(attacker, 'onAttack')];
  for (const eff of effs) {
    if (eff.type === 'statMod' && eff.scope === 'self' && eff.mods?.atk) {
      bonus += eff.mods.atk;
    }
    if (eff.type === 'statScale') {
      bonus += Math.floor((attacker[eff.scaleStat] || 0) / eff.divisor);
    }
  }
  return bonus;
}

export function getDefReduction(defender, units) {
  let red = 0;
  const effs = [...collectEffects(defender, 'onDefend', { units }), ...collectCounterEffects(defender, 'onDefend')];
  for (const eff of effs) {
    if (eff.type === 'dmgReduce') red += eff.value;
  }
  for (const eff of collectAdjEffects(defender, units, 'adjAlly')) {
    if (eff.type === 'dmgReduce') red += eff.value;
  }
  return red;
}

export function getDebuffHitBonus(attacker) {
  let bonus = 0;
  for (const eff of [...collectEffects(attacker, 'always'), ...collectCounterEffects(attacker, 'always')]) {
    if (eff.type === 'debuffHitBonus' && eff.scope === 'self') bonus += eff.value;
  }
  return bonus;
}

export function getHealBonus(healer) {
  let bonus = 0;
  for (const eff of [...collectEffects(healer, 'always'), ...collectCounterEffects(healer, 'always')]) {
    if (eff.type === 'healBonus' && eff.scope === 'self') bonus += eff.value;
  }
  return bonus;
}

// ── 追撃率ボーナス ──

export function pursuitBonus(unit) {
  let bonus = 0;
  for (const eff of [...collectEffects(unit, 'always'), ...collectCounterEffects(unit, 'always')]) {
    if (eff.type === 'pursuitMod') bonus += (eff.value || 0);
  }
  return bonus;
}

// ── delayedStatMod ──

export function getDelayedStatMod(unit, stat) {
  if (!unit._activeDelayedMods) return 0;
  let total = 0;
  for (const m of unit._activeDelayedMods) {
    if (m.mods[stat]) total += m.mods[stat];
  }
  return total;
}

// ── イベントディスパッチ ──

export function dispatchOnKill(killer, target, units, logs, tech) {
  const effs = [
    ...collectEffects(killer, 'onKill', { target, units }),
    ...collectTechEffects(tech, 'onKill'),
    ...collectCounterEffects(killer, 'onKill'),
  ];
  for (const eff of effs) {
    const src = eff._skill?.name || eff._techName || tech?.name || '効果';
    if (applyMutationEffect(killer, eff, logs, src)) continue;
    switch (eff.type) {
      case 'fixedDmg': {
        const fdmg = resolveValue(eff, killer);
        if (eff.scope === 'killAdjEnemy') {
          const adj = getAdj(target.x, target.y);
          for (const pos of adj) {
            const t = units.find(u => u.x === pos.x && u.y === pos.y && u.hp > 0 && u.team === target.team && u.id !== target.id);
            if (t) {
              t.hp = Math.max(0, t.hp - fdmg);
              logs.push({ text: `  ${src}: ${t.name} に ${fdmg}ダメージ${t.hp <= 0 ? ' 【撃破】' : ''}`, type: 'atk' });
            }
          }
        }
        if (eff.scope === 'target' && target.hp <= 0) break; // 既に撃破済み
        break;
      }
      case 'heal': {
        if (eff.scope === 'self' && killer.hp > 0) {
          const amt = Math.min(eff.value, killer.maxHp - killer.hp);
          if (amt > 0) { killer.hp += amt; logs.push({ text: `  ${src}: ${killer.name} HP${amt}回復`, type: 'heal' }); }
        }
        break;
      }
      case 'counterGen': {
        applyCounterGen(killer, eff, logs, src);
        break;
      }
      case 'canto': {
        if (killer.hp > 0) killer._techCanto = true;
        break;
      }
      case 'applyDebuff': {
        // カウンターベースに変換: debuff.name をカウンターとして付与
        if (eff.scope === 'target' && target.hp > 0) {
          applyCounterGen(target, { counter: eff.debuff.name, amount: eff.debuff.turns || 1, max: 99 }, logs, src);
        }
        break;
      }
      case 'statMod': {
        if (eff.scope === 'self' && eff.mods && killer.hp > 0) {
          if (!killer._delayedMods) killer._delayedMods = [];
          killer._delayedMods.push({ mods: eff.mods, source: src });
          logs.push({ text: `  ${src}: 次ターン${Object.entries(eff.mods).map(([k,v])=>`${k.toUpperCase()}${v>0?'+':''}${v}`).join('/')}`, type: 'buff' });
        }
        break;
      }
      case 'dropBonus': break;
    }
  }
}

export function dispatchOnHeal(healer, target, units, logs) {
  const effs = [...collectEffects(healer, 'onHeal', { target, units }), ...collectCounterEffects(healer, 'onHeal')];
  for (const eff of effs) {
    if (eff.type === 'heal' && eff.scope === 'adjTarget') {
      const adj = getAdj(target.x, target.y);
      for (const pos of adj) {
        const ally = units.find(u => u.x === pos.x && u.y === pos.y && u.hp > 0 && u.team === healer.team);
        if (ally && ally.hp < ally.maxHp) {
          const amt = Math.min(eff.value, ally.maxHp - ally.hp);
          ally.hp += amt;
          logs.push({ text: `  ${eff._skill.name}: ${ally.name} HP${amt}回復`, type: 'heal' });
        }
      }
    }
  }
}

export function dispatchOnHit(attacker, defender, units, logs, tech) {
  const effs = [
    ...collectEffects(attacker, 'onHit', { target: defender, units }),
    ...collectTechEffects(tech, 'onHit'),
    ...collectCounterEffects(attacker, 'onHit'),
  ];
  for (const eff of effs) {
    const src = eff._skill?.name || eff._techName || tech?.name || '効果';
    if (applyMutationEffect(attacker, eff, logs, src)) continue;
    switch (eff.type) {
      case 'applyDebuff': {
        if (eff.scope === 'target' && defender.hp > 0) {
          applyCounterGen(defender, { counter: eff.debuff.name, amount: eff.debuff.turns || 1, max: 99 }, logs, src);
        }
        break;
      }
      case 'delayedStatMod': {
        if (eff.scope === 'self' && eff.delay === 'nextTurn' && attacker.hp > 0) {
          if (!attacker._delayedMods) attacker._delayedMods = [];
          attacker._delayedMods.push({ mods: eff.mods, source: src });
          logs.push({ text: `  ${src}: ${attacker.name} 次ターン${Object.entries(eff.mods).map(([k,v])=>`${k.toUpperCase()}${v>0?'+':''}${v}`).join('/')}`, type: 'buff' });
        }
        break;
      }
      case 'heal': {
        if (eff.scope === 'self' && attacker.hp > 0 && attacker.hp < attacker.maxHp) {
          const amt = Math.min(eff.value || 0, attacker.maxHp - attacker.hp);
          if (amt > 0) { attacker.hp += amt; logs.push({ text: `  ${src}: ${attacker.name} HP${amt}回復`, type: 'heal' }); }
        }
        break;
      }
      case 'counterGen': {
        const cTarget = eff.scope === 'target' ? defender : attacker;
        if (cTarget.hp > 0) applyCounterGen(cTarget, eff, logs, src);
        break;
      }
      case 'fixedDmg': {
        if (eff.scope === 'target' && defender.hp > 0) {
          const fdmg = resolveValue(eff, attacker);
          defender.hp = Math.max(0, defender.hp - fdmg);
          logs.push({ text: `  ${src}: ${defender.name} に ${fdmg}固定ダメージ${defender.hp <= 0 ? ' 【撃破】' : ''}`, type: 'atk' });
        }
        break;
      }
      case 'canto': {
        if (attacker.hp > 0) attacker._techCanto = true;
        break;
      }
      case 'statMod': {
        if (eff.scope === 'self' && eff.mods && attacker.hp > 0) {
          if (!attacker._delayedMods) attacker._delayedMods = [];
          attacker._delayedMods.push({ mods: eff.mods, source: src });
          logs.push({ text: `  ${src}: 次ターン${Object.entries(eff.mods).map(([k,v])=>`${k.toUpperCase()}${v>0?'+':''}${v}`).join('/')}`, type: 'buff' });
        }
        break;
      }
    }
  }
}

export function dispatchOnDamaged(defender, attacker, dmgDealt, units, logs) {
  let negated = false;
  const effs = [...collectEffects(defender, 'onDamaged', { attacker, units }), ...collectCounterEffects(defender, 'onDamaged')];

  for (const eff of effs) {
    if (eff.type === 'negate') {
      negated = true;
      logs.push({ text: `  ${eff._skill.name}発動！ ${defender.name} は攻撃を無効化！`, type: 'heal' });
      if (eff.consume) {
        const idx = defender.skills.findIndex(s => s.name === eff._skill.name);
        if (idx >= 0) defender.skills.splice(idx, 1);
      }
      if (eff.once) eff._skill._usedOnce = true;
      break;
    }
  }

  if (!negated && dmgDealt > 0) {
    for (const eff of effs) {
      if (eff.type === 'negate') continue;
      switch (eff.type) {
        case 'fixedDmg': {
          if (eff.scope === 'attacker' && attacker.hp > 0) {
            const fdmg = resolveValue(eff, defender);
            attacker.hp = Math.max(0, attacker.hp - fdmg);
            logs.push({ text: `  ${eff._skill.name}: ${attacker.name} に ${fdmg}ダメージ${attacker.hp <= 0 ? ' 【撃破】' : ''}`, type: 'counter' });
          }
          break;
        }
        case 'counterGen': {
          applyCounterGen(defender, eff, logs, eff._skill?.name || '効果');
          break;
        }
        case 'delayedStatMod': {
          // 報復等: 次ターンのステ補正
          if (eff.scope === 'self' && defender.hp > 0) {
            if (!defender._delayedMods) defender._delayedMods = [];
            defender._delayedMods.push({ mods: eff.mods, source: eff._skill?.name || '特性' });
          }
          break;
        }
        case 'miracle': {
          // 不屈: HP0をHP1で耐える
          if (defender.hp <= 0 && !defender._miracleUsed) {
            defender.hp = 1;
            defender._miracleUsed = true;
            logs.push({ text: `  不屈！ ${defender.name} はHP1で耐えた！`, type: 'info' });
          }
          break;
        }
      }
    }
  }

  return { negated };
}

export function dispatchOnAttackSelfEffects(attacker, logs) {
  const effs = [...collectEffects(attacker, 'onAttack', {}), ...collectCounterEffects(attacker, 'onAttack')];
  for (const eff of effs) {
    if (eff.type === 'heal' && eff.scope === 'self' && attacker.hp > 0 && attacker.hp < attacker.maxHp) {
      const amt = Math.min(eff.value, attacker.maxHp - attacker.hp);
      if (amt > 0) {
        attacker.hp += amt;
        logs.push({ text: `  ${eff._skill.name}: ${attacker.name} HP${amt}回復`, type: 'heal' });
      }
    }
  }
}

export function dispatchTurnStart(unit, units, logs) {
  if (unit._delayedMods?.length > 0) {
    unit._activeDelayedMods = [...unit._delayedMods];
    unit._delayedMods = [];
  } else {
    unit._activeDelayedMods = null;
  }

  // revenge: delayedStatModベースに移行済み（_delayedModsで自動処理）

  const effs = [
    ...collectEffects(unit, 'turnStart', { units }),
    ...collectAllTechEffects(unit, 'turnStart'),
    ...collectCounterEffects(unit, 'turnStart'),
  ];
  for (const eff of effs) {
    const src = eff._skill?.name || eff._techName || '効果';
    if (applyMutationEffect(unit, eff, logs, src)) continue;
    switch (eff.type) {
      case 'dotDamage': {
        if (unit.hp > 0) {
          const dmg = resolveValue(eff, unit);
          if (dmg > 0) {
            unit.hp = Math.max(0, unit.hp - dmg);
            if (logs) logs.push({ text: `  ${src}: ${unit.name} にHP${dmg}ダメージ`, type: 'debuff' });
          }
        }
        break;
      }
      case 'extraAction': {
        if (eff.cond?.counter) {
          const count = unit._counters?.[eff.cond.counter] || 0;
          if (count >= eff.cond.cost) {
            unit._counters[eff.cond.counter] -= eff.cond.cost;
            unit._extraAction = true;
            if (logs) logs.push({ text: `  ${eff.cond.counter}${eff.cond.cost}消費→2回行動！`, type: 'info' });
          }
        }
        break;
      }
      case 'heal': {
        if (eff.scope === 'self' && unit.hp > 0 && unit.hp < unit.maxHp) {
          const amt = Math.min(resolveValue(eff, unit), unit.maxHp - unit.hp);
          if (amt > 0) { unit.hp += amt; if (logs) logs.push({ text: `  ${src}: ${unit.name} HP${amt}回復`, type: 'heal' }); }
        }
        break;
      }
      case 'counterGen': {
        if (unit.hp > 0) applyCounterGen(unit, eff, logs, src);
        break;
      }
      case 'statMod': {
        if (eff.scope === 'self' && eff.mods && unit.hp > 0) {
          if (!unit._delayedMods) unit._delayedMods = [];
          unit._delayedMods.push({ mods: eff.mods, source: src });
          if (logs) logs.push({ text: `  ${src}: 次ターン${Object.entries(eff.mods).map(([k,v])=>`${k.toUpperCase()}${v>0?'+':''}${v}`).join('/')}`, type: 'buff' });
        }
        break;
      }
    }
  }

  for (const skill of (unit.skills || [])) { skill._usedThisTurn = false; }
}

export function dispatchTurnEnd(unit, units, logs) {
  const effs = [
    ...collectEffects(unit, 'turnEnd', { units }),
    ...collectAllTechEffects(unit, 'turnEnd'),
    ...collectCounterEffects(unit, 'turnEnd'),
  ];
  for (const eff of effs) {
    const src = eff._skill?.name || eff._techName || '効果';
    if (applyMutationEffect(unit, eff, logs, src)) continue;
    if (eff.type === 'cleanse' && eff.scope === 'adjAlly') {
      const adj = getAdj(unit.x, unit.y);
      for (const pos of adj) {
        const ally = units.find(u => u.x === pos.x && u.y === pos.y && u.hp > 0 && u.team === unit.team && u.id !== unit.id);
        if (ally?._counters) {
          const removed = [];
          for (const [k, v] of Object.entries(ally._counters)) {
            if (COUNTER_DEFS[k]?.debuff && v > 0) {
              removed.push(k);
              delete ally._counters[k];
            }
          }
          if (Object.keys(ally._counters).length === 0) ally._counters = undefined;
          if (removed.length > 0) {
            logs.push({ text: `  ${src}: ${ally.name} のデバフ解除 (${removed.join(',')})`, type: 'heal' });
          }
        }
      }
    }
    if (eff.type === 'dotDamage' && unit.hp > 0) {
      const dmg = resolveValue(eff, unit);
      if (dmg > 0) {
        unit.hp = Math.max(0, unit.hp - dmg);
        logs.push({ text: `  ${src}: ${unit.name} にHP${dmg}ダメージ`, type: 'debuff' });
      }
    }
    if (eff.type === 'heal' && eff.scope === 'self' && unit.hp > 0 && unit.hp < unit.maxHp) {
      const amt = Math.min(resolveValue(eff, unit), unit.maxHp - unit.hp);
      if (amt > 0) { unit.hp += amt; logs.push({ text: `  ${src}: ${unit.name} HP${amt}回復`, type: 'heal' }); }
    }
    if (eff.type === 'counterGen' && unit.hp > 0) {
      applyCounterGen(unit, eff, logs, src);
    }
  }
}
