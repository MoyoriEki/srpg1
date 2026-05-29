# データ駆動化 JSONスキーマ設計

## ファイル構成

```
srpg-proto/
├── index.html
├── vite.config.js
├── package.json
├── src/
│   ├── main.jsx          ← エントリ
│   ├── App.jsx            ← ゲーム本体（現proto-10のロジック+描画）
│   ├── data/
│   │   ├── terrains.json  ← 地形タイプ定義
│   │   ├── classes.json   ← クラス定義（成長率・CC補正・枠数・PP）
│   │   ├── techs.json     ← 技定義
│   │   ├── parts.json     ← ビルドパーツ（ドラフト用）
│   │   ├── units.json     ← 味方キャラ定義
│   │   ├── enemies.json   ← 敵テンプレート定義
│   │   ├── monsters.json  ← 魔物の首輪 選択肢
│   │   └── items.json     ← アイテムボックス用アイテム定義
│   └── maps/
│       ├── m1.json        ← マップ1: 地形+敵配置+アイテム配置+配置ゾーン
│       ├── m2.json
│       └── ...
└── tools/
    └── map-editor.html    ← マップエディタ（スタンドアロン）
```

---

## 1. terrains.json — 地形タイプ定義

```json
[
  { "id": 0, "name": "平地", "color": "#4a7c34", "def": 0, "moveCost": 1 },
  { "id": 1, "name": "森",   "color": "#2d5a1e", "def": 1, "moveCost": 2 },
  { "id": 2, "name": "山",   "color": "#6b7280", "def": 0, "moveCost": 99, "impassable": true },
  { "id": 3, "name": "砦",   "color": "#8b7355", "def": 2, "moveCost": 1 }
]
```

`id` がマップ配列内の数値に対応。新地形を足す時はここに追加するだけ。

---

## 2. classes.json — クラス定義

```json
{
  "冒険者": {
    "tier": "初級",
    "growth": { "hp": 2.5, "str": 0.8, "def": 0.8, "int": 0.8 },
    "pp": 0,
    "slots": { "tech": 2, "skill": 999, "item": 1 },
    "ccBonus": null
  },
  "炎闘士": {
    "tier": "中級",
    "tag": "fire",
    "growth": { "hp": 2.5, "str": 1.3, "def": 0.8, "int": 0.5 },
    "pp": 3,
    "slots": { "tech": 4, "skill": 999, "item": 2 },
    "ccBonus": { "hp": 2, "str": 2, "def": 1, "int": 0 }
  },
  "スレイヤー": {
    "tier": "上級",
    "tags": ["fire", "fire"],
    "trait": "canto",
    "growth": { "hp": 3.0, "str": 1.5, "def": 0.8, "int": 0.5 },
    "pp": 5,
    "slots": { "tech": 6, "skill": 999, "item": 3 },
    "range": { "min": 1, "max": 1 },
    "ccBonus": { "hp": 4, "str": 4, "def": 1, "int": -1 }
  }
}
```

- `pp`: そのクラスのPP加算値（累積はゲーム側で計算）
- `slots.skill`: 999 = 無制限
- `range`: 上級のみ。省略時はユニット側の値を維持
- `trait`: 兵種特性キー。ゲーム側でロジック参照

### CCルート定義（同ファイル末尾 or 別セクション）

```json
{
  "midCC": {
    "fire": "炎闘士",
    "water": "水遁士",
    "wind": "風術士"
  },
  "advCC": {
    "炎闘士_water": ["スレイヤー", "ヴァンガード"],
    "炎闘士_wind":  ["スレイヤー", "ソーサラー"],
    "水遁士_fire":  ["フォートレス", "ヴァンガード"],
    "水遁士_wind":  ["フォートレス", "プロテクター"],
    "風術士_fire":  ["オラクル", "ソーサラー"],
    "風術士_water": ["オラクル", "プロテクター"]
  }
}
```

---

## 3. techs.json — 技定義

