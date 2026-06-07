import React, { useState, useEffect, useRef } from 'react';
import { GW, GH, DEBUG_TOP_SENTINEL } from '../engine/constants.js';

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

  // safe-area-inset の実測値（上端白ライン切り分け用）。
  // env() の値を hidden プローブの padding 経由で getComputedStyle で読む。
  const [safe, setSafe] = useState({ top: 0, bottom: 0, left: 0, right: 0 });
  const probeRef = useRef(null);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    const measure = () => {
      const el = probeRef.current;
      if (!el) return;
      const cs = getComputedStyle(el);
      setSafe({
        top: parseFloat(cs.paddingTop) || 0,
        bottom: parseFloat(cs.paddingBottom) || 0,
        left: parseFloat(cs.paddingLeft) || 0,
        right: parseFloat(cs.paddingRight) || 0,
      });
    };
    const onAny = () => { onResize(); measure(); };
    measure();
    window.addEventListener('resize', onAny);
    window.addEventListener('orientationchange', onAny);
    return () => {
      window.removeEventListener('resize', onAny);
      window.removeEventListener('orientationchange', onAny);
    };
  }, []);

  const scale = Math.min(vp.w / GW, vp.h / GH);
  const portrait = vp.h > vp.w;

  // 端数倍率＋端数 devicePixelRatio 対策のオーバースキャン。
  // コンテンツを OVER px 外側へ伸ばし、overflow:hidden の箱でクリップして端の境界を画面外へ追い出す。
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

      {/* safe-area 実測用の不可視プローブ（描画には影響しない） */}
      <div ref={probeRef} style={{
        position: 'fixed', top: 0, left: 0, width: 0, height: 0,
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        visibility: 'hidden', pointerEvents: 'none',
      }} />

      {/* ───── 診断オーバーレイ（上端白ライン切り分け用 / 通常は無効） ─────
          ・シアン帯 = env(safe-area-inset-top) の領域。これが見えれば「Webの上にバー域がある」＝
            白線はシステム/Chrome側の確定。高さ0で見えなければ inset 無し＝コンポジタ最上端の継ぎ目。
          ・マゼンタ1px = Webコンテンツの y=0 マーカー。白線がこの上か中か下かで層を特定。
          ・数値: vp/dpr/scale/top/dispH に加え、safe-area-inset 実測(T/B/L/R)を表示。 */}
      {DEBUG_TOP_SENTINEL && (
        <>
          {/* env(safe-area-inset-top) をそのまま高さにしたシアン帯。0なら不可視 */}
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0,
            height: 'env(safe-area-inset-top)',
            background: 'rgba(0,255,255,0.6)', zIndex: 99998, pointerEvents: 'none',
          }} />
          {/* Webコンテンツ y=0 のマーカー（1px マゼンタ） */}
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, height: 1,
            background: '#ff00ff', zIndex: 99999, pointerEvents: 'none',
          }} />
          <div style={{
            position: 'fixed', left: 4, bottom: 4,
            background: 'rgba(0,0,0,0.7)', color: '#0f0',
            font: '10px/1.4 monospace', padding: '2px 5px', borderRadius: 3,
            zIndex: 99999, pointerEvents: 'none', whiteSpace: 'pre',
          }}>
            {`vp ${vp.w}x${vp.h}  dpr ${typeof window !== 'undefined' ? window.devicePixelRatio : '?'}\n`}
            {`scale ${scale.toFixed(4)}  top ${top}  dispH ${dispH}\n`}
            {`safe T${safe.top} B${safe.bottom} L${safe.left} R${safe.right}`}
          </div>
        </>
      )}

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
