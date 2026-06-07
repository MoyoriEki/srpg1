import React, { useState } from 'react';
import { getBGMVolume, setBGMVolume } from '../engine/audio.js';
import { APP_VERSION } from '../engine/constants.js';
import { scaledStyle } from './uiScale.jsx';

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [vol, setVol] = useState(getBGMVolume());

  const handleVol = (e) => {
    const v = parseFloat(e.target.value);
    setVol(v);
    setBGMVolume(v);
  };

  return (
    <>
      {/* 歯車ボタン */}
      <button
        onClick={() => setOpen(p => !p)}
        style={scaledStyle({
          position: 'absolute', top: 8, right: 8, zIndex: 100,
          width: 32, height: 32, borderRadius: 6,
          background: 'rgba(30,41,59,0.8)',
          border: '1px solid rgba(100,116,139,0.4)',
          color: '#94a3b8', fontSize: 16,
          cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }, 'top right')}
        title="設定"
      >⚙</button>

      {/* パネル */}
      {open && (
        <div style={scaledStyle({
          position: 'absolute', top: 64, right: 8, zIndex: 100,
          background: 'rgba(15,23,42,0.95)',
          border: '1px solid #334155', borderRadius: 8,
          padding: '12px 16px', minWidth: 180,
          boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        }, 'top right')}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8, fontWeight: 700 }}>設定</div>

          {/* BGM音量 */}
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
            BGM音量: {Math.round(vol * 100)}%
          </div>
          <input
            type="range" min="0" max="1" step="0.05"
            value={vol} onChange={handleVol}
            style={{ width: '100%', accentColor: '#3b82f6' }}
          />

          {/* バージョン表示 */}
          <div style={{
            marginTop: 12, paddingTop: 8, borderTop: '1px solid #334155',
            fontSize: 10, color: '#475569', textAlign: 'right', letterSpacing: 0.5,
          }}>
            {APP_VERSION}
          </div>
        </div>
      )}
    </>
  );
}
