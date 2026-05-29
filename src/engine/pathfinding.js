// ═══ 移動範囲・攻撃範囲・経路探索 ═══
import { getCols, getRows, getMoveCost, isImpassable, getPassability } from './map.js';
import { STATUS_COUNTERS } from './constants.js';

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function getAdj(x, y) {
  return [{ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 }];
}

// BFS移動範囲
export function bfs(unit, units, movOverride, opts) {
  const COLS = getCols(), ROWS = getRows();
  const movLimit = movOverride !== undefined ? movOverride : unit.mov;
  const ignoreSameTeam = opts?.ignoreSameTeam || false;
  const isBound = unit._counters && (STATUS_COUNTERS['移動不能'] || []).some(n => (unit._counters[n] || 0) > 0);
  if (isBound) {
    return { cells: [{ x: unit.x, y: unit.y }], parent: { [`${unit.x},${unit.y}`]: null }, costs: { [`${unit.x},${unit.y}`]: 0 } };
  }
  const alive = units.filter(u => u.hp > 0);
  const key = (x, y) => `${x},${y}`;
  const costs = {}, parent = {};
  costs[key(unit.x, unit.y)] = 0;
  parent[key(unit.x, unit.y)] = null;
  const cells = [];
  const queue = [{ x: unit.x, y: unit.y, cost: 0 }];

  const hasGhost = hasEffectType(unit, 'ghostMove');

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const { x, y, cost } = queue.shift();
    const k = key(x, y);
    if (cost > costs[k]) continue;
    // 停止可能判定: 同チーム無視モードでは同チームユニットのいるマスも候補
    const occupant = alive.find(u => u.x === x && u.y === y && u.id !== unit.id);
    if (!occupant || (ignoreSameTeam && occupant.team === unit.team)) {
      cells.push({ x, y });
    }

    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      // 飛行対応: impassableは飛行でも不可、flyOnlyは飛行のみ通過可
      const pass = getPassability(nx, ny);
      if (pass === 'impassable') continue;
      if (pass === 'flyOnly' && unit.moveType !== 'fly') continue;
      const mc = unit.moveType === 'fly' ? 1 : getMoveCost(nx, ny);
      const nc = cost + mc;
      if (nc > movLimit) continue;
      // 敵ユニットは通れない（透明マント持ちは通れる）。同チーム無視モードでは同チームは通過可能
      const blocker = alive.find(u => u.x === nx && u.y === ny && u.team !== unit.team);
      if (blocker && !hasGhost) continue;
      const nk = key(nx, ny);
      if (costs[nk] === undefined || nc < costs[nk]) {
        costs[nk] = nc;
        parent[nk] = k;
        queue.push({ x: nx, y: ny, cost: nc });
      }
    }
  }
  return { cells, parent, costs };
}

export function getMovable(unit, units, movOverride, opts) {
  return bfs(unit, units, movOverride, opts).cells;
}

export function getPath(unit, tx, ty, units, movOverride, opts) {
  const { parent } = bfs(unit, units, movOverride, opts);
  const key = (x, y) => `${x},${y}`;
  const tk = key(tx, ty);
  if (parent[tk] === undefined && (tx !== unit.x || ty !== unit.y)) return [];
  const path = [];
  let cur = tk;
  while (cur && cur !== key(unit.x, unit.y)) {
    const [x, y] = cur.split(',').map(Number);
    path.unshift({ x, y });
    cur = parent[cur];
  }
  return path;
}

// 経路の移動コスト合計を算出
export function getPathCost(path) {
  let cost = 0;
  for (const step of path) {
    cost += getMoveCost(step.x, step.y);
  }
  return cost;
}

// 攻撃可能セル
export function getAtkCells(x, y, rMin, rMax) {
  // 射程0 = 自分自身が対象（自己対象技）
  if (rMin === 0 && rMax === 0) return [{ x, y }];
  if (rMax <= 0) return [];
  const COLS = getCols(), ROWS = getRows();
  const cells = [];
  for (let cx = 0; cx < COLS; cx++) {
    for (let cy = 0; cy < ROWS; cy++) {
      const d = Math.abs(cx - x) + Math.abs(cy - y);
      if (d >= rMin && d <= rMax) cells.push({ x: cx, y: cy });
    }
  }
  return cells;
}

// 技の実効射程を計算
export function getTechRange(tech, unit) {
  if (tech.rangeType === 'intDiv' && tech.rangeDivisor) {
    const intVal = unit.int || 0;
    const r = Math.max(1, Math.floor(intVal / tech.rangeDivisor));
    return { min: 1, max: r };
  }
  // rangeMin/rangeMaxが明示的に0なら0を返す（自己対象技）
  return {
    min: tech.rangeMin !== undefined ? tech.rangeMin : 1,
    max: tech.rangeMax !== undefined ? tech.rangeMax : 1
  };
}

export function getTechAtkCells(x, y, tech, unit) {
  const range = getTechRange(tech, unit);
  return getAtkCells(x, y, range.min, range.max);
}

// AoE方向パターン
export const DIRS = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];

