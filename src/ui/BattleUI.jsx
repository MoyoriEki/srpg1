import React from 'react';
import { GW, GH } from '../engine/constants.js';
import { calcDamage, calcPursuit, calcTechHit, canUseTech } from '../engine/combat.js';
import { effectiveAtk, effectiveDef, effectiveInt, getATK } from '../engine/units.js';
import { getAtkBonus, getDefReduction } from '../engine/skills.js';
import { calcCounterHit, isSealed, isBreaked } from '../engine/debuff.js';
import { getTechRange, fmtRange, getAtkCells, manhattan } from '../engine/pathfinding.js';
import { getGrantedTechs } from '../engine/skills.js';
import { getTerrainDef } from '../engine/map.js';
import UnitChip from './UnitChip.jsx';
import { scaledStyle } from './uiScale.jsx';

// ─── メニューボタン ───
function MBtn({ children, onClick, disabled, dim, warn, heal, sub }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
        padding: '7px 10px', marginBottom: 1,
        background: warn ? 'rgba(127,29,29,0.4)'
          : heal ? 'rgba(34,197,94,0.1)'
          : dim ? 'rgba(30,41,59,0.3)' : 'rgba(30,41,59,0.5)',
        color: disabled ? '#334155'
          : warn ? '#fca5a5'
          : heal ? '#6ee7a0'
          : dim ? '#64748b' : '#e2e8f0',
        border: `1px solid ${disabled ? '#1e293b' : warn ? 'rgba(239,68,68,0.2)' : heal ? 'rgba(74,222,128,0.2)' : '#334155'}`,
        borderRadius: 4, fontSize: 13, fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
        fontFamily: 'inherit',
      }}
    >
      <span>{children}</span>
      {sub && <span style={{ fontSize: 11, color: '#64748b' }}>{sub}</span>}
    </button>
  );
}

// ─── コマンドメニュー ───
export function ActionMenu({
  unit, units, menuPos,
  onPlainAtk, onTechSelect, onItemUse, onWait, onCancel,
  canCancel,
}) {
  if (!unit || !menuPos) return null;

  const plainRange = { min: unit.rangeMin, max: unit.rangeMax };
  const baseTechs = unit.techs.filter(t => !t.stealth && canUseTech(unit, t));
  const grantedTechs = getGrantedTechs(unit).filter(t => !t.stealth && canUseTech(unit, t));
  const techs = [...baseTechs, ...grantedTechs];
  const items = unit.items || [];
  const sealed = isSealed(unit);
  const usedNoAction = unit._usedNoActionThisTurn || [];

  const enemies = units.filter(u => u.team !== unit.team && u.hp > 0);
  const allies = units.filter(u => u.team === unit.team && u.hp > 0 && u.id !== unit.id);

  // 通常攻撃: 射程内に敵がいるか
  const plainCells = getAtkCells(unit.x, unit.y, plainRange.min, plainRange.max);
  const hasPlainTarget = enemies.some(e => plainCells.some(c => c.x === e.x && c.y === e.y));

  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onCancel?.(); }}
      style={scaledStyle({
        position: 'absolute', left: menuPos.x, top: menuPos.y,
        background: 'rgba(20,24,39,0.95)', border: '1px solid #334155',
        borderRadius: 6, padding: 4, minWidth: 170, zIndex: 60,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      }, 'top left')}
    >
      {/* 通常攻撃 */}
      {plainRange.max > 0 && (
        <MBtn onClick={hasPlainTarget ? onPlainAtk : undefined} disabled={!hasPlainTarget} sub={fmtRange(plainRange.min, plainRange.max)}>
          ⚔ 通常攻撃
        </MBtn>
      )}

      {/* 技一覧 */}
      {techs.map(t => {
        const isHeal = t.type === 'heal';
        const rng = getTechRange(t, unit);
        const techCells = getAtkCells(unit.x, unit.y, rng.min, rng.max);
        // 対象チェック
        const isBuff = t.type === 'buff' || t.type === 'selfBuff';
        const isSpecial = t.type === 'special';
        let hasTarget = isSpecial;
        if (isBuff) {
          hasTarget = t.selfOnly || t.type === 'selfBuff'
            ? true // 自己バフは常に使用可
            : [...allies, unit].some(a => techCells.some(c => c.x === a.x && c.y === a.y)); // 射程内味方(自分含む)
        } else if (!hasTarget && isHeal) {
          hasTarget = allies.some(a => techCells.some(c => c.x === a.x && c.y === a.y));
        } else if (!hasTarget) {
          hasTarget = enemies.some(e => techCells.some(c => c.x === e.x && c.y === e.y));
        }
        const noTarget = !hasTarget;
        return (
          <MBtn
            key={t.name}
            onClick={noTarget ? undefined : () => onTechSelect(t)}
            disabled={noTarget || (sealed && !isBuff) || (t.noAction && usedNoAction.includes(t.name))}
            heal={isHeal}
            sub={t.maxUses >= 99 ? null : `${t.uses}/${t.maxUses}`}
          >
            ★ {t.name}
          </MBtn>
        );
      })}

      {/* アイテム */}
      {items.filter(it => it.uses > 0).map(it => (
        <MBtn key={it.name} onClick={() => onItemUse(it)} heal sub={`${it.uses}回`}>
          ◈ {it.name}
        </MBtn>
      ))}

      <MBtn dim onClick={onWait}>◇ 待機</MBtn>
      {canCancel !== false && <MBtn warn onClick={onCancel}>✕ 戻る</MBtn>}
    </div>
  );
}

