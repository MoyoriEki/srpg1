import React from 'react';

// ユニットアイコン共通部品 — 画像対応 + 名前3文字フォールバック
export default function UnitChip({ unit, size = 34, onClick, style }) {
  const bg = unit.color || (unit.team === 'player' ? '#3b82f6' : '#ef4444');
  const chipSrc = unit.chip ? `${import.meta.env.BASE_URL}chips/${unit.chip}` : null;
  const [imgError, setImgError] = React.useState(false);
  const showImg = chipSrc && !imgError;

  return (
    <div
      onClick={onClick}
      style={{
        width: size, height: size, borderRadius: 5,
        background: showImg ? 'transparent' : `linear-gradient(135deg, ${bg}, ${bg}cc)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
        border: unit.team === 'player'
          ? '2px solid rgba(255,255,255,0.3)'
          : '2px solid rgba(0,0,0,0.3)',
        boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
        flexShrink: 0, cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {showImg ? (
        <img
          src={chipSrc}
          alt={unit.name}
          onError={() => setImgError(true)}
          style={{
            width: '100%', height: '100%',
            objectFit: 'cover',
            imageRendering: 'pixelated',
          }}
        />
      ) : (
        <span style={{
          fontSize: size * 0.38, fontWeight: 700, color: '#fff',
          textShadow: '0 1px 2px rgba(0,0,0,0.5)',
        }}>
          {unit.name.slice(0, 3)}
        </span>
      )}
    </div>
  );
}
