import React, { useState } from 'react';
import { effectiveAtk, effectiveDef, effectiveInt, getSlots } from '../engine/units.js';
import { countSlotTechs, countSlotSkills, getRemovableParts } from '../engine/draft.js';
import { getTechRange, fmtRange } from '../engine/pathfinding.js';
import UnitChip from './UnitChip.jsx';
import SwapSelector from './SwapSelector.jsx';
import { ModalScale } from './uiScale.jsx';
import techs from '../data/techs.json';

const TAG_LABEL = { fire: '炎', water: '水', wind: '風', light: '光', dark: '闇', none: '無' };
const TAG_BG    = { fire: 'rgba(239,68,68,0.15)', water: 'rgba(59,130,246,0.15)', wind: 'rgba(34,197,94,0.15)', light: 'rgba(250,204,21,0.15)', dark: 'rgba(167,139,250,0.15)', none: 'rgba(148,163,184,0.15)' };
const TAG_COL   = { fire: '#ef4444', water: '#3b82f6', wind: '#22c55e', light: '#fbbf24', dark: '#a78bfa', none: '#94a3b8' };
const TYPE_COL  = { tech: '#60a5fa', skill: '#a78bfa' };
const STAT_LABEL = { hp: 'HP', str: 'STR', def: 'DEF', int: 'INT', mov: 'MOV' };
const RARITY_COL = { C: '#64748b', U: '#3b82f6', R: '#facc15' };

/**
 * DraftUI — レベルアップ時の3択パーツ選択 + CC選択
 *
 * props:
 *   unit      — レベルアップしたユニット
 *   gains     — { hp, str, def, int } ステ成長値
 *   parts     — Part[3] ドラフト候補
 *   ccOptions — { type: 'mid'|'adv', opts: [className, className] } | null
 *   units     — 全ユニット配列（実効ステ計算用）
 *   onPickPart(part) — パーツ選択（枠に空きがある場合）
 *   onSwapPart(removeName, newPart) — パーツ入れ替え
 *   onPickCC(className) — CC選択
 */
