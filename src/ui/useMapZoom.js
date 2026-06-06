import { useState, useEffect } from 'react';
import { GW, GH, MAP_ZOOM_MOBILE, MAP_ZOOM_THRESHOLD } from '../engine/constants.js';

// ════════════════════════════════════════════
// useMapZoom
//   画面が小さい（=フィット後scaleが閾値未満）端末ではマップを拡大する。
//   マップ&ユニットのみに適用する倍率を返す（UIには使わない）。
// ════════════════════════════════════════════
function calcZoom() {
  if (typeof window === 'undefined') return 1;
  const scale = Math.min(window.innerWidth / GW, window.innerHeight / GH);
  return scale < MAP_ZOOM_THRESHOLD ? MAP_ZOOM_MOBILE : 1;
}

export default function useMapZoom() {
  const [zoom, setZoom] = useState(calcZoom);
  useEffect(() => {
    const onResize = () => setZoom(calcZoom());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return zoom;
}