// ─── 戦闘予測パネル ───
export function BattlePreview({ attacker, defender, tech, units }) {
  if (!attacker || !defender) return null;

  const atkATK = effectiveAtk(attacker, units);
  const defDEF = effectiveDef(defender, units);
  const atkINT = effectiveInt(attacker, units);
  const defINT = effectiveInt(defender, units);
  const terrDef = getTerrainDef(defender.x, defender.y);
  const atkBonus = getAtkBonus(attacker, defender, units);
  const defReduce = getDefReduction(defender, units);
  // 技自体の onAttack statMod ATK補正
  let techAtkBonus = 0;
  for (const eff of (tech?.effects || [])) {
    if (eff.trigger === 'onAttack' && eff.type === 'statMod' && eff.scope !== 'target' && eff.mods?.atk) {
      techAtkBonus += eff.mods.atk;
    }
  }

  // 攻撃ダメ計算（onAttackボーナス + 被ダメ減を反映）
  const rawDmg = tech
    ? calcDamage(atkATK + atkBonus + techAtkBonus, defDEF, tech, atkINT, defINT, terrDef, { attacker, defender })
    : calcDamage(atkATK + atkBonus, defDEF, null, atkINT, defINT, terrDef);
  const dmg = Math.max(1, rawDmg - defReduce);
  const hits = tech?.hits || 1;

  // 追撃率
  const pursuit = calcPursuit(attacker, defender, units);

  // 反撃（Bug2修正: defender側のデバフ+射程判定）
  const dist = manhattan(attacker, defender);
  const defenderBreaked = isBreaked(defender);
  const defenderInRange = defender.rangeMax > 0
    && dist >= defender.rangeMin && dist <= defender.rangeMax;
  const canCounter = !defenderBreaked && defenderInRange;
  const defATK = effectiveAtk(defender, units);
  const atkDEF = effectiveDef(attacker, units);
  const terrDefAtk = getTerrainDef(attacker.x, attacker.y);
  const counterDmg = canCounter
    ? calcDamage(defATK, atkDEF, null, defINT, atkINT, terrDefAtk)
    : 0;

  // 技命中率
  const techHitPct = calcTechHit(attacker, defender, tech, units);

  // カウンター付与（デバフ）命中
  const combatCG = (tech?.effects || []).find(e => e.trigger === 'onCombat' && e.type === 'counterGen');
  const counterHitPct = combatCG?.hitCheck
    ? calcCounterHit(attacker, defender, combatCG.hitCheck.baseHit || 75)
    : 0;

  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      style={scaledStyle({
        position: 'absolute', bottom: 20, left: '50%',
        background: 'linear-gradient(180deg,rgba(16,20,36,0.97),rgba(10,12,24,0.97))',
        borderRadius: 12, padding: '20px 52px',
        display: 'flex', alignItems: 'center', gap: 36, zIndex: 55,
        border: '1px solid rgba(239,68,68,0.3)',
        boxShadow: '0 6px 36px rgba(0,0,0,0.7),0 0 20px rgba(239,68,68,0.08)',
      }, 'bottom center', 'translateX(-50%)')}
    >
      {/* 攻撃側 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <UnitChip unit={attacker} size={40} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>{attacker.name}</div>
          <div style={{ fontSize: 13, color: '#8b93a8' }}>
            HP {attacker.hp}/{attacker.maxHp}
          </div>
        </div>
      </div>

      {/* 中央: ダメージ情報 */}
      <div style={{ textAlign: 'center', minWidth: 120 }}>
        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>
          {tech ? `★ ${tech.name}` : '⚔ 通常攻撃'}
        </div>
        <div style={{ fontSize: 28, fontWeight: 900, color: '#fbbf24' }}>
          {dmg}{hits > 1 ? ` ×${hits}` : ''}
        </div>
        {tech?.hitRate != null && (
          <div style={{ fontSize: 12, color: '#f87171' }}>命中 {techHitPct}%</div>
        )}
        {pursuit > 0 && (
          <div style={{ fontSize: 12, color: '#c4b5fd' }}>追撃 {pursuit}%</div>
        )}
        {combatCG && (
          <div style={{ fontSize: 12, color: '#fbbf24' }}>
            {combatCG.counter} {combatCG.hitCheck ? `${counterHitPct}%` : '確定'}
          </div>
        )}
        <div style={{
          fontSize: 12, marginTop: 2,
          color: canCounter ? '#fca5a5' : '#475569',
          opacity: canCounter ? 1 : 0.6,
        }}>
          反撃 {canCounter ? counterDmg : '−−'}
          {!canCounter && defenderBreaked && ' (封印)'}
          {!canCounter && !defenderBreaked && !defenderInRange && ' (射程外)'}
        </div>
      </div>

      {/* 防御側 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>{defender.name}</div>
          <div style={{ fontSize: 13, color: '#8b93a8' }}>
            HP {defender.hp}/{defender.maxHp}
          </div>
        </div>
        <UnitChip unit={defender} size={40} />
      </div>
    </div>
  );
}

// ─── 右クリックコンテキストメニュー ───
export function ContextMenu({ pos, onEndTurn, onClearMarks, onClose, hasMarks }) {
  if (!pos) return null;
  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      style={scaledStyle({
        position: 'absolute',
        left: Math.min(pos.x, GW - 240), top: Math.min(pos.y, GH - 200),
        background: 'rgba(20,24,39,0.95)', border: '1px solid #334155',
        borderRadius: 6, padding: 4, minWidth: 120, zIndex: 70,
      }, 'top left')}
    >
      <MBtn onClick={onEndTurn}>ターン終了</MBtn>
      {hasMarks && <MBtn warn onClick={onClearMarks}>マーキング解除</MBtn>}
      <MBtn dim onClick={onClose}>閉じる</MBtn>
    </div>
  );
}

