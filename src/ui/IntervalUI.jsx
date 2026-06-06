import React, { useState } from 'react';
import { HP_RECOVERY_PCT, NUM_STAGES } from '../engine/constants.js';
import { countSlotTechs, countSlotSkills, getRemovableParts } from '../engine/draft.js';
import { getSlots } from '../engine/units.js';
import UnitChip from './UnitChip.jsx';
import SwapSelector from './SwapSelector.jsx';
import { ModalScale } from './uiScale.jsx';

const TAG_LABEL = { fire: '炎', water: '水', wind: '風', light: '光', dark: '闇' };
const TAG_COL   = { fire: '#ef4444', water: '#3b82f6', wind: '#22c55e', light: '#fbbf24', dark: '#a78bfa' };
const TAG_BG    = { fire: 'rgba(239,68,68,0.15)', water: 'rgba(59,130,246,0.15)', wind: 'rgba(34,197,94,0.15)', light: 'rgba(250,204,21,0.15)', dark: 'rgba(167,139,250,0.15)' };
const RARITY_COL = { C: '#64748b', U: '#3b82f6', R: '#facc15' };
const STAT_LABEL = { hp: 'HP', str: 'STR', def: 'DEF', int: 'INT', mov: 'MOV' };

/**
 * IntervalUI — マップ間インターバル画面 + CC選択
 *
 * props:
 *   roster, stage, onNext, onUnitClick — 基本
 *   ccCurrent — { unit, ccOptions, draftParts } | null
 *   ccQueue   — string[] 残りCC対象ID
 *   onCCSelect(className)  — CC選択
 *   onCCDraft(part)        — CC後ドラフト選択
 *   onCCSwap(removeName, newPart) — CC後ドラフト入れ替え
 */
export default function IntervalUI({
  roster, stage, onNext, onUnitClick,
  ccCurrent, ccQueue,
  onCCSelect, onCCDraft, onCCSwap,
}) {
  const hasCCPending = ccCurrent != null;

  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(10,14,30,0.97)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300,
    }}>
      <ModalScale>
      <div style={{
        width: 640, background: 'linear-gradient(135deg,#141827,#1a1f35)',
        borderRadius: 12, padding: 24,
        border: '1px solid rgba(59,130,246,0.3)',
        boxShadow: '0 8px 48px rgba(0,0,0,0.7)', animation: 's-fin 0.3s ease-out',
      }}>
        {/* ── ヘッダ ── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
        }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#60a5fa', letterSpacing: 3 }}>
            INTERVAL
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            ステージ {stage + 1} → {stage + 2}
          </div>
        </div>

        {/* HP回復表示 */}
        <div style={{ fontSize: 12, color: '#4ade80', marginBottom: 12 }}>
          HP {Math.round(HP_RECOVERY_PCT * 100)}% 回復
        </div>

        {/* ── CC選択中 ── */}
        {hasCCPending ? (
          <CCPanel
            ccCurrent={ccCurrent}
            ccQueue={ccQueue}
            onCCSelect={onCCSelect}
            onCCDraft={onCCDraft}
            onCCSwap={onCCSwap}
          />
        ) : (
          <>
            {/* ── ロスター一覧 ── */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20,
            }}>
              {roster.map(u => (
                <div
                  key={u.id}
                  onClick={() => onUnitClick?.(u)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', background: 'rgba(30,41,59,0.5)',
                    border: '1px solid #1e293b', borderRadius: 6, cursor: 'pointer',
                    transition: 'border-color 0.1s',
                  }}
                >
                  <UnitChip unit={u} size={32} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{u.name}</div>
                    <div style={{ fontSize: 9, color: '#64748b' }}>
                      Lv{u.level} {u.cls}
                    </div>
                    <div style={{
                      width: '100%', height: 4, background: 'rgba(0,0,0,0.4)',
                      borderRadius: 2, overflow: 'hidden', marginTop: 2,
                    }}>
                      <div style={{
                        width: `${(u.hp / u.maxHp) * 100}%`, height: '100%',
                        background: u.hp / u.maxHp > 0.5 ? '#4ade80'
                          : u.hp / u.maxHp > 0.25 ? '#facc15' : '#ef4444',
                      }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: '#8b93a8', whiteSpace: 'nowrap' }}>
                    {u.hp}/{u.maxHp}
                  </div>
                </div>
              ))}
            </div>

            {/* ショップ（準備中） */}
            <div style={{
              padding: 12, background: 'rgba(0,0,0,0.3)', borderRadius: 6, marginBottom: 16,
            }}>
              <div style={{ fontSize: 13, color: '#64748b' }}>ショップ（準備中）</div>
            </div>

            {/* 出撃ボタン */}
            <button
              onClick={onNext}
              style={{
                width: '100%', padding: 10, fontSize: 15, fontWeight: 700,
                background: 'linear-gradient(135deg,#3b82f6,#2563eb)',
                color: '#fff', border: 'none', borderRadius: 6,
                cursor: 'pointer', letterSpacing: 3, fontFamily: 'inherit',
              }}
            >
              ステージ {stage + 2} へ出撃
            </button>
          </>
        )}
      </div>
      </ModalScale>
    </div>
  );
}

