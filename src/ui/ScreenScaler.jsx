import React, { useState, useEffect } from 'react';
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

      {/* ───── 上端の白ライン（AA明線）対策 ─────
          原因: 固定1280×720を transform:scale で全画面拡大しており、端末の dpr×scale が
          半端値（実測 2.8125×0.5333＝1.5px/px）になると、変形レイヤー最上端の1物理pxが
          コンテンツとコンポジタ既定色（白）をサブピクセル合成し、白い継ぎ目になる。
          起動ごとにvpの端数が変わるため間欠的に出る。
          対策: 「変形サブツリーの外側」に不透明ダークの薄いカバーを最上端へ重ね、
          物理y=0付近の白継ぎ目を塗り潰す（診断ビルドでマゼンタ線が白を覆えたのと同じ原理）。
          クリップ箱の内側に置いた旧対策(#10/#11)は変形レイヤー境界の外の継ぎ目に届かず無効だった。 */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 3,
        background: '#0a0e1e', zIndex: 100000, pointerEvents: 'none',
      }} />

      {/* ───── 診断オーバーレイ（上端白ライン切り分け用 / 通常は無効） ─────
          ・最上端(y=0)に2pxのマゼンタ線を引く。物理的に画面の一番上。
            次のスクショで白線がこのマゼンタより「上」なら → うちのDOM外（fullscreen/viewport-fitが犯人）。
            マゼンタが白線を覆う/白が消えるなら → うちのcontent継ぎ目（transform scaleのAA明線が犯人）。
          ・実数値も出す（innerW×H / DPR / scale / top / dispH）。端数が継ぎ目を生むので確認用。 */}
      {DEBUG_TOP_SENTINEL && (
        <>
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, height: 2,
            background: '#ff00ff', zIndex: 99999, pointerEvents: 'none',
          }} />
          <div style={{
            position: 'fixed', left: 4, bottom: 4,
            background: 'rgba(0,0,0,0.7)', color: '#0f0',
            font: '10px/1.4 monospace', padding: '2px 5px', borderRadius: 3,
            zIndex: 99999, pointerEvents: 'none', whiteSpace: 'pre',
          }}>
            {`vp ${vp.w}x${vp.h}  dpr ${typeof window !== 'undefined' ? window.devicePixelRatio : '?'}\n`}
            {`scale ${scale.toFixed(4)}  top ${top}  dispH ${dispH}`}
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
