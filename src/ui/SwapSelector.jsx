import React from 'react';
import techs from '../data/techs.json';

const TAG_LABEL = { fire: '炎', water: '水', wind: '風', light: '光', dark: '闇', none: '無' };
const TAG_BG    = { fire: 'rgba(239,68,68,0.15)', water: 'rgba(59,130,246,0.15)', wind: 'rgba(34,197,94,0.15)', light: 'rgba(250,204,21,0.15)', dark: 'rgba(167,139,250,0.15)', none: 'rgba(148,163,184,0.15)' };
const TAG_COL   = { fire: '#ef4444', water: '#3b82f6', wind: '#22c55e', light: '#fbbf24', dark: '#a78bfa', none: '#94a3b8' };
const TYPE_COL  = { tech: '#60a5fa', skill: '#a78bfa' };

/**
 * SwapSelector — パーツ入れ替え対象選択（共通コンポーネント）
 *
 * props:
 *   newPart     — 取得しようとしているパーツ（parts.jsonの1エントリ）
 *   removables  — 入れ替え候補の配列（getRemovableParts結果）
 *   onSelect(removeName) — 取り外すパーツを選択
 *   onCancel()  — キャンセル
 */
export default function SwapSelector({ newPart, removables, onSelect, onCancel, onSkip }) {
  const typeLabel = newPart.type === 'tech' ? '技' : 'スキル';
  const techDef = newPart.type === 'tech' ? techs[newPart.techRef || newPart.name] : null;
  const newDesc = newPart.desc || (techDef ? techDef.desc : '');

  return (
    <div>
      {/* 取得パーツ表示 */}
      <div style={{
        fontSize: 13, fontWeight: 700, color: '#facc15',
        textAlign: 'center', marginBottom: 6,
      }}>
        {typeLabel}枠が満杯 — 入れ替え対象を選択
      </div>

      <div style={{
        padding: '8px 12px', marginBottom: 12, borderRadius: 6,
        background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {newPart.tag && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
              background: TAG_BG[newPart.tag], color: TAG_COL[newPart.tag],
              border: `1px solid ${(TAG_COL[newPart.tag] || '#64748b')}33`,
            }}>{TAG_LABEL[newPart.tag] || newPart.tag}</span>
          )}
          <span style={{
            fontSize: 14, fontWeight: 700,
            color: TYPE_COL[newPart.type] || '#a78bfa',
          }}>
            【{typeLabel}】{newPart.name}
          </span>
        </div>
        {newDesc && (
          <div style={{ fontSize: 11, color: '#8b93a8', marginTop: 3 }}>{newDesc}</div>
        )}
      </div>

      {/* 入れ替え候補 */}
      <div style={{ fontSize: 11, color: '#8b93a8', marginBottom: 6 }}>
        外す{typeLabel}を選んでください
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {removables.map((r, i) => {
          const rTechDef = r.rangeMin != null ? r : (techs[r.name] || null);
          const rDesc = r.desc || (rTechDef?.desc) || '';
          return (
            <button key={i} onClick={() => onSelect(r.name)} style={{
              background: 'rgba(239,68,68,0.06)',
              border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6,
              padding: '8px 12px', cursor: 'pointer', color: '#e2e8f0',
              textAlign: 'left', fontFamily: 'inherit',
              transition: 'border-color 0.15s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {r._tag && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                    background: TAG_BG[r._tag], color: TAG_COL[r._tag],
                    border: `1px solid ${(TAG_COL[r._tag] || '#64748b')}33`,
                  }}>{TAG_LABEL[r._tag] || r._tag}</span>
                )}
                <span style={{ fontSize: 13, fontWeight: 700, color: '#f87171' }}>
                  {r.name}
                </span>
              </div>
              {rDesc && (
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{rDesc}</div>
              )}
            </button>
          );
        })}
      </div>

      {/* キャンセル・獲得しない */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={onCancel} style={{
          flex: 1, padding: '8px 0',
          background: 'rgba(100,116,139,0.1)', border: '1px solid #334155',
          borderRadius: 6, cursor: 'pointer', color: '#8b93a8',
          fontFamily: 'inherit', fontSize: 12,
        }}>
          選び直す
        </button>
        <button onClick={onSkip} style={{
          flex: 1, padding: '8px 0',
          background: 'rgba(100,116,139,0.1)', border: '1px solid #334155',
          borderRadius: 6, cursor: 'pointer', color: '#8b93a8',
          fontFamily: 'inherit', fontSize: 12,
        }}>
          獲得しない
        </button>
      </div>
    </div>
  );
}
