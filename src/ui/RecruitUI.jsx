import React from 'react';
import UnitChip from './UnitChip.jsx';
import { ModalScale } from './uiScale.jsx';

const TAG_LABEL = { fire: '炎', water: '水', wind: '風', light: '光', dark: '闇' };
const TAG_COL   = { fire: '#ef4444', water: '#3b82f6', wind: '#22c55e', light: '#fbbf24', dark: '#a78bfa' };

/**
 * RecruitUI — M1後の合流選択画面
 *
 * props:
 *   candidates — Unit[3] 合流候補
 *   picked     — string[] 選択済みユニットID
 *   onToggle(unitId)  — 選択/解除
 *   onConfirm         — 確定
 *   onUnitClick(unit)  — ステータス詳細
 */
export default function RecruitUI({ candidates, picked, onToggle, onConfirm, onUnitClick }) {
  const canConfirm = picked.length === 2;

  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(10,14,30,0.97)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300,
    }}>
      <ModalScale>
      <div style={{
        width: 640, background: 'linear-gradient(135deg,#141827,#1a1f35)',
        borderRadius: 12, padding: 24,
        border: '1px solid rgba(250,204,21,0.3)',
        boxShadow: '0 0 40px rgba(250,204,21,0.1)', animation: 's-fin 0.3s ease-out',
      }}>
        {/* ── ヘッダ ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#facc15', letterSpacing: 3 }}>
            仲間が合流!
          </div>
          <div style={{ fontSize: 12, color: '#8b93a8', marginTop: 4 }}>
            3人の中から2人を選んでパーティに加えよう
          </div>
        </div>

        {/* ── 候補カード ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {candidates.map(u => {
            const isPicked = picked.includes(u.id);
            return (
              <div
                key={u.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px',
                  background: isPicked ? 'rgba(250,204,21,0.12)' : 'rgba(30,41,59,0.5)',
                  border: isPicked ? '2px solid rgba(250,204,21,0.6)' : '1px solid #1e293b',
                  borderRadius: 8, cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onClick={() => onToggle(u.id)}
              >
                <UnitChip unit={u} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#e8ecf4' }}>{u.name}</span>
                    {u.tags?.map(t => (
                      <span key={t} style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
                        background: `${TAG_COL[t]}22`, color: TAG_COL[t],
                        border: `1px solid ${TAG_COL[t]}33`,
                      }}>{TAG_LABEL[t]}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    Lv{u.level} {u.cls}
                  </div>
                  <div style={{ fontSize: 10, color: '#8b93a8', marginTop: 2 }}>
                    HP{u.maxHp} STR{u.str} DEF{u.def} INT{u.int} MOV{u.mov}
                  </div>
                  {/* 技一覧 */}
                  <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                    {u.techs?.map((t, i) => (
                      <span key={i} style={{
                        fontSize: 9, padding: '1px 4px', borderRadius: 3,
                        background: 'rgba(59,130,246,0.1)', color: '#b0c4e8',
                      }}>{t.name}</span>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  {/* 選択状態 */}
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: isPicked ? '#facc15' : 'rgba(30,41,59,0.8)',
                    border: isPicked ? '2px solid #facc15' : '2px solid #334155',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 900, color: isPicked ? '#1a1f35' : '#334155',
                  }}>
                    {isPicked ? '✓' : ''}
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); onUnitClick?.(u); }}
                    style={{
                      fontSize: 9, color: '#64748b', background: 'none', border: 'none',
                      cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit',
                    }}
                  >
                    詳細
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── 確定ボタン ── */}
        <button
          onClick={canConfirm ? onConfirm : undefined}
          style={{
            width: '100%', padding: 10, fontSize: 15, fontWeight: 700,
            background: canConfirm ? 'linear-gradient(135deg,#facc15,#eab308)' : '#1e293b',
            color: canConfirm ? '#1a1f35' : '#334155',
            border: 'none', borderRadius: 6,
            cursor: canConfirm ? 'pointer' : 'default',
            letterSpacing: 3, fontFamily: 'inherit',
          }}
        >
          {canConfirm ? '決定 — 2人を仲間に加える' : `あと${2 - picked.length}人選択`}
        </button>
      </div>
      </ModalScale>
    </div>
  );
}