```json
{
  "猛撃": {
    "mod": 6,
    "type": "flatAdd",
    "rangeMin": 1, "rangeMax": 1,
    "maxUses": 4,
    "desc": "威力6/射1/回4"
  },
  "連撃": {
    "mod": 0,
    "type": "mult",
    "mult": 1.0,
    "hits": 2,
    "rangeMin": 1, "rangeMax": 1,
    "maxUses": 3,
    "desc": "×1.0×2/射1/回3"
  },
  "ヒール": {
    "type": "heal",
    "healMod": 1.0,
    "rangeMin": 1, "rangeMax": 1,
    "maxUses": 4,
    "desc": "INT×1.0回復/射1"
  },
  "ブレイク": {
    "type": "debuffOnly",
    "debuff": { "name": "反撃不能", "turns": 1, "baseHit": 75 },
    "rangeType": "intDiv",
    "rangeDivisor": 3,
    "maxUses": 3,
    "desc": "射INT÷3/反撃封じ(75%)"
  },
  "烈火": {
    "mod": 9,
    "type": "flatAdd",
    "aoe": "dir_line",
    "rangeMin": 1, "rangeMax": 2,
    "maxUses": 2,
    "cond": { "counter": "衝動", "cost": 3 },
    "desc": "威力9/前方2マス直線/衝動3消費"
  },
  "砕撃": {
    "type": "fixed",
    "fixed": 16,
    "hpCost": 6,
    "rangeMin": 1, "rangeMax": 1,
    "maxUses": 2,
    "desc": "HP6消費/固定16ダメ/射1"
  },
  "稲妻": {
    "type": "intRef",
    "intMult": 1.0,
    "flatAdd": 3,
    "rangeMin": 1, "rangeMax": 2,
    "maxUses": 3,
    "desc": "INT×1.0+3/射1-2"
  }
}
```

### 技のtype体系

| type | 計算式 | 主なフィールド |
|------|--------|---------------|
| `flatAdd` | ATK + mod - DEF | `mod` |
| `mult` | ATK × mult - DEF | `mult` |
| `fixed` | 固定値（DEF無視） | `fixed` |
| `intRef` | INT × intMult + flatAdd - 敵INT | `intMult`, `flatAdd` |
| `heal` | INT × healMod | `healMod` |
| `debuffOnly` | ダメージなし | `debuff` |
| `selfBuff` | 自己バフ（鉄壁の構え等） | `selfEnd`, `buff` |

### 射程

- 固定: `rangeMin`, `rangeMax`
- INT依存: `rangeType: "intDiv"`, `rangeDivisor: 3` → 射程 = INT ÷ 3

### オプションフィールド

- `debuff`: `{ name, turns, baseHit }` — 攻撃技に付くデバフ
- `hpCost`: HP消費
- `drain`: 与ダメ回収率
- `push`: 押し出しマス数
- `hits`: ヒット数（省略=1）
- `aoe`: 範囲パターン（`dir_line`, `dir_cross`, `healArea`）
- `cond`: 使用条件（`{ stat, val }` or `{ counter, cost }`）
- `noAction`: 行動消費しない
- `oncePer`: 1ターン1回制限

---

## 4. parts.json — ビルドパーツ

```json
[
  {
    "id": 1,
    "name": "猛撃",
    "type": "tech",
    "tag": "fire",
    "rarity": "C",
    "techRef": "猛撃",
    "desc": "威力6/射1/回4"
  },
  {
    "id": 5,
    "name": "衝動",
    "type": "skill",
    "tag": "fire",
    "rarity": "C",
    "effect": "counterGen",
    "effectData": { "counter": "衝動", "trigger": "kill", "amount": 1, "max": 6 },
    "activeEffect": { "cost": 3, "buff": { "str": 3, "def": 3, "int": 3 }, "duration": 1 },
    "desc": "撃破で衝動+1(最大6)。3消費でSTR/DEF/INT+3"
  },
  {
    "id": 8,
    "name": "闘魂",
    "type": "skill",
    "tag": "fire",
    "rarity": "C",
    "effect": "statBoost",
    "effectData": { "str": 2 },
    "desc": "STR+2"
  }
]
```

- `type: "tech"` のパーツは `techRef` で techs.json のキーを参照
- `type: "skill"` は `effect` + `effectData` でスキル効果を記述
- スキル効果のロジック自体はゲーム側に持つ（JSONは「何を」だけ、「どう」はコード側）

---

## 5. units.json — 味方キャラ

```json
[
  {
    "id": "p01",
    "name": "ベルグ",
    "tags": ["fire", "water"],
    "base": { "hp": 38, "str": 8, "def": 9, "int": 7, "mov": 4 },
    "initTechs": ["猛撃", "盾殴り"],
    "color": "#1e40af"
  },
  {
    "id": "p02",
    "name": "ブリキ",
    "tags": ["fire", "water"],
    "base": { "hp": 38, "str": 8, "def": 9, "int": 7, "mov": 4 },
    "initTechs": ["猛撃", "盾殴り"],
    "color": "#f59e0b"
  }
]
```

- `base`: タグ基準の初期ステ（タグ別で統一。個性はキャラ固有おまけで微調整するなら別途フィールド）
- `initTechs`: 技名で参照。ゲーム起動時に techs.json から実体を引く
- 13人全員分定義。毎ループのランダム選出はゲーム側

---

## 6. enemies.json — 敵テンプレート

