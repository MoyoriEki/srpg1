import React, { useState, useRef, useCallback, useEffect } from 'react';
import { TILE, GW, GH, STEP_MS, COUNTER_DEFS } from '../engine/constants.js';

// バフ/デバフ系カウンター名セット（マーカー・ツールチップ表示用）
const BUFF_COUNTERS = new Set(
  Object.entries(COUNTER_DEFS).filter(([, v]) => v.buff).map(([k]) => k)
);
const DEBUFF_COUNTERS = new Set(
  Object.entries(COUNTER_DEFS).filter(([, v]) => v.debuff).map(([k]) => k)
);

// カウンター表示フォーマット（display: full→名前(数), nameOnly→名前, hidden→非表示）
function fmtCounter(name, val) {
  const d = COUNTER_DEFS[name]?.display || 'full';
  if (d === 'hidden') return null;
  if (d === 'nameOnly') return name;
  return `${name}(${val})`;
}

function getActiveCounters(unit, filterSet) {
  if (!unit._counters) return [];
  return Object.entries(unit._counters)
    .filter(([k, v]) => filterSet.has(k) && v > 0)
    .map(([k, v]) => fmtCounter(k, v))
    .filter(Boolean);
}
import { getTerrainColor, getTerrainName, getTerrainDef, getCols, getRows, getItemBoxes, getTilesets, getTileOverlay } from '../engine/map.js';
import UnitChip from './UnitChip.jsx';

