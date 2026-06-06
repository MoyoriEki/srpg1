import React, { useRef, useEffect, useState } from 'react';
import { scaledStyle } from './uiScale.jsx';

const TYPE_COLOR = {
  phase:    '#facc15',
  atk:      '#e2e8f0',
  counter:  '#fca5a5',
  followup: '#c4b5fd',
  exp:      '#4ade80',
  heal:     '#6ee7a0',
  debuff:   '#fbbf24',
  info:     '#475569',
};

export default function LogPanel({ log, phase, stage, turn }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (ref.current && open) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log, open]);

  const phaseLabel =
    phase === 'deploy' ? '配置' :
    phase === 'player' ? '自ターン' :
    phase === 'enemy'  ? '敵ターン' : phase;

  const phaseColor = phase === 'deploy' ? '#facc15' : phase === 'player' ? '#60a5fa' : '#f87171';

  return (
    <div style={scaledStyle({ position: 'absolute', top: 8, right: 10, width: 240, zIndex: 40 }, 'top right')}>
      <div
        onClick={() => setOpen(p => !p)}
        style={{
          fontSize: 13, fontWeight: 700,
          color: phaseColor,
          background: 'rgba(12,15,26,0.85)', padding: '5px 10px',
          borderRadius: open ? '4px 4px 0 0' : 4,
          border: '1px solid #1e293b',
          borderBottom: open ? 'none' : '1px solid #1e293b',
          cursor: 'pointer', userSelect: 'none',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span>S{stage + 1} T{turn} — {phaseLabel}</span>
        <span style={{ fontSize: 10, color: '#475569' }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div ref={ref} style={{
          maxHeight: 200, overflowY: 'auto',
          background: 'rgba(12,15,26,0.8)', borderRadius: '0 0 6px 6px',
          padding: 6, border: '1px solid #1e293b', borderTop: 'none',
          fontSize: 11, lineHeight: 1.6,
        }}>
          {log.slice(-40).map((e, i) => (
            <div key={i} style={{
              color: TYPE_COLOR[e.type] || '#e2e8f0',
              fontWeight: e.type === 'phase' ? 700 : 400,
              borderLeft: e.type === 'phase' ? '2px solid #facc15' : '2px solid transparent',
              paddingLeft: 4,
            }}>
              {e.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
