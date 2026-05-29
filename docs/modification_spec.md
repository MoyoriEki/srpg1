# プロト修正仕様書 v1

> この部屋（設計議論）で決定した修正をClaude Code Desktopで実装するための仕様書。
> 4つの修正を含む。優先度順。

---

## 1. マップデータ外部化

### 概要
App.jsxにハードコードされたTEMP_MAP_M1/M2を外部JSONに移動。

### 作成済みファイル
- `src/maps/m1.json` — M1データ（6敵）
- `src/maps/m2.json` — M2データ（16敵）

### App.jsxの変更

**削除:** L36〜L99の `TEMP_MAP_M1`, `TEMP_MAP_M2`, `STAGE_MAPS` を全て削除。

**追加（ファイル先頭のimport付近）:**
```js
import mapM1 from './maps/m1.json';
import mapM2 from './maps/m2.json';

// 6ステージ分のマップ配列（M3-M6は暫定でM1/M2を使い回し）
const STAGE_MAPS = [mapM1, mapM2, mapM1, mapM2, mapM1, mapM2];
```

### JSONフォーマット（マップエディタとの互換性メモ）
```
{
  "name": "マップ名",
  "cols": 20, "rows": 15,
  "terrain": [[0,1,2,...], ...],    // 2D配列。0=平地,1=森,2=山,3=砦
  "deployZone": [{"x":1,"y":6}, ...],
  "enemies": [{"template":"グール","x":14,"y":4,"behavior":"aggressive"}, ...],
  "itemBoxes": [{"x":10,"y":3,"item":{"id":"item_heal","name":"傷薬","effect":"heal","value":15,"desc":"HP15回復"}}, ...]
}
```

旧マップエディタは `enemyDefs` + `placements` 形式。将来エディタを更新してこのフォーマットに合わせるか、インポート時に変換する。

---

## 2. 行動消費しない技（noAction）の正しい挙動

### 現状の問題
`noAction: true` の技（鉄壁の構え、簡易縫合、投擲）を使うと、`finishAction`が呼ばれずメニューが閉じる。
ユニットは未行動状態のまま放置され、再クリックすると**移動からやり直せてしまう**。

### 正しい仕様
1. 移動後にアクションメニューが出る
2. noAction技を使う → **技の回数は消費される**
3. **同じnoAction技は同ターン中は再使用不可**（`oncePer: true`）
4. アクションメニューが**再表示**される（使用済みnoAction技はグレーアウト）
5. 通常攻撃・行動消費する技・待機を選ぶと、通常通り`finishAction`
6. **移動は戻らない**。noAction技を使っても位置は固定のまま

### 実装方針

**ユニットに `_usedNoActionThisTurn` 配列を追加:**
```js
// ターン開始時にリセット（handleEndTurn内、acted=false の直後）
u._usedNoActionThisTurn = [];
```

**executeSelfBuff / handleItemUse の noAction 分岐を修正:**
```js
function executeSelfBuff(u, tech) {
  tech.uses--;
  addLog(`${u.name} は ${tech.name} を使った`, 'info');
  showPop(u.id, tech.name, 'buff');

  if (tech.noAction) {
    // 使用済みリストに追加
    setUnits(prev => prev.map(unit =>
      unit.id === u.id
        ? { ...unit, _usedNoActionThisTurn: [...(unit._usedNoActionThisTurn || []), tech.name] }
        : unit
    ));
    // アクションメニューを再表示（位置はそのまま）
    setMode('action');
    // menuPosはそのまま維持（setMenuPos不要）
  } else {
    finishAction(u.id);
    setMenuPos(null);
  }
}
```

**ActionMenu側で使用済みnoAction技をdisabledに:**
```js
// BattleUI.jsx の ActionMenu 内
const usedNoAction = unit._usedNoActionThisTurn || [];
// techs.filterの条件に追加
const techs = unit.techs.filter(t => canUseTech(unit, t));
// 各技のdisabled判定を修正
disabled={
  (isSealed && t.type !== 'selfBuff') ||
  (t.oncePer && usedNoAction.includes(t.name))
}
```

