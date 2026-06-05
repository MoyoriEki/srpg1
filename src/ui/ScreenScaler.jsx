import React, { useState, useEffect } from 'react';
import { GW, GH } from '../engine/constants.js';

// ════════════════════════════════════════════
// ScreenScaler
//   固定1280×720の画面を端末サイズに合わせて等比スケールする。
//   transform:scale を使うため、各クリック座標計算側で
//   rect.width / offsetWidth によるスケール補正が必要（MapView/App側で対応済み）。
//   縦持ち時は横向きを促すヒントを出す（横長レイアウトのため）。
// ════════════════════════════════════════════
export default function ScreenScaler({ children }) {
  const [vp, setVp] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : GW,
    h: typeof window !== 'undefined' ? window.innerHeight : GH,
  }));

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  const scale = Math.min(vp.w / GW, vp.h / GH);
  const portrait = vp.h > vp.w;

  return (
    <div style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      background: '#0a0e1e',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* スケール後のサイズ分の場所を確保して中央寄せ */}
      <div style={{ width: GW * scale, height: GH * scale, position: 'relative' }}>
        <div style={{
          width: GW, height: GH,
          position: 'absolute', left: 0, top: 0,
          transform: `scale(${scale})`, transformOrigin: 'top left',
        }}>
          {children}
        </div>
      </div>

      {/* 縦持ちヒント（非ブロッキング） */}
      {portrait && (
        <div style={{
          position: 'fixed', top: 'env(safe-area-inset-top, 8px)', left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(8,12,26,0.92)', color: '#e2e8f0',
          padding: '8px 18px', borderRadius: 20, fontSize: 13, fontWeight: 700,
          border: '1px solid rgba(96,165,250,0.5)',
          zIndex: 9999, pointerEvents: 'none', whiteSpace: 'nowrap',
          fontFamily: "'Noto Sans JP','Hiragino Sans',sans-serif",
        }}>
          📱↻ 横向きにするとプレイしやすいよ
        </div>
      )}
    </div>
  );
}