export function getAoeCells(ax, ay, aoeType, dir) {
  const { dx, dy } = dir;
  const c1 = { x: ax + dx, y: ay + dy };
  const c2 = { x: ax + dx * 2, y: ay + dy * 2 };
  if (aoeType === 'dir_line') return [c1, c2];
  if (aoeType === 'dir_cross') {
    const px = Math.abs(dy), py = Math.abs(dx);
    return [c1, c2,
      { x: c1.x + px, y: c1.y + py }, { x: c1.x - px, y: c1.y - py },
      { x: c2.x + px, y: c2.y + py }, { x: c2.x - px, y: c2.y - py }];
  }
  return [];
}

export function getAllAoeCells(ax, ay, aoeType) {
  const COLS = getCols(), ROWS = getRows();
  const all = [];
  for (const d of DIRS) {
    for (const c of getAoeCells(ax, ay, aoeType, d)) {
      if (c.x >= 0 && c.x < COLS && c.y >= 0 && c.y < ROWS && !all.some(a => a.x === c.x && a.y === c.y)) all.push(c);
    }
  }
  return all;
}

export function cellToDir(ax, ay, cx, cy) {
  for (const d of DIRS) {
    const cells = getAoeCells(ax, ay, 'dir_cross', d);
    if (cells.some(c => c.x === cx && c.y === cy)) return d;
  }
  return null;
}

// ユーティリティ: スキル/特性のeffectsからタイプチェック（循環依存回避のためここに置く）
function hasEffectType(unit, type) {
  for (const skill of (unit.skills || [])) {
    if ((skill.effects || []).some(e => e.type === type)) return true;
  }
  return false;
}

// ── 射程2遮蔽判定 ──
// 攻撃者(ax,ay)からターゲット(tx,ty)への射程2攻撃が、
// 味方の遮蔽スキル持ちによってブロックされるか
export function isRangeShielded(ax, ay, tx, ty, units, targetTeam) {
  // 距離2の直線攻撃のみ対象
  const dist = Math.abs(ax - tx) + Math.abs(ay - ty);
  if (dist !== 2) return false;
  // 縦or横の一直線のみ（斜めは対象外）
  if (ax !== tx && ay !== ty) return false;
  // 中間マス
  const sx = (ax + tx) / 2, sy = (ay + ty) / 2;
  // そこに遮蔽スキル持ちの味方がいるか
  return units.some(u =>
    u.hp > 0 && u.team === targetTeam &&
    u.x === sx && u.y === sy &&
    hasEffectType(u, 'rangeShield')
  );
}

// 指定セルが遮蔽で守られているか（赤セル除外用）
// 敵の全移動先×射程2攻撃で、このセルへの全攻撃がブロックされるか判定
export function isCellShielded(cx, cy, enemyMoveCells, enemy, units) {
  // このセルに攻撃できる移動先が1つでもあれば赤セル維持
  // 全移動先からの射程2直線攻撃がすべてブロックされる場合のみ除外
  const team = 'player'; // 遮蔽は味方チーム
  let canAttackCount = 0;
  let blockedCount = 0;
  for (const mc of enemyMoveCells) {
    const d = Math.abs(mc.x - cx) + Math.abs(mc.y - cy);
    if (d < enemy.rangeMin || d > enemy.rangeMax) continue;
    canAttackCount++;
    if (d === 2 && (mc.x === cx || mc.y === cy)) {
      // 直線距離2 → 遮蔽チェック
      if (isRangeShielded(mc.x, mc.y, cx, cy, units, team)) {
        blockedCount++;
      }
    }
  }
  // 攻撃可能な移動先があり、かつ全部ブロックされてる場合のみ遮蔽
  return canAttackCount > 0 && canAttackCount === blockedCount;
}

export function fmtRange(rMin, rMax) {
  if (rMax <= 0) return '−';
  return rMin === rMax ? `${rMin}` : `${rMin}〜${rMax}`;
}

/**
 * targetから全セルへの最短距離マップを返す（壁・地形コスト考慮）
 * AI用: ユニット衝突は無視、純粋な地形距離のみ
 */
export function bfsDistanceMap(targetX, targetY, moveType) {
  const COLS = getCols(), ROWS = getRows();
  const key = (x, y) => `${x},${y}`;
  const dist = {};
  dist[key(targetX, targetY)] = 0;
  const queue = [{ x: targetX, y: targetY, cost: 0 }];

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const { x, y, cost } = queue.shift();
    const k = key(x, y);
    if (cost > (dist[k] ?? Infinity)) continue;

    for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      const pass = getPassability(nx, ny);
      if (pass === 'impassable') continue;
      if (pass === 'flyOnly' && moveType !== 'fly') continue;
      const mc = moveType === 'fly' ? 1 : getMoveCost(nx, ny);
      const nc = cost + mc;
      const nk = key(nx, ny);
      if (dist[nk] === undefined || nc < dist[nk]) {
        dist[nk] = nc;
        queue.push({ x: nx, y: ny, cost: nc });
      }
    }
  }
  return dist;
}
