# SRPG エンジン設計書 + ロードマップ

> 「ここ変えたい」→「このファイルのこの関数」が即座にわかるための地図。
> プロジェクトナレッジとして常に参照する。

---

## モジュール構成

```
srpg-proto/
├── src/
│   ├── engine/           ← ゲームロジック（UI非依存）
│   │   ├── combat.js     ← ダメージ計算・戦闘実行
│   │   ├── ai.js         ← 敵AIパターン
│   │   ├── pathfinding.js← 移動範囲・攻撃範囲・経路探索
│   │   ├── levelup.js    ← 経験値・レベルアップ・成長率
│   │   ├── draft.js      ← ドラフト抽選・パーツ適用・枠管理
│   │   ├── classChange.js← CC判定・CC補正・ルート解決
│   │   ├── skills.js     ← スキル効果ディスパッチ
│   │   ├── debuff.js     ← デバフ付与・ターン経過・解決
│   │   ├── map.js        ← 地形参照・マップ読み込み・アイテムボックス
│   │   ├── units.js      ← ユニット生成・実効ステ計算
│   │   └── constants.js  ← ゲーム全体の定数
│   ├── data/             ← JSONデータ（数値調整はここだけ）
│   │   ├── terrains.json
│   │   ├── classes.json
│   │   ├── techs.json
│   │   ├── parts.json
│   │   ├── units.json
│   │   ├── enemies.json
│   │   ├── items.json
│   │   └── monsters.json
│   ├── maps/             ← マップデータ（エディタ出力と同一形式）
│   │   ├── m1.json
│   │   └── m2.json
│   ├── ui/               ← React UIコンポーネント
│   │   ├── MapView.jsx   ← マップ描画・タイル・ユニット表示
│   │   ├── BattleUI.jsx  ← 戦闘予測・コマンドメニュー
│   │   ├── DraftUI.jsx   ← ドラフト3択・CC選択
│   │   ├── DeployUI.jsx  ← 配置フェーズUI
│   │   ├── IntervalUI.jsx← インターバル画面
│   │   ├── StatusScreen.jsx ← ステータス詳細オーバーレイ
│   │   ├── LogPanel.jsx  ← 戦闘ログ
│   │   └── UnitChip.jsx  ← ユニットアイコン共通部品
│   ├── App.jsx           ← フェーズ管理・モジュール間接続（薄く保つ）
│   └── main.jsx          ← エントリ
├── tools/
│   └── map-editor.html   ← マップエディタ（スタンドアロン）
├── index.html
├── vite.config.js
└── package.json
```

---

## モジュール責務マップ

### engine/combat.js — 戦闘計算・実行
**「ダメージ計算を変えたい」「戦闘の処理順を変えたい」→ここ**

| 関数 | 責務 |
|------|------|
| `calcDamage(atk, def, tech)` | 単発ダメージ計算（type別分岐: flatAdd/mult/fixed/intRef） |
| `executeCombat(atkU, defU, tech, units)` | 1v1戦闘の全処理（攻撃→反撃→追撃→デバフ） |
| `executeAoeCombat(atkU, dir, tech, units)` | 範囲攻撃の全処理 |
| `executeHeal(healer, target, tech, units)` | 回復技の処理 |
| `calcPursuit(atk, def)` | 追撃判定（INT差%） |

依存: `units.js`（実効ステ）、`skills.js`（戦闘中スキル効果）、`debuff.js`（デバフ付与）

---

### engine/ai.js — 敵AI
**「新しい敵行動パターンを追加したい」→ここ**

| 関数 | 責務 |
|------|------|
| `runEnemyPhase(enemies, allUnits)` | 敵ターン全体の実行 |
| `decideAction(enemy, allUnits)` | 1体の行動決定（パターン別） |
| `ai_aggressive(enemy, targets, units)` | 近づいて殴る |
| `ai_stationary(enemy, targets, units)` | 射程内なら攻撃、なければ待機 |
| `ai_charge(enemy)` | チャージ技のカウント進行 |

新AIパターン追加 = `ai_xxx` 関数を追加 + enemies.jsonの`behavior`に名前追加。

---

### engine/pathfinding.js — 移動・射程
**「移動コスト計算を変えたい」「新しい射程タイプを足したい」→ここ**

