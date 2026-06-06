import React, { useState } from 'react';
import { LEVEL_CAP } from '../engine/constants.js';
import { effectiveAtk, effectiveDef, effectiveInt, getSlots, getClassData } from '../engine/units.js';
import { expNext } from '../engine/levelup.js';
import { getClassTrait } from '../engine/classChange.js';
import { getTechRange, fmtRange } from '../engine/pathfinding.js';
import { canUseTech } from '../engine/combat.js';
import UnitChip from './UnitChip.jsx';
import { ModalScale } from './uiScale.jsx';

const TAG_LABEL = { fire: '炎', water: '水', wind: '風', light: '光', dark: '闇', none: '無' };
const TAG_COL   = { fire: '#ef4444', water: '#3b82f6', wind: '#22c55e', light: '#fbbf24', dark: '#a78bfa', none: '#94a3b8' };

export default function StatusScreen({ unit, units, onClose }) {
  const [desc, setDesc] = useState(null);
  if (!unit) return null;

  const u = unit;
  const isP = u.team === 'player';
  const bCol = isP ? 'rgba(59,130,246,0.4)' : 'rgba(239,68,68,0.4)';
  const hBg = isP
    ? 'linear-gradient(90deg,rgba(37,99,235,0.3),rgba(37,99,235,0.05))'
    : 'linear-gradient(90deg,rgba(239,68,68,0.3),rgba(239,68,68,0.05))';

  const atk = effectiveAtk(u, units);
  const def = effectiveDef(u, units);
  const intV = effectiveInt(u, units);
  const slots = isP ? getSlots(u) : null;
  const trait = getClassTrait(u.cls);

  const Hover = ({ text, children }) => (
    <span
      onMouseEnter={() => setDesc(text)}
      onMouseLeave={() => setDesc(null)}
      style={{ cursor: 'help' }}
    >
      {children}
    </span>
  );

  // タグバッジ（技/スキル名の横に表示）
  const TagBadge = ({ tag }) => {
    if (!tag || !TAG_COL[tag]) return null;
    return (
      <span style={{
        fontSize: 9, fontWeight: 700, padding: '0px 4px', borderRadius: 2,
        background: `${TAG_COL[tag]}22`, color: TAG_COL[tag],
        marginRight: 4,
      }}>{TAG_LABEL[tag]}</span>
    );
  };

  return (
    <div onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} style={{
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
      zIndex: 350, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: 8,
    }}>
      <ModalScale>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 820, background: 'rgba(18,22,40,0.97)',
        border: `2px solid ${bCol}`, borderRadius: 10, overflow: 'hidden',
        animation: 's-fin 0.1s ease-out',
        boxShadow: '0 8px 48px rgba(0,0,0,0.7)', cursor: 'default',
      }}>
        {/* ── ヘッダ ── */}
        <div style={{
          background: hBg, padding: '14px 28px',
          display: 'flex', alignItems: 'center', gap: 18,
          borderBottom: `1px solid ${bCol}`,
        }}>
          <UnitChip unit={u} size={54} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#e8ecf4' }}>{u.name}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 14, color: '#8b93a8' }}>{u.cls}</span>
              {trait && (
                <Hover text={trait.desc}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                    background: 'rgba(250,204,21,0.15)', color: '#fbbf24',
                    border: '1px solid rgba(250,204,21,0.3)',
                  }}>{trait.name}</span>
                </Hover>
              )}
            </div>
          </div>
          {/* タグ */}
          {u.tags && (
            <div style={{ display: 'flex', gap: 4 }}>
              {u.tags.map(t => (
                <span key={t} style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                  background: `${TAG_COL[t]}22`, color: TAG_COL[t],
                  border: `1px solid ${TAG_COL[t]}33`,
                }}>{TAG_LABEL[t] || t}</span>
              ))}
            </div>
          )}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 15, color: '#8b93a8' }}>
              Lv <span style={{ fontSize: 26, fontWeight: 700, color: '#d4d8e8' }}>{u.level}</span>
            </div>
            {isP && (
              <div style={{ fontSize: 11, color: '#5a6174' }}>
                {u.level >= LEVEL_CAP ? 'MAX' : `EXP ${u.exp}/${expNext()}`}
              </div>
            )}
          </div>
        </div>

        {/* ── ボディ ── */}
        <div style={{ padding: '16px 24px', display: 'flex', gap: 24 }}>
          {/* 左: ステータス */}
          <div style={{ width: 220, flexShrink: 0 }}>
            {/* HPバー */}
            <div style={{ fontSize: 13, color: '#8b93a8', marginBottom: 3 }}>
              HP <span style={{ fontWeight: 700, fontSize: 15, color: '#e2e8f0' }}>{u.hp}</span>
              <span style={{ color: '#5a6174' }}>/{u.maxHp}</span>
            </div>
            <div style={{
              height: 10, background: 'rgba(0,0,0,0.5)', borderRadius: 5, overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.08)', marginBottom: 14,
            }}>
              <div style={{
                width: `${(u.hp / u.maxHp) * 100}%`, height: '100%', borderRadius: 5,
                background: u.hp / u.maxHp > 0.5
                  ? 'linear-gradient(90deg,#22c55e,#4ade80)'
                  : 'linear-gradient(90deg,#eab308,#facc15)',
              }} />
            </div>

            {/* ステ一覧（STR/武器威力/ATK分離） */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 18px',
              padding: '12px 16px', background: 'rgba(0,0,0,0.3)',
              borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {[
                ['STR', u.str],
                ['武器威力', u.pp],
                ['ATK', atk],
                ['DEF', def],
                ['INT', intV],
                ['MOV', u.mov],
                ['射程', fmtRange(u.rangeMin, u.rangeMax)],
              ].map(([label, val]) => (
                <div key={label} style={{ fontSize: 13 }}>
                  <span style={{ color: '#64748b' }}>{label} </span>
                  <span style={{ fontWeight: 700, fontSize: 15, color: '#e2e8f0' }}>{val}</span>
                </div>
              ))}
            </div>

            {/* 個人特性 */}
            {u.personalTrait && (
              <Hover text={u.personalTraitDesc}>
                <div style={{
                  marginTop: 10, fontSize: 11, color: '#a78bfa',
                  padding: '5px 8px', background: 'rgba(167,139,250,0.1)',
                  borderRadius: 4, border: '1px solid rgba(167,139,250,0.2)',
                }}>
                  ♦ {u.personalTrait}: {u.personalTraitDesc}
                </div>
              </Hover>
            )}
          </div>

          {/* 右: 技・スキル・アイテム */}
          <div style={{
            flex: 1, borderLeft: '1px solid rgba(255,255,255,0.06)',
            paddingLeft: 20, minHeight: 200, overflowY: 'auto', maxHeight: 420,
          }}>
            {/* 技 */}
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 5 }}>
              技 {slots ? `${u.techs.filter(t => !t.stealth && !t.noSlot).length}/${slots.tech}` : ''}
            </div>
            {u.techs.filter(t => !t.stealth).map((t, i) => {
              const rng = getTechRange(t, u);
              const isNoSlot = !!t.noSlot;
              const isInfinite = t.maxUses >= 99;
              return (
                <Hover key={i} text={t.desc || `${t.name}`}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '5px 10px', marginBottom: 3,
                    background: isNoSlot ? 'rgba(251,191,36,0.06)' : 'rgba(59,130,246,0.08)',
                    borderRadius: 4,
                    border: `1px solid ${isNoSlot ? 'rgba(251,191,36,0.15)' : 'rgba(59,130,246,0.15)'}`,
                  }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: isNoSlot ? '#fbbf24' : '#b0c4e8' }}>
                      <TagBadge tag={t._tag} />
                      {t.name}
                    </span>
                    <span style={{ fontSize: 11, color: '#5a6174' }}>
                      射{fmtRange(rng.min, rng.max)}{isInfinite ? '' : ` ${t.uses}/${t.maxUses}`}
                    </span>
                  </div>
                </Hover>
              );
            })}

            {/* スキル（常に表示） */}
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 10, marginBottom: 5 }}>
              スキル {slots ? `${(u.skills || []).filter(sk => !sk.stealth && !sk.noSlot).length}/${slots.skill}` : ''}
            </div>
            {(u.skills || []).filter(sk => !sk.stealth).map((sk, i) => {
              const isNoSlot = !!sk.noSlot;
              return (
                <Hover key={i} text={sk.desc || sk.name}>
                  <div style={{
                    padding: '5px 10px', marginBottom: 3,
                    background: isNoSlot ? 'rgba(251,191,36,0.06)' : 'rgba(167,139,250,0.08)',
                    borderRadius: 4,
                    border: `1px solid ${isNoSlot ? 'rgba(251,191,36,0.15)' : 'rgba(167,139,250,0.15)'}`,
                    fontSize: 14, fontWeight: 600, color: isNoSlot ? '#fbbf24' : '#a78bfa',
                  }}>
                    <TagBadge tag={sk._tag} />
                    {sk.name}
                  </div>
                </Hover>
              );
            })}

            {/* アイテム（uses>0のみ表示、残数付き） */}
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 10, marginBottom: 5 }}>
              所持品 {slots ? `${(u.items || []).filter(it => it.uses > 0).length}/${slots.item}` : ''}
            </div>
            {(u.items || []).filter(it => it.uses > 0).map((it, i) => (
              <Hover key={i} text={it.desc || it.name}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '5px 10px', marginBottom: 3,
                  background: 'rgba(74,222,128,0.08)', borderRadius: 4,
                  border: '1px solid rgba(74,222,128,0.15)',
                  fontSize: 14, fontWeight: 600, color: '#6ee7a0',
                }}>
                  <span>{it.name}</span>
                  <span style={{ fontSize: 11, color: '#5a6174' }}>{it.uses}/{it.maxUses}</span>
                </div>
              </Hover>
            ))}
          </div>
        </div>
      </div>

      {/* ── 説明バー ── */}
      <div onClick={e => e.stopPropagation()} style={{
        width: 820, minHeight: 38, background: 'rgba(18,22,40,0.95)',
        border: `1px solid ${bCol}`, borderRadius: 6, padding: '8px 24px',
        cursor: 'default', transition: 'all 0.1s',
      }}>
        {desc
          ? <div style={{ fontSize: 13, color: '#c8cee0' }}>{desc}</div>
          : <div style={{ fontSize: 12, color: '#3a3f52' }}>項目にカーソルを合わせると説明が表示されます</div>
        }
      </div>
      </div>
      </ModalScale>
    </div>
  );
}