// ─── CSS keyframes (styleタグで1回だけ注入) ───
const STYLE_ID = 'srpg-keyframes';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes s-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-2px)}80%{transform:translateX(2px)}}
    @keyframes s-flash{0%{opacity:0.8}100%{opacity:0}}
    @keyframes s-dmg{0%{opacity:1;transform:translate(-50%,-0px) scale(1)}100%{opacity:0;transform:translate(-50%,-28px) scale(0.8)}}
    @keyframes s-heal{0%{opacity:1;transform:translate(-50%,0) scale(1)}100%{opacity:0;transform:translate(-50%,-22px) scale(0.9)}}
    @keyframes s-fin{0%{opacity:0;transform:scale(0.95)}100%{opacity:1;transform:scale(1)}}
    @keyframes s-charge{0%,100%{box-shadow:0 0 4px rgba(249,115,22,0.3)}50%{box-shadow:0 0 12px rgba(249,115,22,0.7)}}
    @keyframes s-buff{0%{opacity:1;transform:translate(-50%,0) scale(1)}40%{transform:translate(-50%,-8px) scale(1.1)}100%{opacity:0;transform:translate(-50%,-24px) scale(0.9)}}
    @keyframes s-debuff{0%{opacity:1;transform:translate(-50%,0) scale(1.2)}30%{transform:translate(-50%,-6px) scale(1)}100%{opacity:0;transform:translate(-50%,-22px) scale(0.8)}}
    @keyframes s-ban{0%{transform:scaleX(0);opacity:0}15%{transform:scaleX(1);opacity:1}85%{transform:scaleX(1);opacity:1}100%{transform:scaleX(0);opacity:0}}
    @keyframes s-slin{0%{opacity:0;transform:translateY(6px)}100%{opacity:1;transform:translateY(0)}}
  `;
  document.head.appendChild(s);
}

const COLS = () => getCols();
const ROWS = () => getRows();
const MAP_W = () => COLS() * TILE;
const MAP_H = () => ROWS() * TILE;

// ─── ダメージポップ色 ───
function popColor(type) {
  if (type === 'heal')    return '#4ade80';
  if (type === 'counter') return '#fca5a5';
  if (type === 'followup') return '#c4b5fd';
  if (type === 'buff')    return '#60a5fa';
  if (type === 'debuff')  return '#fbbf24';
  if (type === 'exp')     return '#4ade80';
  return '#fbbf24'; // dmg
}
function popAnim(type) {
  if (type === 'heal')   return 's-heal 0.9s ease-out forwards';
  if (type === 'buff')   return 's-buff 0.9s ease-out forwards';
  if (type === 'debuff') return 's-debuff 0.9s ease-out forwards';
  if (type === 'exp')    return 's-buff 1.2s ease-out forwards';
  return 's-dmg 0.9s ease-out forwards';
}

export default function MapView({
  units, phase, terrain,
  moveCells, atkCells, healCells, pathCells,
  deployZone, enemyRanges, rangeEnemyIds,
  selId, hoverCell,
  dmgPops, shaking,
  onCellClick, onCellRightClick, onUnitClick, onUnitRightClick,
  onHover, onStatScreen,
  banner, menuOpen,
}) {
  // ─── カメラドラッグ ───
  const [cam, setCam] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

  // ─── タイルオーバーレイ (Canvas) ───
  const overlayCanvasRef = useRef(null);
  const tilesetImgsRef = useRef({}); // { src: HTMLImageElement }
  const [imgsReady, setImgsReady] = useState(0); // trigger re-render on load

  const tilesets = getTilesets();
  const tileOverlay = getTileOverlay();

  // Load tileset images
  useEffect(() => {
    if (!tilesets || tilesets.length === 0) return;
    let loadCount = 0;
    tilesets.forEach(cs => {
      const src = cs.src;
      if (tilesetImgsRef.current[src]) { loadCount++; return; }
      const img = new Image();
      img.onload = () => {
        tilesetImgsRef.current[src] = img;
        loadCount++;
        if (loadCount === tilesets.length) setImgsReady(n => n + 1);
      };
      img.onerror = () => {
        console.warn(`Tileset not found: ${import.meta.env.BASE_URL}tilesets/${src}`);
        loadCount++;
        if (loadCount === tilesets.length) setImgsReady(n => n + 1);
      };
      img.src = `${import.meta.env.BASE_URL}tilesets/${src}`;
    });
  }, [tilesets.map(t => t.src).join(',')]);

  // Draw overlay canvas
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !tileOverlay || tilesets.length === 0) return;
    const cols = COLS(), rows = ROWS();
    const w = cols * TILE, h = rows * TILE;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;

    for (let li = 0; li < 4; li++) {
      const layer = tileOverlay[li];
      if (!layer) continue;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const val = layer[y]?.[x] || 0;
          if (val === 0) continue;
          const chipIdx = Math.floor(val / 10000);
          const tileIdx = val % 10000;
          const cs = tilesets[chipIdx];
          if (!cs) continue;
          const img = tilesetImgsRef.current[cs.src];
          if (!img) continue;
          const sx = ((tileIdx - 1) % cs.cols) * cs.tileW;
          const sy = Math.floor((tileIdx - 1) / cs.cols) * cs.tileH;
          ctx.drawImage(img, sx, sy, cs.tileW, cs.tileH, x * TILE, y * TILE, TILE, TILE);
        }
      }
    }
  }, [tileOverlay, imgsReady]);

  const mapOX = (GW - MAP_W()) / 2;
  const mapOY = (GH - MAP_H()) / 2;

  const handleMouseDown = useCallback((e) => {
    if (e.button === 2) return; // 右クリックはスルー
    dragRef.current = { sx: e.clientX - cam.x, sy: e.clientY - cam.y, moved: false };
  }, [cam]);

  const handleMouseMove = useCallback((e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    if (Math.abs(dx - cam.x) > 3 || Math.abs(dy - cam.y) > 3) dragRef.current.moved = true;
    const mw = MAP_W(), mh = MAP_H();
    setCam({
      x: mw <= GW ? 0 : Math.max(GW - mw, Math.min(0, dx)),
      y: mh <= GH ? 0 : Math.max(GH - mh, Math.min(0, dy)),
    });
  }, [cam]);

  const handleMouseUp = useCallback((e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && d.moved) return; // ドラッグだったらクリック無視
    // マップクリック座標→セル変換
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = Math.floor((e.clientX - rect.left - mapOX - cam.x) / TILE);
    const cy = Math.floor((e.clientY - rect.top - mapOY - cam.y) / TILE);
    if (cx < 0 || cy < 0 || cx >= COLS() || cy >= ROWS()) return;
    if (e.button === 2) return; // 右クリックはhandleContextMenuで処理
    // ユニットがいればユニットクリック、なければセルクリック
    const u = units.find(u => u.hp > 0 && u.x === cx && u.y === cy);
    if (u) onUnitClick?.(u);
    else   onCellClick?.(cx, cy);
  }, [cam, mapOX, mapOY, units, onCellClick, onCellRightClick, onUnitClick]);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = Math.floor((e.clientX - rect.left - mapOX - cam.x) / TILE);
    const cy = Math.floor((e.clientY - rect.top - mapOY - cam.y) / TILE);
    if (cx < 0 || cy < 0 || cx >= COLS() || cy >= ROWS()) return;
    const u = units.find(u => u.hp > 0 && u.x === cx && u.y === cy);
    if (u) onUnitRightClick?.(u, e);
    else   onCellRightClick?.(cx, cy, e);
  }, [cam, mapOX, mapOY, units, onCellRightClick, onUnitRightClick]);

  const handleMapHover = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = Math.floor((e.clientX - rect.left - mapOX - cam.x) / TILE);
    const cy = Math.floor((e.clientY - rect.top - mapOY - cam.y) / TILE);
    if (cx >= 0 && cy >= 0 && cx < COLS() && cy < ROWS()) onHover?.(cx, cy);
  }, [cam, mapOX, mapOY, onHover]);

  // ─── cellハイライトセット ───
  const moveSet  = new Set((moveCells  || []).map(c => `${c.x},${c.y}`));
  const atkSet   = new Set((atkCells   || []).map(c => `${c.x},${c.y}`));
  const healSet  = new Set((healCells  || []).map(c => `${c.x},${c.y}`));
  const pathSet  = new Set((pathCells  || []).map(c => `${c.x},${c.y}`));
  const deplSet  = new Set((deployZone || []).map(c => `${c.x},${c.y}`));
  const eRngSet  = new Set((enemyRanges || []).map(c => `${c.x},${c.y}`));

  const itemBoxes = getItemBoxes() || [];
  const cols = COLS(), rows = ROWS();

  return (
    <div
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        fontFamily: "'Noto Sans JP','Hiragino Sans',sans-serif",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={(e) => { handleMouseMove(e); handleMapHover(e); }}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
    >
      {/* === マップ本体 === */}
      <div style={{
        position: 'absolute',
        left: mapOX + cam.x, top: mapOY + cam.y,
        width: MAP_W(), height: MAP_H(),
      }}>
        {/* 地形タイル（基盤色のみ） */}
        {terrain.map((row, ry) => row.map((tid, cx) => (
          <div key={`t${cx}-${ry}`} style={{
            position: 'absolute', left: cx * TILE, top: ry * TILE,
            width: TILE, height: TILE,
            background: getTerrainColor(tid),
            borderRight: '1px solid rgba(0,0,0,0.2)',
            borderBottom: '1px solid rgba(0,0,0,0.2)',
          }} />
        )))}

        {/* タイルオーバーレイ (Canvas) */}
        <canvas
          ref={overlayCanvasRef}
          width={MAP_W()} height={MAP_H()}
          style={{
            position: 'absolute', left: 0, top: 0,
            width: MAP_W(), height: MAP_H(),
            pointerEvents: 'none', zIndex: 1,
            imageRendering: 'pixelated',
          }}
        />

        {/* ハイライトレイヤー（移動/攻撃/回復範囲） */}
        {terrain.map((row, ry) => row.map((tid, cx) => {
          const key = `${cx},${ry}`;
          let overlay = null;
          if (deplSet.has(key))     overlay = 'rgba(59,130,246,0.12)';
          if (eRngSet.has(key))     overlay = 'rgba(239,68,68,0.15)';
          if (moveSet.has(key))     overlay = 'rgba(59,130,246,0.25)';
          if (pathSet.has(key))     overlay = 'rgba(59,130,246,0.45)';
          if (atkSet.has(key))      overlay = 'rgba(239,68,68,0.25)';
          if (healSet.has(key))     overlay = 'rgba(74,222,128,0.25)';
          if (!overlay) return null;
          return (
            <div key={`h${cx}-${ry}`} style={{
              position: 'absolute', left: cx * TILE, top: ry * TILE,
              width: TILE, height: TILE,
              background: overlay,
              pointerEvents: 'none', zIndex: 2,
            }} />
          );
        }))}

        {/* アイテムボックス表示 */}
        {itemBoxes.map((ib, i) => (
          <div key={`ib${i}`} style={{
            position: 'absolute', left: ib.x * TILE + 8, top: ib.y * TILE + 8,
            width: TILE - 16, height: TILE - 16, borderRadius: 4,
            background: 'rgba(212,160,23,0.4)',
            border: '2px solid rgba(212,160,23,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, pointerEvents: 'none', zIndex: 3,
          }}>
            ◈
          </div>
        ))}

        {/* ユニット描画 */}
        {units.filter(u => u.hp > 0).map(u => {
          const isSel = selId === u.id;
          const pops = (dmgPops || []).filter(p => p.uid === u.id);
          const isShaking = shaking?.[u.id];
          return (
            <div key={u.id} style={{
              position: 'absolute',
              left: u.x * TILE, top: u.y * TILE,
              width: TILE, height: TILE,
              transition: phase === 'deploy' ? 'none' : `left ${STEP_MS}ms linear, top ${STEP_MS}ms linear`,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 1,
              opacity: u.acted ? 0.4 : 1,
              zIndex: 10,
              cursor: 'pointer',
              filter: isSel ? 'brightness(1.3)' : 'none',
            }}>
              {/* チップ + シェイク + チャージ光 */}
              <div style={{ animation: isShaking ? 's-shake 0.4s ease-in-out' : 'none' }}>
                <div style={{
                  animation: u.chargeCounter > 0 ? 's-charge 1s ease-in-out infinite' : 'none',
                  borderRadius: 5,
                }}>
                  <UnitChip unit={u} size={34} />
                </div>
                {/* フラッシュ */}
                {isShaking && (
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: 5,
                    background: 'radial-gradient(circle,rgba(255,255,255,0.5),transparent)',
                    animation: 's-flash 0.4s ease-out forwards',
                    pointerEvents: 'none',
                  }} />
                )}
              </div>

              {/* HPバー */}
              <div style={{
                width: 32, height: 4,
                background: 'rgba(0,0,0,0.5)', borderRadius: 2, overflow: 'hidden',
              }}>
                <div style={{
                  width: `${(u.hp / u.maxHp) * 100}%`, height: '100%',
                  background: u.hp / u.maxHp > 0.5 ? '#4ade80'
                    : u.hp / u.maxHp > 0.25 ? '#facc15' : '#ef4444',
                  transition: 'width 0.3s',
                }} />
              </div>

              {/* チャージカウンタ */}
              {u.chargeCounter > 0 && (
                <div style={{
                  position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)',
                  fontSize: 8, fontWeight: 700, color: '#f97316',
                  textShadow: '0 0 4px rgba(0,0,0,0.8)',
                  pointerEvents: 'none',
                }}>
                  残{u.chargeCounter}
                </div>
              )}

              {/* バフマーカー（左上） */}
              {getActiveCounters(u, BUFF_COUNTERS).length > 0 && (
                <div style={{
                  position: 'absolute', top: 0, left: 2,
                  fontSize: 10, fontWeight: 900, color: '#34d399',
                  textShadow: '0 0 4px rgba(0,0,0,0.8)',
                  pointerEvents: 'none',
                }}>!</div>
              )}
              {/* デバフマーカー（右上） */}
              {getActiveCounters(u, DEBUFF_COUNTERS).length > 0 && (
                <div style={{
                  position: 'absolute', top: 0, right: 2,
                  fontSize: 10, fontWeight: 900, color: '#fbbf24',
                  textShadow: '0 0 4px rgba(0,0,0,0.8)',
                  pointerEvents: 'none',
                }}>!</div>
              )}

              {/* マーキング◎ */}
              {(rangeEnemyIds || []).includes(u.id) && (
                <div style={{
                  position: 'absolute', top: -2, left: 1,
                  fontSize: 8, fontWeight: 700, color: '#ef4444',
                  textShadow: '0 0 3px rgba(0,0,0,0.8)',
                  pointerEvents: 'none',
                }}>◎</div>
              )}

              {/* ダメージポップ */}
              {pops.map(p => (
                <div key={p.key} style={{
                  position: 'absolute', top: -4, left: '50%',
                  transform: 'translateX(-50%)',
                  fontSize: (p.type === 'buff' || p.type === 'debuff') ? 13 : 18,
                  fontWeight: 900, color: popColor(p.type),
                  textShadow: '0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.5)',
                  animation: popAnim(p.type),
                  pointerEvents: 'none', zIndex: 20,
                  whiteSpace: 'nowrap', letterSpacing: 1,
                }}>
                  {p.type === 'heal' ? `+${p.val}` : p.val}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* === ユニットホバーツールチップ === */}
      {(() => {
        if (!hoverCell || menuOpen) return null;
        const hu = units.find(u => u.hp > 0 && u.x === hoverCell.x && u.y === hoverCell.y);
        if (!hu) return null;
        const hpPct = hu.hp / hu.maxHp;
        const hpCol = hpPct > 0.5 ? '#4ade80' : hpPct > 0.25 ? '#facc15' : '#ef4444';
        const ux = mapOX + cam.x + hu.x * TILE;
        const uy = mapOY + cam.y + hu.y * TILE;
        const tooltipW = 180;
        const tooltipH = 80;
        // ユニットの上に表示。画面上端に近ければ下に
        const px = Math.max(4, Math.min(ux + (TILE - tooltipW) / 2, GW - tooltipW - 4));
        const aboveY = uy - tooltipH - 8;
        const belowY = uy + TILE + 8;
        const py = aboveY >= 4 ? aboveY : belowY;
        return (
          <div style={{
            position: 'absolute',
            left: px, top: Math.max(py, 4),
            background: 'rgba(16,20,36,0.95)', padding: '6px 10px',
            borderRadius: 6, border: `1px solid ${hu.team === 'player' ? 'rgba(59,130,246,0.4)' : 'rgba(239,68,68,0.4)'}`,
            boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
            zIndex: 50, pointerEvents: 'none', animation: 's-slin 0.1s ease-out',
            minWidth: 130,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <UnitChip unit={hu} size={24} />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{hu.name}</span>
            </div>
            <div style={{ fontSize: 10, color: '#8b93a8', marginBottom: 2 }}>
              Lv {hu.level}　{hu.cls}
            </div>
            <div style={{ fontSize: 11, marginBottom: 2 }}>
              <span style={{ color: '#8b93a8' }}>HP </span>
              <span style={{ fontWeight: 700, color: hpCol }}>{hu.hp}</span>
              <span style={{ color: '#5a6174' }}>/{hu.maxHp}</span>
            </div>
            {(() => {
              const buffs = getActiveCounters(hu, BUFF_COUNTERS);
              const debuffs = getActiveCounters(hu, DEBUFF_COUNTERS);
              if (!buffs.length && !debuffs.length) return null;
              return <>
                {buffs.length > 0 && (
                  <div style={{ fontSize: 9, color: '#34d399' }}>
                    バフ: {buffs.join(', ')}
                  </div>
                )}
                {debuffs.length > 0 && (
                  <div style={{ fontSize: 9, color: '#fbbf24' }}>
                    デバフ: {debuffs.join(', ')}
                  </div>
                )}
              </>;
            })()}
            {hu.chargeCounter > 0 && (
              <div style={{ fontSize: 9, color: '#f97316' }}>
                チャージ中 残{hu.chargeCounter}T
              </div>
            )}
          </div>
        );
      })()}

      {/* === 地形情報ツールチップ === */}
      {hoverCell && (
        <div style={{
          position: 'absolute', bottom: 8, left: 10,
          background: 'rgba(12,15,26,0.9)', padding: '4px 10px',
          borderRadius: 4, border: '1px solid #1e293b',
          fontSize: 11, color: '#8b93a8', zIndex: 45,
        }}>
          {getTerrainName(terrain[hoverCell.y]?.[hoverCell.x])}
          {getTerrainDef(hoverCell.x, hoverCell.y) > 0 &&
            <span style={{ color: '#4ade80', marginLeft: 6 }}>
              DEF+{getTerrainDef(hoverCell.x, hoverCell.y)}
            </span>
          }
          <span style={{ marginLeft: 6 }}>({hoverCell.x},{hoverCell.y})</span>
        </div>
      )}

      {/* === バナー（PLAYER PHASE / ENEMY PHASE / STAGE CLEAR等） === */}
      {banner && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)', zIndex: 200,
          pointerEvents: 'none',
        }}>
          <div style={{
            background: banner.text?.includes('PLAYER')
              ? 'linear-gradient(90deg,transparent,rgba(37,99,235,0.7),rgba(37,99,235,0.7),transparent)'
              : banner.text?.includes('ENEMY')
                ? 'linear-gradient(90deg,transparent,rgba(185,28,28,0.7),rgba(185,28,28,0.7),transparent)'
                : 'linear-gradient(90deg,transparent,rgba(0,0,0,0.7),rgba(0,0,0,0.7),transparent)',
            padding: '18px 80px',
            animation: 's-ban 1.4s ease-in-out forwards',
          }}>
            <div style={{
              fontSize: 28, fontWeight: 900, color: '#fff',
              letterSpacing: 8,
              textShadow: '0 2px 12px rgba(0,0,0,0.5)',
              textAlign: 'center',
            }}>{banner.text}</div>
          </div>
        </div>
      )}
    </div>
  );
}
