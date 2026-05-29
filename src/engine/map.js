// ═══ マップ管理 ═══
import terrainsData from '../data/terrains.json';
import itemsData from '../data/items.json';

let currentMap = null;
let terrainLookup = {};

// 地形テーブル初期化
for (const t of terrainsData) {
  terrainLookup[t.id] = t;
}

export function loadMap(mapJson) {
  currentMap = mapJson;

  // 旧形式互換: arriveZone → zones移行
  if (currentMap.objective?.type === 'arrive' && currentMap.objective.arriveZone && !currentMap.zones) {
    currentMap.zones = { arrive_default: currentMap.objective.arriveZone };
    currentMap.objective.zoneId = 'arrive_default';
    delete currentMap.objective.arriveZone;
  }
  // 旧形式互換: itemLootTable → lootTables移行
  if (currentMap.itemLootTable && !currentMap.lootTables) {
    currentMap.lootTables = [{ id: 'default', name: 'デフォルト', spawnRate: 100, maxUses: 0, entries: currentMap.itemLootTable }];
    delete currentMap.itemLootTable;
  }
  // 旧形式互換: condition → conditions移行
  if (currentMap.events) {
    currentMap.events = currentMap.events.map(e => {
      if (e.condition && !e.conditions) {
        return { ...e, conditions: [e.condition], condition: undefined };
      }
      return e;
    });
  }

  // lootTableの残り回数トラッキング用
  if (currentMap.lootTables) {
    currentMap._lootUses = {};
    currentMap.lootTables.forEach(lt => {
      if (lt.maxUses > 0) currentMap._lootUses[lt.id] = lt.maxUses;
    });
  }

  // フラグ管理用
  currentMap._flags = {};
  // イベント発火済み管理
  currentMap._firedOnce = {};

  return currentMap;
}

export function getMap() { return currentMap; }
export function getCols() { return currentMap?.cols || 20; }
export function getRows() { return currentMap?.rows || 15; }

export function getTerrain(x, y) {
  if (!currentMap) return terrainLookup[0];
  const id = currentMap.terrain[y]?.[x];
  return terrainLookup[id] || terrainLookup[0];
}

// 通行可否 3段階（新pass > 旧impassable互換）
export function getPassability(x, y) {
  const t = getTerrain(x, y);
  if (t.pass) return t.pass; // 新形式
  if (t.impassable) return 'impassable'; // 旧互換
  return 'passable';
}

// ステ補正拡張（新mods > 旧def互換）
export function getTerrainMod(x, y, stat) {
  const t = getTerrain(x, y);
  if (t.mods?.[stat] !== undefined) return t.mods[stat];
  if (stat === 'def') return t.def || 0; // 旧互換
  return 0;
}

// 旧API互換エイリアス
export function getTerrainDef(x, y) {
  return getTerrainMod(x, y, 'def');
}

export function getMoveCost(x, y) {
  return getTerrain(x, y).moveCost || 1;
}

export function isImpassable(x, y) {
  return getPassability(x, y) === 'impassable';
}

// 地形効果 onStay
export function getOnStayEffects(x, y) {
  return getTerrain(x, y).onStay || [];
}

export function getTerrainColor(id) {
  return terrainLookup[id]?.color || '#4a7c34';
}

export function getTerrainName(id) {
  return terrainLookup[id]?.name || '平地';
}

export function getDeployZone() {
  return currentMap?.deployZone || [];
}

export function getItemBoxes() {
  return currentMap?.itemBoxes || [];
}

// タイルオーバーレイ
export function getTilesets() {
  if (!currentMap) return [];
  // New format: tilesets array
  if (currentMap.tilesets) return currentMap.tilesets;
  // Old format: single tileset → array
  if (currentMap.tileset) return [currentMap.tileset];
  return [];
}

export function getTileOverlay() {
  if (!currentMap?.tileOverlay) return null;
  // Ensure 4-layer format
  if (Array.isArray(currentMap.tileOverlay[0]?.[0])) return currentMap.tileOverlay;
  // Old single-layer → wrap in 4-layer (pad with empty)
  const nr = currentMap.rows || 15, nc = currentMap.cols || 20;
  const empty = Array.from({ length: nr }, () => Array(nc).fill(0));
  return [currentMap.tileOverlay, empty, empty, empty];
}

// アイテムボックスから拾う（破壊的操作）
export function pickupItemBox(x, y) {
  if (!currentMap?.itemBoxes) return null;
  const idx = currentMap.itemBoxes.findIndex(b => b.x === x && b.y === y);
  if (idx < 0) return null;
  const box = currentMap.itemBoxes[idx];

  // 旧形式: box.itemが直接ある場合はそのまま返す
  if (box.item) {
    currentMap.itemBoxes.splice(idx, 1);
    return box.item;
  }

  // 新形式: lootTableから抽選
  const tableId = box.tableId || '';
  const table = (currentMap.lootTables || []).find(lt => lt.id === tableId);
  if (!table || table.entries.length === 0) {
    currentMap.itemBoxes.splice(idx, 1);
    return null;
  }

  // spawnRate判定
  const spawnRate = table.spawnRate ?? 100;
  if (Math.random() * 100 >= spawnRate) {
    currentMap.itemBoxes.splice(idx, 1);
    return null;
  }

  // maxUses判定
  if (table.maxUses > 0) {
    const remaining = currentMap._lootUses?.[tableId];
    if (remaining !== undefined && remaining <= 0) {
      currentMap.itemBoxes.splice(idx, 1);
      return null;
    }
    if (currentMap._lootUses) currentMap._lootUses[tableId]--;
  }

  // 重み付き抽選
  const totalWeight = table.entries.reduce((s, e) => s + e.weight, 0);
  let roll = Math.random() * totalWeight;
  let selectedItemId = table.entries[0].itemId;
  for (const entry of table.entries) {
    roll -= entry.weight;
    if (roll <= 0) { selectedItemId = entry.itemId; break; }
  }

  const item = itemsData.find(i => i.id === selectedItemId);
  currentMap.itemBoxes.splice(idx, 1);
  return item ? { ...item } : null;
}

// 敵がアイテムボックス上にいるか判定
export function destroyItemBoxAt(x, y) {
  if (!currentMap?.itemBoxes) return false;
  const idx = currentMap.itemBoxes.findIndex(b => b.x === x && b.y === y);
  if (idx < 0) return false;
  currentMap.itemBoxes.splice(idx, 1);
  return true;
}

// ゾーン関連ヘルパー
export function getZone(zoneId) {
  return currentMap?.zones?.[zoneId] || [];
}

export function isInZone(zoneId, x, y) {
  const zone = getZone(zoneId);
  return zone.some(c => c.x === x && c.y === y);
}

// フラグ管理
export function getFlag(name) {
  return currentMap?._flags?.[name];
}

export function setFlag(name, value) {
  if (!currentMap) return;
  if (!currentMap._flags) currentMap._flags = {};
  currentMap._flags[name] = value;
}

// 敵ターン終了時: 敵が踏んでいるアイテムボックスを一括消去
// units: 全ユニット配列。戻り値: 破壊されたbox配列
export function destroyItemBoxesByEnemies(units) {
  if (!currentMap?.itemBoxes) return [];
  const aliveEnemies = units.filter(u => u.team === 'enemy' && u.hp > 0);
  const destroyed = [];
  currentMap.itemBoxes = currentMap.itemBoxes.filter(box => {
    if (aliveEnemies.some(e => e.x === box.x && e.y === box.y)) {
      destroyed.push(box);
      return false;
    }
    return true;
  });
  return destroyed;
}

export { terrainsData };