// ─── CC選択パネル（IntervalUI内） ───
function CCPanel({ ccCurrent, ccQueue, onCCSelect, onCCDraft, onCCSwap }) {
  const [pendingSwap, setPendingSwap] = useState(null);
  const { unit: u, ccOptions, draftParts } = ccCurrent;
  const remaining = (ccQueue || []).length;
  const sl = getSlots(u);

  function handlePartClick(p) {
    if (p.type === 'tech' && countSlotTechs(u) >= sl.tech) {
      const removables = getRemovableParts(u, 'tech');
      if (removables.length > 0) { setPendingSwap({ part: p, removables }); return; }
    }
    if (p.type === 'skill' && countSlotSkills(u) >= sl.skill) {
      const removables = getRemovableParts(u, 'skill');
      if (removables.length > 0) { setPendingSwap({ part: p, removables }); return; }
    }
    onCCDraft(p);
  }

  return (
    <div style={{ animation: 's-fin 0.2s ease-out' }}>
      {/* ユニット情報 */}
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
            Lv{u.level} {u.cls}
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#64748b' }}>
          残り {remaining} 人
        </div>
      </div>

      {ccOptions ? (
        /* CC2択 */
        <div>
          <div style={{
            fontSize: 16, fontWeight: 700, color: '#facc15',
            textAlign: 'center', marginBottom: 4, letterSpacing: 2,
          }}>
            クラスチェンジ
          </div>
          <div style={{
            fontSize: 11, color: '#8b93a8', textAlign: 'center', marginBottom: 12,
          }}>
            {ccOptions.type === 'mid' ? '中級クラス' : '上級クラス'}を選択
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ccOptions.opts.map(cls => (
              <button key={cls} onClick={() => onCCSelect(cls)} style={{
                background: 'rgba(250,204,21,0.08)',
                border: '1px solid rgba(250,204,21,0.3)', borderRadius: 8,
                padding: '14px 18px', cursor: 'pointer', color: '#e2e8f0',
                textAlign: 'left', fontFamily: 'inherit',
                transition: 'border-color 0.15s',
              }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#facc15' }}>{cls}</div>
              </button>
            ))}
          </div>
        </div>
      ) : pendingSwap ? (
        /* 入れ替え対象選択 */
        <SwapSelector
          newPart={pendingSwap.part}
          removables={pendingSwap.removables}
          onSelect={(removeName) => { onCCSwap(removeName, pendingSwap.part); setPendingSwap(null); }}
          onCancel={() => setPendingSwap(null)}
        />
      ) : draftParts ? (
        /* CC後ドラフト3択 */
        <div>
          <div style={{
            fontSize: 13, fontWeight: 700, color: '#e2e8f0',
            textAlign: 'center', marginBottom: 10,
          }}>
            CC特殊ドラフト — パーツを選択
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {draftParts.map((p, i) => (
              <button key={i} onClick={() => handlePartClick(p)} style={{
                background: 'rgba(30,41,59,0.6)',
                border: '1px solid #334155', borderRadius: 8,
                padding: '10px 14px', cursor: 'pointer', color: '#e2e8f0',
                textAlign: 'left', fontFamily: 'inherit',
                transition: 'border-color 0.15s',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                      background: TAG_BG[p.tag] || 'rgba(100,116,139,0.15)',
                      color: TAG_COL[p.tag] || '#64748b',
                      border: `1px solid ${(TAG_COL[p.tag] || '#64748b')}33`,
                    }}>{TAG_LABEL[p.tag] || p.tag}</span>
                    <span style={{
                      fontSize: 14, fontWeight: 700,
                      color: p.type === 'tech' ? '#60a5fa' : '#a78bfa',
                    }}>
                      【{p.type === 'tech' ? '技' : 'スキル'}】{p.name}
                    </span>
                    <span style={{ fontSize: 10, color: RARITY_COL[p.rarity] || '#64748b', fontWeight: 700 }}>
                      {p.rarity}
                    </span>
                  </div>
                  {p.statBoost && (
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#4ade80' }}>
                      {Object.entries(p.statBoost)
                        .filter(([, v]) => v !== 0)
                        .map(([k, v]) => `${STAT_LABEL[k] || k}${v > 0 ? '+' : ''}${v}`)
                        .join(' ')}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#8b93a8', marginTop: 3 }}>
                  {p.desc || ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
