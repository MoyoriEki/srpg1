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

  // 端数倍率＋端数 devicePixelRatio 対策のオーバースキャン。
  // コンテンツを OVER px 外側へ伸ばし、overflow:hidden の箱でクリップして端の境界を画面外へ追い出す。
  // （上端の白ライン本体は html 背景の白透けが原因。index.html で html に背景色を敷いて対処済み）
  const dispW = Math.ceil(GW * scale);
  const dispH = Math.ceil(GH * scale);
  const left = Math.round((vp.w - dispW) / 2);
  const top = Math.round((vp.h - dispH) / 2);
  const OVER = 1; // オーバースキャン量（CSS px）

  return (
    <div style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      background: '#0a0e1e',
    }}>
      {/* 整数サイズ・整数座標の箱。中身を少し大きく充填し、端をクリップしてAA明線を防ぐ */}
      <div style={{
        position: 'absolute', left, top, width: dispW, height: dispH,
        overflow: 'hidden', background: '#0a0e1e',
      }}>
        <div style={{
          width: GW, height: GH,
          position: 'absolute', left: -OVER, top: -OVER,
          transform: `scale(${(dispW + 2 * OVER) / GW}, ${(dispH + 2 * OVER) / GH})`,
          transformOrigin: 'top left',
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