```json
{
  "グール": {
    "base": { "hp": 28, "str": 12, "def": 6, "int": 5, "mov": 4 },
    "range": { "min": 1, "max": 1 },
    "techs": ["強撃"],
    "behavior": "aggressive",
    "color": "#dc2626"
  },
  "シューター": {
    "base": { "hp": 22, "str": 10, "def": 4, "int": 8, "mov": 3 },
    "range": { "min": 2, "max": 3 },
    "techs": ["強弓"],
    "behavior": "stationary",
    "color": "#b45309"
  },
  "ボマー": {
    "base": { "hp": 24, "str": 22, "def": 4, "int": 10, "mov": 3 },
    "range": { "min": 1, "max": 1 },
    "techs": ["強撃"],
    "behavior": "stationary",
    "charge": { "tech": "大爆発", "turns": 2, "repeat": false },
    "color": "#f97316"
  }
}
```

- テンプレート定義。実際の配置はマップJSONで行う
- `charge`: チャージ技持ち用

---

## 7. maps/m1.json — マップデータ

```json
{
  "id": "m1",
  "name": "はじまりの草原",
  "cols": 20,
  "rows": 15,
  "terrain": [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,2,2,2,2,2],
    [0,0,0,0,2,0,0,0,0,0,0,0,0,2,2,2,2,2,2,2],
    "..."
  ],
  "deployZone": [
    { "x": 0, "y": 0 }, { "x": 1, "y": 0 }, "..."
  ],
  "enemies": [
    { "template": "グール",    "x": 9,  "y": 2 },
    { "template": "グール",    "x": 8,  "y": 4 },
    { "template": "グール",    "x": 7,  "y": 6 },
    { "template": "シューター", "x": 11, "y": 5 },
    { "template": "グール",    "x": 6,  "y": 8 },
    { "template": "シューター", "x": 12, "y": 7 }
  ],
  "itemBoxes": [
    { "x": 5, "y": 3, "item": "傷薬" },
    { "x": 10, "y": 7, "item": "バフ薬STR" }
  ],
  "overrides": {
    "enemies": [
      { "index": 3, "level": 2 }
    ]
  }
}
```

- `enemies[].template`: enemies.json のキーを参照
- `overrides`: 個別の敵にレベル・ステ上書き等が必要な場合
- マップエディタの出力がこのフォーマットに一致する

---

## 8. items.json — アイテム定義

```json
[
  { "id": "item_heal",    "name": "傷薬",       "type": "consumable", "effect": "heal",     "value": 15, "desc": "HP15回復" },
  { "id": "item_shroom",  "name": "キノコ",     "type": "consumable", "effect": "movBuff",  "value": 5,  "noAction": true, "duration": 1, "desc": "MOV+5(1T)" },
  { "id": "item_feather", "name": "羽",         "type": "consumable", "effect": "fly",      "duration": 3, "noAction": true, "desc": "飛行(3T)" },
  { "id": "item_str",     "name": "バフ薬STR",  "type": "consumable", "effect": "statBuff", "stat": "str", "value": 2, "duration": "map", "desc": "STR+2(マップ中)" },
  { "id": "item_def",     "name": "バフ薬DEF",  "type": "consumable", "effect": "statBuff", "stat": "def", "value": 2, "duration": "map", "desc": "DEF+2(マップ中)" },
  { "id": "item_int",     "name": "バフ薬INT",  "type": "consumable", "effect": "statBuff", "stat": "int", "value": 2, "duration": "map", "desc": "INT+2(マップ中)" },
  { "id": "item_gold",    "name": "ゴールド",   "type": "resource",   "effect": "gold",     "value": 1, "desc": "インターバルで使用" }
]
```

---

## 9. monsters.json — 魔物の首輪選択肢

```json
[
  { "name": "狼",   "hp": 0, "str": 0, "def": -2, "int": -2, "mov": 2, "bonusSlots": {}, "desc": "MOV+2 DEF-2 INT-2" },
  { "name": "象",   "hp": 0, "str": 2, "def": 4,  "int": 0,  "mov": -1, "bonusSlots": {}, "desc": "STR+2 DEF+4 MOV-1" },
  { "name": "荷運びゴブリン", "hp": 0, "str": 0, "def": 0, "int": 0, "mov": 0, "bonusSlots": { "tech": 1, "skill": 1, "item": 1 }, "desc": "枠+3" }
]
```

---

## マップエディタの出力仕様

エディタは `maps/m1.json` と同一フォーマットでexport。具体的には:

1. 地形ペイント → `terrain` 配列
2. 敵配置モード → `enemies` 配列（テンプレート名+座標）
3. アイテムボックス配置 → `itemBoxes` 配列
4. 配置ゾーンペイント → `deployZone` 配列
5. JSON Export ボタン → ファイル保存

エディタは `terrains.json` と `enemies.json` を読み込んで、パレットを動的に生成する。