| 関数 | 責務 |
|------|------|
| `bfs(unit, units, mapData)` | BFS移動範囲計算 |
| `getPath(unit, tx, ty, units, mapData)` | 経路復元 |
| `getAtkCells(x, y, rMin, rMax)` | 攻撃可能セル |
| `getTechRange(tech, unit)` | 技の実効射程（INT÷N等を解決） |
| `getAoeCells(x, y, aoeType, dir)` | AoE範囲計算 |
| `manhattan(a, b)` | マンハッタン距離 |

---

### engine/levelup.js — 経験値・成長
**「経験値の配分を変えたい」「成長率計算を変えたい」→ここ**

| 関数 | 責務 |
|------|------|
| `awardExp(player, enemy, isKill)` | EXPプールから配分 |
| `applyLevelUp(unit, classData)` | レベルアップ処理（端数蓄積・切り捨て） |
| `expNext()` | 次レベルに必要な経験値 |

---

### engine/draft.js — ドラフト・パーツ
**「ドラフトの抽選ロジックを変えたい」「パーツの適用処理を変えたい」→ここ**

| 関数 | 責務 |
|------|------|
| `rollParts(unit, partsData, n=3)` | 3択パーツ抽選（タグ重み・レアリティ率） |
| `applyPart(unit, part, techsData)` | パーツをユニットに適用 |
| `removePart(unit, partName)` | パーツ除去（入替時） |
| `getSlots(unit, classData)` | 現在の枠数取得 |

---

### engine/classChange.js — クラスチェンジ
**「CCルートを追加したい」「CC補正を変えたい」→ここ**

| 関数 | 責務 |
|------|------|
| `getCCOptions(unit, classData)` | CC選択肢の取得 |
| `applyCC(unit, newClass, classData)` | CC適用（ステ補正・PP加算・射程変更） |

---

### engine/skills.js — スキル効果
**「新しいスキルの効果ロジックを追加したい」→ここ**

| 関数 | 責務 |
|------|------|
| `hasSkill(unit, name)` | スキル所持チェック |
| `atkModifiers(atk, def, units)` | 攻撃時のスキル補正集約 |
| `defModifiers(def, units)` | 防御時のスキル補正集約 |
| `onKill(unit, target, units)` | 撃破時トリガー（血風・魔物食等） |
| `onTurnStart(unit, units)` | ターン開始時トリガー |
| `onTurnEnd(unit, units)` | ターン終了時トリガー |
| `adjAllyBonus(unit, units, type)` | 隣接味方ボーナス |
| `adjEnemyPenalty(unit, units)` | 隣接敵ペナルティ |

新スキル追加 = 該当トリガー関数内にcase追加 or 新トリガー関数作成。

---

### engine/debuff.js — デバフ
**「デバフの持続・解決タイミングを変えたい」→ここ**

| 関数 | 責務 |
|------|------|
| `applyDebuff(target, debuff)` | デバフ付与 |
| `resolveDebuffs(unit, timing)` | ターン開始/終了時のデバフ処理（火傷等） |
| `tickDebuffs(unit)` | ターン経過で持続減算 |
| `calcDebuffHit(atk, def, baseHit)` | デバフ命中率計算 |

---

### engine/map.js — マップ
**「地形効果を変えたい」「アイテムボックスの処理を変えたい」→ここ**

| 関数 | 責務 |
|------|------|
| `loadMap(mapJson, terrainsData)` | マップJSON読み込み・地形テーブル構築 |
| `getTerrain(x, y)` | 座標の地形情報取得 |
| `getTerrainDef(x, y)` | 地形DEF取得 |
| `getMoveCost(x, y)` | 移動コスト取得 |
| `getItemBoxes()` | アイテムボックス一覧 |
| `pickupItem(x, y)` | アイテム取得処理 |

---

### engine/units.js — ユニット
**「実効ATK/DEFの計算を変えたい」「ユニット生成を変えたい」→ここ**

| 関数 | 責務 |
|------|------|
| `createPlayerUnit(charData, techsData)` | 味方ユニット生成 |
| `createEnemyUnit(template, x, y, overrides)` | 敵ユニット生成 |
| `effectiveAtk(unit, units)` | 実効ATK（STR+PP+装備+隣接+スキル） |
| `effectiveDef(unit, units)` | 実効DEF（DEF+地形+隣接+スキル） |
| `effectiveInt(unit)` | 実効INT |
| `getATK(unit)` | 基礎ATK（STR+PP） |

---

### engine/constants.js — 定数
**「経験値の必要量を変えたい」「追撃の係数を変えたい」→ここ**

