# 実装仕様書: タスク1&2

> Claude Code Desktop向け。srpg-protoプロジェクト。
> 設計詳細は gnosia_fe_design_v2.md / balance_knowledge_v5.md / dev_progress.md を参照。

---

## タスク1: アイテムボックス敵踏み消去

### 概要
敵がアイテムボックスのあるマスに移動した場合、そのアイテムボックスを消去する。
「マリオカートのアイテムボックス」のイメージ。敵が先に取ったら消える。

### 実装方針: B方式（敵ターン終了時に一括チェック）
- AIモジュール(ai.js)は副作用を持たない。map状態を書き換えない
- 敵全員の行動が終わった後、App.jsx側で一括チェック→消去

### 実装箇所

**App.jsx — 敵ターン終了処理**

敵フェーズの全ユニット行動完了後（現在の`enemyPhase`処理の末尾）に以下を追加:

```js
// 敵ターン終了時: アイテムボックス消去チェック
const destroyedBoxes = [];
const aliveEnemies = units.filter(u => u.side === 'enemy' && u.hp > 0);
const remainingBoxes = itemBoxes.filter(box => {
  const enemyOnBox = aliveEnemies.some(e => e.x === box.x && e.y === box.y);
  if (enemyOnBox) {
    destroyedBoxes.push(box);
    return false; // 除去
  }
  return true; // 残す
});

if (destroyedBoxes.length > 0) {
  setItemBoxes(remainingBoxes);
  destroyedBoxes.forEach(box => {
    addLog(`敵がアイテムボックスを破壊した (${box.x},${box.y})`);
  });
}
```

### 注意点
- `itemBoxes`のstate名・構造は現在のApp.jsxを確認して合わせること
- アイテムボックスは地形(terrain)ではなくオーバーレイなので、moveコストには影響しない
- 味方がアイテムボックスを踏んだ時のドロップ処理は別タスク（タスク3のlootTables対応で実装する）

---

## タスク2: 悪魔の契約系3つのエンジン実装

### 概要
parts.json ID 73「悪魔との契約」取得時に、通常枠とは別に3つの能力を自動獲得する。
今回追加されたのは以下の3つ（ID 74-76、既にparts.json/techs.jsonに追加済み）:

| ID | 名前 | 種別 | 効果 |
|----|------|------|------|
| 74 | 苦痛の印 | skill | 呪いカウンターの数だけSTR/INT上昇 |
| 75 | 狂気のやすらぎ | tech | 呪いカウンター+1。呪いカウンター数分HP回復 |
| 76 | 解呪 | tech | 呪いカウンター最大6除去。除去数×6ダメージ |

### 2-A: 苦痛の印（ID 74, skill）

**データ（parts.json、追加済み）:**
```json
{
  "id": 74,
  "name": "苦痛の印",
  "type": "skill",
  "tag": "",
  "rarity": "",
  "desc": "呪いカウンターの数だけSTR/INT上昇",
  "effects": [
    {"trigger": "always", "scope": "self", "type": "statScale", "stat": "str", "source": "counter", "counter": "呪い", "mult": 1},
    {"trigger": "always", "scope": "self", "type": "statScale", "stat": "int", "source": "counter", "counter": "呪い", "mult": 1}
  ]
}
```

**実装箇所: src/engine/skills.js — sumStatMod関数**

現在`sumStatMod`は`statMod`タイプのみ集計している。`statScale`タイプを追加:

```js
// sumStatMod内、collectEffectsの結果を処理するループに追加
if (eff.type === 'statScale' && eff.stat === stat) {
  if (eff.source === 'counter') {
    const count = (unit.counters && unit.counters[eff.counter]) || 0;
    total += count * (eff.mult || 1);
  }
}
```

これにより `effectiveAtk` / `effectiveInt` で呪いカウンター数分のSTR/INTが加算される。

### 2-B: 狂気のやすらぎ（ID 75, tech）

**データ（techs.json、追加済み）:**
```json
{
  "type": "special",
  "subType": "curseHeal",
  "rangeMin": 0,
  "rangeMax": 0,
  "maxUses": 99,
  "desc": "呪いカウンター+1。呪いカウンター数分HP回復",
  "tag": "",
  "rarity": ""
}
```

**実装箇所: src/engine/combat.js — special技の処理分岐**

`executeCombat`（またはspecial技のディスパッチ箇所）に`curseHeal`分岐を追加:

```js
case 'curseHeal': {
  // 呪いカウンター+1
  if (!attacker.counters) attacker.counters = {};
  attacker.counters['呪い'] = (attacker.counters['呪い'] || 0) + 1;
  const curseCount = attacker.counters['呪い'];
  // 呪いカウンター数分HP回復
  const healAmt = Math.min(curseCount, attacker.maxHp - attacker.hp);
  attacker.hp += healAmt;
  logs.push(`${attacker.name}は呪いを受け入れた（呪い→${curseCount}）`);
  logs.push(`${attacker.name}はHP${healAmt}回復した`);
  break;
}
```

**射程:** `rangeMin: 0, rangeMax: 0` = 自分自身が対象。対象選択UI不要（自己使用技）。
現在の射程0の扱いを確認し、対象を自分にする処理がなければ追加すること。

### 2-C: 解呪（ID 76, tech）

**データ（techs.json、追加済み）:**
```json
{
  "type": "special",
  "subType": "uncurse",
  "rangeMin": 0,
  "rangeMax": 0,
  "maxUses": 99,
  "desc": "呪いカウンター最大6除去。除去数×6ダメージ",
  "tag": "",
  "rarity": ""
}
```

