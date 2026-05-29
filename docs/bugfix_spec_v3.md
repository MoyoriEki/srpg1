# バグ修正仕様書 v3 — Claude Code向け

> この文書の修正を**全て**適用すること。修正後に自分でビルド確認すること。
> 参考: docs/srpg-proto-10.jsx.bak が旧プロトの実装。挙動で迷ったらそちらを参照。

---

## FIX-1. ホバーツールチップがコンテキストメニューと被る

### ファイル: src/ui/MapView.jsx
### 原因: ctxMenuが開いている時もツールチップが表示される

### 修正方針:
App.jsxからctxMenuの有無をMapViewに渡し、ctxMenuが開いている時はツールチップを非表示にする。

App.jsx側: MapViewに `ctxMenuOpen={!!ctxMenu}` を追加。
MapView側: ツールチップの表示条件に `&& !ctxMenuOpen` を追加。

---

## FIX-2. noAction技（鉄壁の構え等）使用後の挙動を根本修正

### 原因: noAction技の状態遷移が複雑すぎてescape pathが漏れまくっている

### 根本方針:
noAction技使用後は**残り移動力で再移動できる**。これは通常の「選択→移動→アクション」フローの繰り返し。

### 状態遷移図（これを正とする）:

```
[select] ← ユニット選択待ち
  │ ユニットクリック
  ▼
[select + moveCells表示] ← 移動先選択
  │ 移動先クリック
  ▼
[action] ← アクションメニュー表示（「戻る」でorigPosに戻れる）
  │ noAction技使用
  ▼
[select + moveCells表示(残MOV)] ← 再移動先選択（「戻る」なし。noAction前には戻れない）
  │ 移動先クリック or 範囲外クリック
  ▼
[action] ← アクションメニュー（「戻る」で再移動前に戻れる）
  │ 通常攻撃/行動消費技/待機
  ▼
[acted=true] → 行動完了
```

### 実装に必要なstate:
- `origPos` — **最初の**移動前位置。noAction技使用時にnullにする（もう最初の位置に戻れない）
- `noActionPosRef` (useRef) — noAction技使用直後の位置。再移動後の「戻る」で使う
- `usedMovCostRef` (useRef) — 累積移動コスト
- `lastMoveCostRef` (useRef) — 最後の移動セグメントのコスト。「戻る」でこの分を巻き戻す

### handleCancel のルール:
1. `origPos`がある → 最初の移動を取り消す。clearSelection（通常キャンセル）
2. `origPos`がない + `mode==='action'` + `lastMoveCostRef > 0` → 再移動を取り消す。noActionPosRefの位置に戻す。usedMovCost巻き戻し。enterNoActionReselectで再移動画面へ
3. `origPos`がない + `mode==='targetAtk'/'targetHeal'` → アクションメニューに戻るだけ
4. それ以外 → 何もしない

### ActionMenuの「戻る」表示条件:
`canCancel={!!origPos || lastMoveCostRef.current > 0}`
- origPosがある = 通常移動後。戻れる
- lastMoveCost > 0 = noAction後に再移動した。再移動前に戻れる
- 両方ない = noAction直後で再移動してない。戻る先がない → 非表示

### 全escape pathのガード（handleCellClick / handleUnitClick）:
`!origPos && selId` の状態で空セルクリック/他ユニットクリックした時:
- mode==='select'（再移動中）: 範囲外クリックでアクションメニュー表示（移動しなかった）
- mode==='action': 何もしない（メニューからしか操作不可）
- mode==='targetAtk'/'targetHeal': アクションメニューに戻る

### pathfinding.js:
`bfs` / `getMovable` / `getPath` に `movOverride` 引数を追加。省略時は `unit.mov` を使う。
`getPathCost(path)` 関数を追加（パスの移動コスト合計）。

---

## FIX-3. 移動後の移動範囲表示の消え方がテンポ悪い

### ファイル: src/App.jsx — moveUnit関数

### 原因: 移動アニメーション中にmoveCellsが表示されたまま。アニメ開始時に即消すべき。

### 修正:
```js
async function moveUnit(u, tx, ty) {
  busyRef.current = true;
  setMoveCells([]);    // ← 移動開始時に即消す
  setPathCells([]);
  // ... 以降のアニメーション処理
}
```

---

## FIX-4. 配置フェーズでユニットがニュッと出てくるアニメ不要

### ファイル: src/ui/MapView.jsx — ユニット描画部分

### 原因: ユニットの position に `transition` が常時かかっている。配置フェーズで x:-1,y:-1 → 配置先に遷移するのでスライドする。

### 修正: phase が 'deploy' の時は transition を無効にする。
MapViewに `phase` は既にpropsで渡されているので:
```jsx
transition: phase === 'deploy' ? 'none' : `left ${STEP_MS}ms linear, top ${STEP_MS}ms linear`,
```

---

## FIX-5. 敵が複数同じマスに来る

### ファイル: src/App.jsx — handleEndTurn内の敵フェーズ

### 原因: `runEnemyPhase(updated)` が全敵の行動を**事前に一括計算**してから実行する。先に移動した敵の位置が後の敵の計算に反映されない。

### 修正方針: proto-10と同じく**1体ずつ計画→実行**を繰り返す。

runEnemyPhaseの一括計算をやめて、ループ内で1体ずつ `decideAction` を呼ぶ。