**簡易縫合（heal + noAction）への対応:**
簡易縫合は`type: "heal"` + `noAction: true`。現在はhealの処理パスで`finishAction`を呼んでいる。
`executeHealAction`内でもnoAction分岐が必要:
```js
async function executeHealAction(target) {
  // ... 既存の回復処理 ...

  if (chosenTech.noAction) {
    setUnits(prev => prev.map(unit =>
      unit.id === healer.id
        ? { ...unit, _usedNoActionThisTurn: [...(unit._usedNoActionThisTurn || []), chosenTech.name] }
        : unit
    ));
    setMode('action');
    // menuPosそのまま
  } else {
    finishAction(healer.id);
  }
  busyRef.current = false;
}
```

**投擲（fixed + noAction）への対応:**
投擲は`type: "fixed"` + `noAction: true`。攻撃技なので`executeAttack`のパスを通る。
`executeAttack`の末尾でnoAction分岐:
```js
async function executeAttack(target) {
  // ... 既存の攻撃処理 ...

  if (chosenTech?.noAction) {
    const updatedAtk2 = result.units.find(u => u.id === atk.id);
    if (updatedAtk2) {
      updatedAtk2._usedNoActionThisTurn = [
        ...(updatedAtk2._usedNoActionThisTurn || []),
        chosenTech.name
      ];
    }
    setUnits(result.units);
    setMode('action');
    // menuPosそのまま
  } else {
    finishAction(atk.id);
  }

  checkStageClear(result.units);
  busyRef.current = false;
}
```

**キャンセル（戻る）の挙動:**
noAction技を使った後のキャンセルは**移動前に戻さない**。
現在の`handleCancel`は`origPos`に戻しているが、noAction技使用後は位置を戻すべきでない。
→ noAction技を1つでも使った時点で`origPos`をnullにする（移動は確定）。

---

## 3. CC（クラスチェンジ）をインターバルに移動

### 現状の問題
レベルアップ時にCCオプションが表示される。設計では「CCはマップ間イベント」。

### 正しいフロー
1. M2クリア → インターバル画面
2. インターバルで**全ユニットに中級CC選択**を順次実行
3. CC後に特殊ドラフト（タグ100%/U率UP）
4. 次ステージへ

M4クリア後も同様に上級CC。

### 実装方針

**handleLevelUp からCC判定を削除:**
```js
async function handleLevelUp(u) {
  const { unit: lvUnit, gains } = applyLevelUp(u);
  // CC判定を削除。常にドラフトのみ
  const parts = rollParts(lvUnit);
  // ... pendingLvUpセット ...
}
```

**IntervalUIにCCフェーズを追加:**

IntervalUIに新しいstate: `ccPhase`
- `null` → 通常のインターバル表示
- `{ unitIndex: 0, units: [...ccTargets] }` → CC選択中

```
フロー:
1. advanceStage() でphase='interval'に遷移
2. IntervalUI表示
3. CC対象ステージの場合（stage===1 or stage===3）、CCフェーズに入る
4. 対象ユニットを1人ずつCC選択画面に出す
5. CC選択 → 特殊ドラフト → 次のユニット
6. 全員完了 → 通常のインターバル表示に戻る
7. 「出撃」で次ステージへ
```

**CC対象ステージの判定:**
```js
const CC_STAGES = { 1: 'mid', 3: 'adv' }; // stage=1(M2後)→中級CC, stage=3(M4後)→上級CC
```

**IntervalUIのpropsに追加:**
```js
ccType      — 'mid' | 'adv' | null
onCCSelect  — (unitId, className) => void
onCCDraft   — (unitId, part) => void
```

**CC選択UI:**
各ユニットに対して getCCOptions() を呼び、2択を表示。
選択後 applyCC() → rollParts() で特殊ドラフト。
これを全ユニット分繰り返す。

DraftUIコンポーネントを再利用できる（CC選択→パーツ選択の2ステップ）。

### App.jsx側の変更

