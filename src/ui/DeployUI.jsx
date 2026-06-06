import React from 'react';
import { INITIAL_SORTIE, PARTY_MAX } from '../engine/constants.js';
import UnitChip from './UnitChip.jsx';
import { scaledStyle } from './uiScale.jsx';

/**
 * DeployUI — 配置フェーズUI
 *
 * props:
 *   roster       — Unit[] ロスター全員
 *   deployCount  — 現在配置済み数
 *   sortieLimit  — 出撃上限
 *   deploySelId  — 選択中のユニットID
 *   onSelect(uid) — ロスターからユニット選択
 *   onStart      — 出撃ボタン
 */
export default function DeployUI({ roster, deployCount, sortieLimit, deploySelId, onSelect, onStart }) {
  const canStart = deployCount >= sortieLimit;

  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      style={scaledStyle({
        position: 'absolute', top: 8, left: 10, width: 250, zIndex: 60,
        background: 'rgba(18,22,40,0.95)',
        border: '1px solid rgba(59,130,246,0.3)', borderRadius: 8,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)', overflow: 'hidden',
      }, 'top left')}
    >
      {/* ── ヘッダ ── */}
      <div style={{
        background: 'linear-gradient(90deg,rgba(37,99,235,0.3),rgba(37,99,235,0.1))',
        padding: '8px 12px', borderBottom: '1px solid rgba(59,130,246,0.2)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#60a5fa', letterSpacing: 2 }}>
          配置フェーズ
        </div>
        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
          出撃 {deployCount}/{sortieLimit} 青枠に配置
        </div>
      </div>

      {/* ── ロスター一覧 ── */}
      <div style={{ padding: '6px 8px', maxHeight: 280, overflowY: 'auto' }}>
        {roster.map(u => {
          const isSel = deploySelId === u.id;
          const isDeployed = u.deployed;
          return (
            <button
              key={u.id}
              onClick={() => onSelect(u.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '6px 8px', marginBottom: 3,
                background: isSel ? 'rgba(59,130,246,0.2)'
                  : isDeployed ? 'rgba(74,222,128,0.1)' : 'rgba(30,41,59,0.4)',
                border: isSel ? '1px solid #3b82f6'
                  : isDeployed ? '1px solid rgba(74,222,128,0.3)' : '1px solid #1e293b',
                borderRadius: 5, cursor: 'pointer', color: '#e2e8f0',
                textAlign: 'left', fontFamily: 'inherit',
                transition: 'border-color 0.1s',
                opacity: isDeployed && !isSel ? 0.6 : 1,
              }}
            >
              <UnitChip unit={u} size={28} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {u.name}
                  {isDeployed && <span style={{ fontSize: 10, color: '#4ade80', marginLeft: 4 }}>配置済</span>}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {u.cls} HP{u.maxHp} ATK{u.str + u.pp} DEF{u.def}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── 出撃ボタン ── */}
      <div style={{ padding: '6px 8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={canStart ? onStart : undefined}
          style={{
            width: '100%', padding: 8, fontSize: 13, fontWeight: 700,
            background: canStart ? 'linear-gradient(135deg,#3b82f6,#2563eb)' : '#1e293b',
            color: canStart ? '#fff' : '#334155',
            border: 'none', borderRadius: 5,
            cursor: canStart ? 'pointer' : 'default',
            letterSpacing: 3, fontFamily: 'inherit',
          }}
        >
          出撃
        </button>
      </div>
    </div>
  );
}