```js
// === 敵ターン ===
setPhase('enemy');
addLog('── 敵ターン ──', 'phase');
showBanner('ENEMY PHASE', '#ef4444', 1400);
await sleep(1400);

// 敵の行動順ソート
const enemyIds = aiSortEnemies(
  updated.filter(u => u.team === 'enemy' && u.hp > 0).map(u => u.id),
  updated
);

for (const eid of enemyIds) {
  const enemy = updated.find(u => u.id === eid);
  if (!enemy || enemy.hp <= 0) continue;

  // 1体ずつ計画（最新のupdatedを参照）
  const action = decideAction(enemy, updated);
  if (!action) continue;

  // 移動
  if (action.move) {
    const { x: mx, y: my } = action.move;
    if (mx !== enemy.x || my !== enemy.y) {
      enemy.x = mx;
      enemy.y = my;
      setUnits([...updated]);
      await sleep(STEP_MS * 3);
    }
  }

  // 攻撃
  if (action.target) {
    const target = updated.find(u => u.id === action.target.id && u.hp > 0);
    if (target) {
      const result = executeCombat(enemy, target, action.tech, updated);
      result.logs.forEach(l => addLog(l.text, l.type));
      for (const hit of result.hits) {
        shake(hit.uid);
        showPop(hit.uid, hit.dmg, hit.phase === 'counter' ? 'counter' : 'dmg');
        await sleep(350);
      }
      updated = result.units;
      setUnits([...updated]);
    }
  }
}
```

### ai.jsの変更:
`decideAction` をexportに追加（既にexportされているなら変更不要）。
`aiSortEnemies` もexportする。

### importの変更:
App.jsxで `runEnemyPhase` の代わりに `decideAction, aiSortEnemies` をimport。

---

## FIX-6. ステータスUIのテンポ改善

### ファイル: src/ui/StatusScreen.jsx

### 修正:
- アニメーション速度を上げる: `s-fin 0.15s` → `s-fin 0.1s`
- オーバーレイの背景フェードイン: 不要なら `animation` を外す

---

## FIX-7. フェーズバナー表示

### ファイル: src/App.jsx

### 原因: showBanner関数は存在するが、ターン開始・敵ターン開始でshowBannerが呼ばれていない。

### 修正箇所:

**handleDeployStart（配置完了→プレイヤーフェーズ開始）:**
```js
showBanner('PLAYER PHASE', '#3b82f6', 1200);
```

**handleEndTurn（敵フェーズ開始）:**
```js
showBanner('ENEMY PHASE', '#ef4444', 1400);
await sleep(1400);
```
※ FIX-5 で既に入れるべき箇所。

**handleEndTurn（次の自ターン開始）:**
```js
showBanner('PLAYER PHASE', '#3b82f6', 1200);
```

### バナーUIのスタイル改善:
proto-10のバナーは画面中央に大きく表示される。現在のMapView.jsxにbanner表示部分があるはず。そのスタイルを確認し、proto-10に近づける:
```jsx
{banner && (
  <div style={{
    position: 'absolute', top: '50%', left: '50%',
    transform: 'translate(-50%,-50%)', zIndex: 200,
    pointerEvents: 'none',
  }}>
    <div style={{
      background: banner.text?.includes('PLAYER')
        ? 'linear-gradient(90deg,transparent,rgba(37,99,235,0.7),rgba(37,99,235,0.7),transparent)'
        : 'linear-gradient(90deg,transparent,rgba(185,28,28,0.7),rgba(185,28,28,0.7),transparent)',
      padding: '18px 80px',
      animation: 's-ban 1.4s ease-in-out forwards',
    }}>
      <div style={{
        fontSize: 28, fontWeight: 900, color: '#fff',
        letterSpacing: 8,
        textShadow: '0 2px 12px rgba(0,0,0,0.5)',
      }}>{banner.text}</div>
    </div>
  </div>
)}
```

showBanner関数の修正:
```js
const showBanner = useCallback((text, color, ms = 1500) => {
  setBanner({ text, color });
  setTimeout(() => setBanner(null), ms);
}, []);
```

---

## FIX-8. index.htmlのbody中央配置

### ファイル: index.html

### 修正:
```html
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0e1e; overflow: hidden; display: flex; align-items: center; justify-content: center; height: 100vh; }
</style>
```

---

## 修正対象ファイル一覧

| ファイル | 修正内容 |
|----------|---------|
| index.html | body中央配置 |
| src/App.jsx | noAction全修正、敵フェーズ逐次実行、フェーズバナー、移動範囲即消し、ctxMenuOpen |
| src/ui/MapView.jsx | ツールチップ非表示条件、配置時transition無効 |
| src/ui/BattleUI.jsx | ActionMenuのcanCancel条件 |
| src/ui/StatusScreen.jsx | アニメ速度 |
| src/engine/pathfinding.js | movOverride引数、getPathCost追加 |
| src/engine/ai.js | decideAction/aiSortEnemiesをexport |

---

## 注意事項

- **noAction技の状態遷移図（FIX-2）は正として扱うこと。** 独自解釈で変えない。
- **敵フェーズは逐次実行（FIX-5）。** 一括計算してはいけない。
- **フェーズバナーのawait sleep（FIX-7）を忘れない。** バナー表示中は操作をブロックする。
- **修正後にnpm run devで実際にプレイして以下を確認:**
  1. 鉄壁の構え → 残りMOVで再移動できる → 攻撃/待機で行動完了
  2. 再移動後の「戻る」で再移動前に戻れる
  3. noAction直後のメニューに「戻る」がない
  4. 敵が同じマスに重ならない
  5. PLAYER PHASE / ENEMY PHASE バナーが表示される
  6. 右クリックメニュー表示中にツールチップが出ない
  7. 配置時にユニットがスライドしない