```js
export const TILE = 48;
export const EXP_PER_HIT = 5;
export const EXP_POOL = 20;
export const EXP_NEXT = 20;
export const LEVEL_CAP = 13;
export const PURSUIT_RATE_PER_INT = 1;  // INT差1あたり1%
export const DEBUFF_HIT_PER_INT = 5;
export const HP_RECOVERY_PCT = 0.3;
// etc.
```

---

### App.jsx — フェーズ管理（薄く保つ）
**「ゲームの進行フローを変えたい」→ここ**

- deploy → playerTurn → enemyTurn → stageClear → interval → 次マップ
- 各フェーズの開始/終了処理
- engineモジュールの呼び出し
- UIコンポーネントへのstate受け渡し

App.jsx自体にはゲームロジックを書かない。engineを呼ぶだけ。

---

## データファイル（data/）

**「数値を調整したい」→該当のJSONを編集するだけ**

| ファイル | 中身 | いつ編集する |
|----------|------|-------------|
| terrains.json | 地形タイプ定義 | 新地形追加時 |
| classes.json | クラス成長率・CC補正・PP・枠数・CCルート | バランス調整時 |
| techs.json | 技の威力・射程・回数・効果 | バランス調整時 |
| parts.json | ビルドパーツ（ドラフト） | パーツ追加・調整時 |
| units.json | 味方キャラ（初期ステ・タグ・初期技） | キャラ追加時 |
| enemies.json | 敵テンプレート | 敵種追加時 |
| items.json | アイテムボックス用アイテム | アイテム追加時 |
| monsters.json | 魔物の首輪選択肢 | 魔物追加時 |

---

## マップデータ（maps/）

**「マップの地形・敵配置を変えたい」→マップエディタで編集 or JSON直接編集**

各 `m*.json` の構造:
```
{
  id, name, cols, rows,
  terrain: [[...], ...],      ← 2D配列（terrains.jsonのidで参照）
  deployZone: [{x,y}, ...],   ← 味方配置可能セル
  enemies: [{template, x, y, level?, overrides?}, ...],
  itemBoxes: [{x, y, item}, ...]
}
```

---

## ロードマップ

### Phase 1: モジュール分割（← 今ここ）
- [x] 設計書作成
- [ ] proto-10.jsxを上記構成に分割
- [ ] Viteプロジェクトとしてローカルで動く状態にする
- [ ] マップエディタ更新（出力 = maps/*.json形式）

### Phase 2: 2面通し
- [ ] M1/M2の敵設計（enemies.json + maps/m1.json, m2.json）
- [ ] 合流処理（M1後に3提示→2選択）
- [ ] アイテムボックス実装（map.js + MapView.jsx）
- [ ] 初期ステをタグ基準値に統一（units.json）

### Phase 3: 仕様確定分の反映
- [ ] 旧所持品→スキル統合（parts.json + draft.js）
- [ ] クラスレベル制（levelup.js）
- [ ] 技威力の新体系統一（techs.json + combat.js）
- [ ] 中級CC（M2後イベント）

### Phase 4: ループ通し
- [ ] M3〜M6の敵設計
- [ ] 上級CC
- [ ] インターバルショップ
- [ ] メタ進行（周回要素）

---

## よくある変更 → 触る場所の早見表

| やりたいこと | 触るファイル |
|-------------|------------|
| 敵のステ・配置を変えたい | `data/enemies.json` + `maps/m*.json` |
| 技の威力・射程を調整したい | `data/techs.json` |
| パーツの効果を変えたい | `data/parts.json`（数値のみ）or `engine/skills.js`（ロジック） |
| 新しいスキル効果を追加したい | `engine/skills.js` に処理追加 + `data/parts.json` にデータ追加 |
| 新しい敵AIパターンを追加したい | `engine/ai.js` に関数追加 |
| 成長率・CC補正を変えたい | `data/classes.json` |
| マップの地形を変えたい | マップエディタ → `maps/m*.json` |
| 新しい地形タイプを追加したい | `data/terrains.json` + `engine/map.js`（特殊効果があれば） |
| ダメージ計算式を変えたい | `engine/combat.js` |
| 経験値・レベル計算を変えたい | `engine/levelup.js` |
| 新デバフを追加したい | `engine/debuff.js` + `data/techs.json` |
| UIの見た目を変えたい | `ui/該当コンポーネント.jsx` |
| ゲーム進行フローを変えたい | `App.jsx` |
| アイテムボックスの処理を変えたい | `engine/map.js` |
| 追撃・命中の係数を変えたい | `engine/constants.js` |
