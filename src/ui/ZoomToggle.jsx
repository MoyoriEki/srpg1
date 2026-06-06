import React from 'react';
import { scaledStyle } from './uiScale.jsx';

// ════════════════════════════════════════════
// ZoomToggle — マップ表示倍率の手動切替（右下にチョコンと表示）
//   A: 等倍（従来のPCと同じ） ⇄ B: 今回追加した倍率
//   UIなのでマップ拡大とは別に UI_SCALE が乗る。
// ════════════════════════════════════════════
export default function ZoomToggle({ zoom, onToggle }) {
  return (
    <button
      onClick={onToggle}
      onMouseDown={e => e.stopPropagation()}
      title="マップ表示倍率の切り替え"
      style={scaledStyle({
        position: 'absolute', bottom: 8, right: 8, zIndex: 90,
        height: 26, padding: '0 9px', borderRadius: 6,
        background: 'rgba(30,41,59,0.85)',
        border: '1px solid rgba(100,116,139,0.4)',
        color: '#cbd5e1', fontSize: 12, fontWeight: 700,
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
        fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      }, 'bottom right')}
    >
      🔍 {zoom === 1 ? '等倍' : `${zoom}x`}
    </button>
  );
}
