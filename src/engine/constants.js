// ═══ ゲーム全体の定数 ═══
// アプリのバージョン（右上の設定パネルに表示。どのビルドが動いてるか確認用）
export const APP_VERSION = 'v2.0.7';
// 上端白ライン切り分け用の診断オーバーレイ。原因特定後に false に戻す。
export const DEBUG_TOP_SENTINEL = false;
export const TILE = 48;
export const GW = 1280;
export const GH = 720;

// ═══ 表示スケール ═══
// UI/フォントの基本サイズ拡大率（全デバイス共通でデカくする分）。
// マップとは独立。立ち絵等を無闇に引き伸ばさないため、拡大はUI/マップを別々に管理する。
export const UI_SCALE = 1.7;
// モバイル時のマップ拡大率（マップ&ユニットのみ。15マス→約7.5マス映る）
export const MAP_ZOOM_MOBILE = 2;
// フィット後scaleがこの値未満なら「画面が小さい」=モバイル扱いでマップを拡大
export const MAP_ZOOM_THRESHOLD = 0.7;

// 経験値
export const EXP_PER_HIT = 5;
export const EXP_POOL = 20;
export const EXP_NEXT = 20;
export const LEVEL_CAP = 13;
export const EXP_COMBAT_CAP = 20;

// 追撃 — INT差1あたり1%（事故枠）
export const PURSUIT_RATE_PER_INT = 1;

// デバフ命中
export const DEBUFF_HIT_PER_INT = 5;

// インターバル
export const HP_RECOVERY_PCT = 0.3;

// ステージ
export const NUM_STAGES = 6;

// パーティ
export const PARTY_MAX = 8;
export const INITIAL_SORTIE = 6;
export const RECRUIT_SHOW = 3;
export const RECRUIT_PICK = 2;

// ドラフト
export const DRAFT_PICKS = 3;
export const RARITY_RATES = { C: 65, U: 28, R: 7 };
export const TAG_WEIGHTS = { tagA: 38, tagB: 38, weak: 12, neutral: 12 };

// カウンター定義（counters.jsonから構築）
import countersData from '../data/counters.json';
export const COUNTER_DEFS = Object.fromEntries(
  countersData.map(c => [c.name, {
    persistent: c.persistent || false,
    buff: c.buff || false,
    debuff: c.debuff || false,
    status: c.status || null,
    display: c.display || 'full',  // 'full' | 'nameOnly' | 'hidden'
    max: c.max ?? 99,
    effects: c.effects || [],
  }])
);

// status → カウンター名の逆引き（例: '反撃不能' → ['反撃不能'] ）
// 複数カウンターが同じ status を持てるように配列
export const STATUS_COUNTERS = {};
for (const [name, def] of Object.entries(COUNTER_DEFS)) {
  if (def.status) {
    if (!STATUS_COUNTERS[def.status]) STATUS_COUNTERS[def.status] = [];
    STATUS_COUNTERS[def.status].push(name);
  }
}

// アニメーション
export const STEP_MS = 80;
