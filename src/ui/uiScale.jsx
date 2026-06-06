import React, { useState, useLayoutEffect, useRef } from 'react';
import { GW, GH, UI_SCALE } from '../engine/constants.js';

export { UI_SCALE };

// ════════════════════════════════════════════
// uiScale — UI/フォントの基本サイズを全デバイス共通で拡大する仕組み。
//   マップ(useMapZoom)とは独立。端末によるサイズ調整はしない。
//   transform:scale を使うのでレイアウト計算には影響しない。
// ════════════════════════════════════════════

// アンカー固定でUIを拡大する style を返す。
//   origin: スケールの基準（'top left' / 'top right' / 'bottom center' ...）
//   extraTransform: 既存の translate 等があれば前置きする
export function scaledStyle(base, origin = 'top left', extraTransform = '') {
  return {
    ...base,
    transform: `${extraTransform} scale(${UI_SCALE})`.trim(),
    transformOrigin: origin,
  };
}

// 中央モーダル用: 子の自然サイズを測り、画面(GW×GH)に収まる範囲で UI_SCALE まで拡大。
export function ModalScale({ children, max = UI_SCALE, pad = 16 }) {
  const ref = useRef(null);
  const [s, setS] = useState(max);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return;
      setS(Math.min(max, (GW - pad) / w, (GH - pad) / h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [max, pad]);
  return (
    <div ref={ref} style={{ transform: `scale(${s})`, transformOrigin: 'center center' }}>
      {children}
    </div>
  );
}