**実装箇所: src/engine/combat.js — special技の処理分岐**

```js
case 'uncurse': {
  if (!attacker.counters) attacker.counters = {};
  const curseCount = attacker.counters['呪い'] || 0;
  const removeCount = Math.min(curseCount, 6);
  attacker.counters['呪い'] = curseCount - removeCount;
  if (attacker.counters['呪い'] <= 0) delete attacker.counters['呪い'];
  const selfDmg = removeCount * 6;
  attacker.hp = Math.max(1, attacker.hp - selfDmg);
  logs.push(`${attacker.name}は呪いを${removeCount}個解呪した`);
  logs.push(`${attacker.name}は${selfDmg}ダメージを受けた（HP${attacker.hp}）`);
  break;
}
```

**注意:** 自傷で死なないようHP最低1保証。設計判断でHP0許可にする場合は `Math.max(1, ...)` を外す。

### 2-D: 悪魔との契約（ID 73）取得時の自動獲得

**現在のdraft.js — applyPart関数の`onAcquire`処理を確認。**

悪魔との契約(id:73)のeffectsに`onAcquire`エフェクトがあるはず。取得時に以下を自動で行う:

1. 呪いカウンターをレベル数分付与
2. ID 74（苦痛の印）、ID 75（狂気のやすらぎ）、ID 76（解呪）を**通常枠外で**自動装備

現在の`悪魔との契約`のeffectsを確認し、上記が含まれていなければ追加する。
parts.jsonの悪魔との契約エントリ:

```json
{
  "id": 73,
  "name": "悪魔との契約",
  "type": "skill",
  "tag": "dark",
  "rarity": "R",
  "desc": "獲得時呪いカウンターをレベル数得る。レベルアップする度に呪いカウンター１つ増加。通常の枠とは別に「苦痛の印」/「狂気のやすらぎ」/「解呪」の3つの能力を得る。",
  "effects": [
    {"trigger": "onAcquire", "scope": "self", "type": "system", "action": "curseContract"}
  ]
}
```

**draft.js の applyPart 内 onAcquire/system 処理:**

```js
if (eff.action === 'curseContract') {
  // 呪いカウンターをレベル数付与
  if (!unit.counters) unit.counters = {};
  unit.counters['呪い'] = (unit.counters['呪い'] || 0) + unit.level;
  // 3つの能力を通常枠外で追加
  const contractParts = [74, 75, 76]; // 苦痛の印、狂気のやすらぎ、解呪
  for (const pid of contractParts) {
    const part = allParts.find(p => p.id === pid);
    if (part && !unit.parts.some(p => p.id === pid)) {
      // 通常枠にカウントしない特殊スロットとして追加
      // unit.extraParts配列がなければ作成
      if (!unit.extraParts) unit.extraParts = [];
      unit.extraParts.push(part);
      // tech型ならtechsにも追加
      if (part.type === 'tech' && part.techRef) {
        unit.techs.push({ name: part.techRef, uses: techData[part.techRef]?.maxUses || 99 });
      }
      // skill型ならeffectsを適用
      if (part.type === 'skill' && part.effects) {
        // effectsの静的適用（statModのself等）
        applySkillEffects(unit, part);
      }
    }
  }
  logs.push(`${unit.name}は悪魔と契約した（呪い${unit.counters['呪い']}）`);
}
```

**レベルアップ時の呪いカウンター増加:**

src/engine/levelup.js の `applyLevelUp` 内に追加:

```js
// 悪魔との契約を持っていればレベルアップ時に呪い+1
if (unit.parts.some(p => p.id === 73) || unit.extraParts?.some(p => p.id === 73)) {
  if (!unit.counters) unit.counters = {};
  unit.counters['呪い'] = (unit.counters['呪い'] || 0) + 1;
  logs.push(`${unit.name}の呪いが深まった（呪い${unit.counters['呪い']}）`);
}
```

### 射程0（自己対象技）について

狂気のやすらぎ・解呪は`rangeMin:0, rangeMax:0`。これは「自分自身を対象とする技」を意味する。

現在のpathfinding.jsの攻撃範囲計算やApp.jsxの対象選択UIが射程0を扱えるか確認すること。扱えない場合:

- `getAttackRange`で射程0の時は自分の座標のみを返す
- 対象選択UIで射程0の時は自動的に自分を選択（対象選択スキップ）

---

## 実装順序の推奨

1. **タスク1（アイテムボックス消去）** — 最も単純。App.jsxの敵ターン末尾に数行追加
2. **タスク2-A（苦痛の印）** — skills.jsのstatScale対応。単体で完結
3. **タスク2-B,C（狂気のやすらぎ、解呪）** — combat.jsのspecial分岐追加 + 射程0対応
4. **タスク2-D（悪魔との契約onAcquire）** — draft.jsのsystem処理 + levelup.jsの呪い増加

## テスト確認項目

- [ ] 敵がアイテムBOXマスに移動→BOX消滅、ログ出力
- [ ] 苦痛の印所持+呪いカウンター3→STR+3, INT+3が反映される
- [ ] 狂気のやすらぎ使用→呪い+1、呪い数分HP回復
- [ ] 解呪使用→呪い最大6除去、除去数×6自傷、HP1保証
- [ ] 悪魔との契約取得→呪いレベル数付与、3能力自動獲得（枠外）
- [ ] レベルアップ時に契約者の呪い+1