`advanceStage` で ccPhase 管理:
```js
const [ccQueue, setCcQueue] = useState([]); // CC対象ユニットのキュー
const [ccDraft, setCcDraft] = useState(null); // CC後の特殊ドラフト

function advanceStage() {
  // ... 既存のHP回復処理 ...

  const ccType = CC_STAGES[stage]; // stage=1→'mid', stage=3→'adv'
  if (ccType) {
    // CC対象ユニットをキューに入れてインターバル+CCフェーズ開始
    const targets = recovered.filter(u => {
      const opts = getCCOptions(u);
      return opts && opts.type === ccType;
    });
    setCcQueue(targets.map(u => u.id));
  }

  setPhase('interval');
}
```

CCキューが空でないとき、IntervalUIがCC選択モードで表示。
1ユニットずつCC選択 → 特殊ドラフト → 次のユニット → キュー空になったら通常インターバル。

---

## 4. 合流処理（M1後の仲間追加）

### 仕様
- M1クリア後、プール13人中の残り7人から**ランダム3人を提示**
- プレイヤーが**2人を選択**
- 選ばれた2人はLv2-3で合流（先行パーティ設定。初期技＋傷薬のみ）
- 以降8人固定

### 実装方針

**App.jsxの状態追加:**
```js
const [fullPool, setFullPool] = useState([]); // 13人全員
const [recruitPhase, setRecruitPhase] = useState(null);
// { candidates: [unit, unit, unit], picked: [] }
```

**ゲーム初期化を変更:**
```js
useEffect(() => {
  const allRoster = createRoster(); // 13人
  setFullPool(allRoster);
  const shuffled = [...allRoster].sort(() => Math.random() - 0.5);
  const initial = shuffled.slice(0, INITIAL_SORTIE); // 6人
  setRoster(initial);
  initStage(0, initial);
}, []);
```

**advanceStage で合流チェック:**
```js
function advanceStage() {
  if (stage === 0) {
    // M1クリア後: 合流フェーズ
    const currentIds = roster.map(u => u.id);
    const remaining = fullPool.filter(u => !currentIds.includes(u.id));
    const shuffled = [...remaining].sort(() => Math.random() - 0.5);
    const candidates = shuffled.slice(0, RECRUIT_SHOW); // 3人

    // 合流キャラのレベルを2-3に上げる
    candidates.forEach(u => {
      // Lv2-3: 1-2回レベルアップ
      for (let i = 0; i < 2; i++) {
        if (u.level < 3) {
          const { unit } = applyLevelUp(u);
          Object.assign(u, unit);
        }
      }
    });

    setRecruitPhase({ candidates, picked: [] });
    setPhase('recruit');
    return;
  }
  // ... 既存の処理 ...
}
```

**RecruitUI（新規コンポーネント）:**
- 3人のキャラカードを表示
- クリックで選択/解除（最大2人）
- 2人選んだら「決定」ボタン
- 確定 → roster に追加 → インターバル or 次ステージへ

```
src/ui/RecruitUI.jsx
props:
  candidates  — Unit[3]
  picked      — string[] (選択済みID)
  onToggle    — (unitId) => void
  onConfirm   — () => void
  onUnitClick — (unit) => void  ステータス詳細表示用
```

**合流確定時:**
```js
function handleRecruitConfirm() {
  const newMembers = recruitPhase.candidates.filter(u =>
    recruitPhase.picked.includes(u.id)
  );
  const updatedRoster = [...roster, ...newMembers];
  setRoster(updatedRoster);
  setRecruitPhase(null);
  // インターバルへ or 直接次ステージへ
  setStage(1);
  setPhase('interval'); // or initStage(1, updatedRoster);
}
```

---

## 実装順序

1. **マップ外部化** — 最も独立。App.jsxのimport変更のみ
2. **noAction技** — App.jsx + BattleUI.jsx。他に影響なし
3. **CC→インターバル** — App.jsx + IntervalUI.jsx + DraftUI再利用
4. **合流処理** — App.jsx + RecruitUI.jsx新規

1と2は独立に実装可能。3と4はinterval周りが絡むので3→4の順で。

---

## 変更しないもの（現時点で未実装のまま）

- canto（スレイヤー再移動）
- 身代わり（プロテクター）
- 個人特性の効果
- ショップ

