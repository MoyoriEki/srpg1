# 追加バグ修正 v3a

> bugfix_spec_v3.md の FIX-1, FIX-2 への追加修正。

---

## FIX-2a. handleCancelの「戻る」で移動範囲が元位置基準になる

### ファイル: src/App.jsx — handleCancel内

### 原因:
L481-482で `setUnits(prev => ...)` でユニット位置をnoActionPosに戻しているが、
L487の `enterNoActionReselect(sel.id)` は第2引数なしで呼ぶため、
Reactの古いstate（移動先位置のまま）を参照してgetMovableが走る。
結果、移動範囲がnoActionPosではなく移動先を基準に計算される。

### 修正:
```js
} else if (mode === 'action' && lastMoveCostRef.current > 0 && noActionPosRef.current) {
  const pos = noActionPosRef.current;
  // updatedUnitsを直接作ってenterNoActionReselectに渡す
  const updatedUnits = units.map(u =>
    u.id === sel.id ? { ...u, x: pos.x, y: pos.y } : u
  );
  setUnits(updatedUnits);
  usedMovCostRef.current -= lastMoveCostRef.current;
  lastMoveCostRef.current = 0;
  setMenuPos(null);
  enterNoActionReselect(sel.id, updatedUnits);  // ← updatedUnitsを渡す
}
```

---

## FIX-1a. ツールチップがアクションメニュー/コンテキストメニューと被る

### ファイル: src/ui/MapView.jsx

### 原因:
ツールチップの表示条件にメニュー表示中の除外がない。

### 修正方針:
App.jsxから `menuOpen` prop を渡す。以下のいずれかがtrueならツールチップを非表示:
- ctxMenu が開いている
- mode === 'action'（アクションメニュー表示中）
- statScreen が開いている

**App.jsx側:**
```jsx
<MapView
  ...
  menuOpen={!!ctxMenu || mode === 'action' || !!statScreen}
/>
```

**MapView側:**
props に `menuOpen` を追加。ツールチップの表示条件:
```jsx
{(() => {
  if (!hoverCell || menuOpen) return null;
  ...
})()}
```

---

## FIX-1b. ツールチップの位置を旧プロトに合わせる

### 旧プロトの挙動（スクリーンショットから確認）:
- ユニットの**右横**に表示（ユニットチップの右側に8pxほど離して）
- 画面右端に近い場合は**左側に回り込む**
- 画面下端に近い場合は**上にずらす**

### 修正（MapView.jsx ツールチップ位置計算）:
```jsx
const ux = mapOX + cam.x + hu.x * TILE;
const uy = mapOY + cam.y + hu.y * TILE;
const tooltipW = 180;
const tooltipH = 80;

// 右に出すか左に出すか
const rightSpace = GW - (ux + TILE + 8);
const px = rightSpace >= tooltipW
  ? ux + TILE + 8          // 右に表示
  : ux - tooltipW - 8;     // 左に回り込む

// 下にはみ出すなら上にずらす
const py = Math.min(uy, GH - tooltipH - 8);
```

---

## 適用順

1. FIX-2a を先に適用（handleCancel修正）
2. FIX-1a, FIX-1b を合わせて適用（ツールチップ）

