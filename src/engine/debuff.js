// ═══ デバフ状態チェック（カウンター + status ベース） ═══
import { DEBUFF_HIT_PER_INT, STATUS_COUNTERS } from './constants.js';
import { getDebuffHitBonus } from './skills.js';

// カウンター付与命中率計算
export function calcCounterHit(attacker, defender, baseHit) {
  const obsBonus = getDebuffHitBonus(attacker);
  const intDiff = (attacker.int - defender.int) * DEBUFF_HIT_PER_INT;
  return Math.max(0, Math.min(100, baseHit + intDiff + obsBonus));
}

// status を持つカウンターがユニットに乗っているか
export function hasStatus(unit, status) {
  const names = STATUS_COUNTERS[status];
  if (!names || !unit._counters) return false;
  return names.some(n => (unit._counters[n] || 0) > 0);
}

// 特定カウンターの有無チェック
export function hasDebuff(unit, name) {
  return (unit._counters?.[name] || 0) > 0;
}

// 行動不能（氷結等: 全行動封じ）
export function isStunned(unit) {
  return hasStatus(unit, '行動不能');
}

export function isBreaked(unit) {
  return hasStatus(unit, '反撃不能') || isStunned(unit);
}

export function isSealed(unit) {
  return hasStatus(unit, '技不能') || isStunned(unit);
}

export function isBound(unit) {
  return hasStatus(unit, '移動不能') || isStunned(unit);
}

export function isTaunted(unit) {
  return hasStatus(unit, 'タゲ固定');
}