export default function DraftUI({ unit, gains, parts, ccOptions, units, onPickPart, onSwapPart, onPickCC }) {
  const [pendingSwap, setPendingSwap] = useState(null);

  if (!unit) return null;

  const u = unit;
  const sl = getSlots(u);

  // パーツクリック時: 枠に空きがあるか判定
  function handlePartClick(part) {
    const type = part.type;
    if (type === 'tech') {
      if (countSlotTechs(u) < sl.tech) {
        onPickPart(part);
      } else {
        const removables = getRemovableParts(u, 'tech');
        if (removables.length === 0) {
          // 全てlockedで入れ替え不可 → そのまま追加試行（applyPartが弾く）
          onPickPart(part);
        } else {
          setPendingSwap({ part, removables });
        }
      }
    } else if (type === 'skill') {
      if (countSlotSkills(u) < sl.skill) {
        onPickPart(part);
      } else {
        const removables = getRemovableParts(u, 'skill');
        if (removables.length === 0) {
          onPickPart(part);
        } else {
          setPendingSwap({ part, removables });
        }
      }
    } else {
      // 未知のtype → そのまま
      onPickPart(part);
    }
  }

  function handleSwapSelect(removeName) {
    if (!pendingSwap) return;
    onSwapPart(removeName, pendingSwap.part);
    setPendingSwap(null);
  }

  function handleSwapCancel() {
    setPendingSwap(null);
  }

  // 左パネルの枠表示用（_extra除外）
  const slotTechs = countSlotTechs(u);
  const slotSkills = countSlotSkills(u);

  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }}>
      <ModalScale>
      <div style={{
        background: 'linear-gradient(135deg,#141827,#1a1f35)',
        borderRadius: 12, padding: 24, width: 720, maxHeight: '92vh', overflowY: 'auto',
        border: '1px solid rgba(250,204,21,0.3)',
        boxShadow: '0 0 40px rgba(250,204,21,0.1)', animation: 's-fin 0.3s ease-out',
      }}>
        {/* ── ヘッダ ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <UnitChip unit={u} size={50} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: '#e8ecf4' }}>{u.name}</span>
              {u.tags?.map(t => (
                <span key={t} style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                  background: TAG_BG[t], color: TAG_COL[t], border: `1px solid ${TAG_COL[t]}33`,
                }}>{TAG_LABEL[t]}</span>
              ))}
            </div>
            <div style={{ fontSize: 13, color: '#8b93a8', marginTop: 2 }}>
              Lv {u.level} {u.cls} 枠 技{slotTechs}/{sl.tech} ス{slotSkills}/{sl.skill} 品{sl.item}
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#facc15', letterSpacing: 3 }}>
            LEVEL UP!
          </div>
        </div>

        {/* ── 2カラム ── */}
        <div style={{ display: 'flex', gap: 16 }}>
          {/* 左: ステータス */}
          <div style={{ width: 280, flexShrink: 0 }}>
            {/* ステ表 */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px',
              marginBottom: 12, padding: '10px 12px', background: 'rgba(0,0,0,0.3)',
              borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {[
                ['HP', u.maxHp, gains?.hp],
                ['STR', u.str, gains?.str],
                ['DEF', u.def, gains?.def],
                ['INT', u.int, gains?.int],
              ].map(([label, val, g]) => (
                <div key={label} style={{ fontSize: 11 }}>
                  <span style={{ color: '#64748b' }}>{label} </span>
                  <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{val}</span>
                  {g > 0 && <span style={{ color: '#4ade80', fontSize: 10 }}> +{g}</span>}
                </div>
              ))}
            </div>

            {/* 所持技 */}
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>
              技 ({slotTechs}/{sl.tech})
            </div>
            {u.techs.filter(t => !t._extra).map((t, i) => (
              <div key={i} style={{
                fontSize: 11, color: '#b0c4e8', padding: '3px 6px', marginBottom: 2,
                background: 'rgba(59,130,246,0.08)', borderRadius: 3,
              }}>
                {t.name}{t.locked ? ' 🔒' : ''}
              </div>
            ))}

            {/* 所持スキル */}
            {u.skills?.filter(s => !s._extra).length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>
                  スキル ({slotSkills}/{sl.skill})
                </div>
                {u.skills.filter(s => !s._extra).map((s, i) => (
                  <div key={i} style={{
                    fontSize: 11, color: '#a78bfa', padding: '3px 6px', marginBottom: 2,
                    background: 'rgba(167,139,250,0.08)', borderRadius: 3,
                  }}>
                    {s.name}{s.locked ? ' 🔒' : ''}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 右: 選択 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {pendingSwap ? (
              /* 入れ替え対象選択 */
              <SwapSelector
                newPart={pendingSwap.part}
                removables={pendingSwap.removables}
                onSelect={handleSwapSelect}
                onCancel={handleSwapCancel}
                onSkip={() => { setPendingSwap(null); onPickPart(null); }}
              />
            ) : ccOptions ? (
              /* CC選択 */
              <div>
                <div style={{
                  fontSize: 16, fontWeight: 700, color: '#facc15',
                  textAlign: 'center', marginBottom: 8, letterSpacing: 2,
                }}>
                  クラスチェンジ
                </div>
                <div style={{ fontSize: 11, color: '#8b93a8', textAlign: 'center', marginBottom: 10 }}>
                  {ccOptions.type === 'mid' ? '中級クラス' : '上級クラス'}を選択
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ccOptions.opts.map(cls => (
                    <button key={cls} onClick={() => onPickCC(cls)} style={{
                      background: 'rgba(250,204,21,0.08)',
                      border: '1px solid rgba(250,204,21,0.3)', borderRadius: 8,
                      padding: '12px 16px', cursor: 'pointer', color: '#e2e8f0',
                      textAlign: 'left', fontFamily: 'inherit',
                      transition: 'border-color 0.15s',
                    }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#facc15' }}>{cls}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* パーツ3択 */
              <div>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: '#e2e8f0',
                  textAlign: 'center', marginBottom: 10,
                }}>
                  パーツを選択
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(parts || []).map((p, i) => {
                    const techDef = p.type === 'tech' ? techs[p.techRef || p.name] : null;
                    return (
                      <button key={i} onClick={() => handlePartClick(p)} style={{
                        background: 'rgba(30,41,59,0.6)',
                        border: '1px solid #334155', borderRadius: 8,
                        padding: '10px 14px', cursor: 'pointer', color: '#e2e8f0',
                        textAlign: 'left', fontFamily: 'inherit',
                        transition: 'border-color 0.15s',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {/* タグ */}
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                              background: TAG_BG[p.tag] || 'rgba(100,116,139,0.15)',
                              color: TAG_COL[p.tag] || '#64748b',
                              border: `1px solid ${(TAG_COL[p.tag] || '#64748b')}33`,
                            }}>{TAG_LABEL[p.tag] || p.tag}</span>
                            {/* 種別+名前 */}
                            <span style={{
                              fontSize: 16, fontWeight: 700,
                              color: TYPE_COL[p.type] || '#a78bfa',
                            }}>
                              【{p.type === 'tech' ? '技' : 'スキル'}】{p.name}
                            </span>
                            {/* レアリティ */}
                            <span style={{
                              fontSize: 10, color: RARITY_COL[p.rarity] || '#64748b',
                              fontWeight: 700,
                            }}>
                              {p.rarity}
                            </span>
                          </div>
                          {/* ステ効果 */}
                          {p.statBoost && (
                            <div style={{ fontSize: 15, fontWeight: 700, color: '#4ade80' }}>
                              {Object.entries(p.statBoost)
                                .filter(([, v]) => v !== 0)
                                .map(([k, v]) => `${STAT_LABEL[k] || k}${v > 0 ? '+' : ''}${v}`)
                                .join(' ')}
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: '#8b93a8', marginTop: 3 }}>
                          {p.desc || (techDef ? techDef.desc : '')}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {/* 獲得しない */}
                <button onClick={() => onPickPart(null)} style={{
                  marginTop: 4, width: '100%', padding: '8px 0',
                  background: 'rgba(100,116,139,0.1)', border: '1px solid #334155',
                  borderRadius: 6, cursor: 'pointer', color: '#8b93a8',
                  fontFamily: 'inherit', fontSize: 12,
                }}>
                  獲得しない
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      </ModalScale>
    </div>
  );
}
