// ═══ イベントシステム ═══
import { getMap, getZone, isInZone, getFlag, setFlag } from './map.js';
import { applyChangeAI } from './ai.js';

// ════════════════════════════════════════════
// checkEvents — 指定タイミングで発火条件を満たすイベントを収集
// ════════════════════════════════════════════

export function checkEvents(timing, context) {
  const map = getMap();
  if (!map?.events) return [];

  return map.events.filter(evt => {
    // once済みチェック
    if (evt.once && map._firedOnce?.[evt.id]) return false;
    // トリガー判定
    if (!matchTrigger(evt.trigger, timing, context)) return false;
    // 条件判定（AND結合）
    if (evt.conditions && evt.conditions.length > 0) {
      if (!evt.conditions.every(c => evalCondition(c, context))) return false;
    }
    return true;
  });
}

// ════════════════════════════════════════════
// executeEvent — イベントのアクション列を実行
// ════════════════════════════════════════════

export function executeEvent(evt, context) {
  const map = getMap();
  // once記録
  if (evt.once) {
    if (!map._firedOnce) map._firedOnce = {};
    map._firedOnce[evt.id] = true;
  }

  const result = {
    logs: [],
    spawned: [],
    despawned: [],
    dialogues: [],
    bgmChange: null,
    cameraMove: null,
    objectiveResult: null,
    terrainChanges: [],
  };

  for (const action of evt.actions) {
    executeAction(action, context, result);
  }

  return result;
}

// ════════════════════════════════════════════
// トリガー判定
// ════════════════════════════════════════════

function matchTrigger(trigger, timing, ctx) {
  if (!trigger) return false;

  switch (trigger.type) {
    case 'mapStart':
      return timing === 'mapStart';

    case 'turn':
      return timing === 'turn'
        && ctx.turn === trigger.turn
        && ctx.phase === (trigger.phase || 'enemy');

    case 'turnEnd':
      return timing === 'turnEnd'
        && ctx.turn === trigger.turn
        && ctx.phase === (trigger.phase || 'enemy');

    case 'defeat':
      return timing === 'defeat'
        && ctx.targetId === trigger.targetId;

    case 'defeatGroup':
      return timing === 'defeatGroup'
        && ctx.group === trigger.group;

    case 'defeatCount':
      return timing === 'defeatCount'
        && ctx.defeatCount >= (trigger.count || 1);

    case 'arrive': {
      if (timing !== 'arrive') return false;
      const zoneId = trigger.zoneId || '';
      const who = trigger.who || 'player';
      const zone = getZone(zoneId);
      if (zone.length === 0) return false;
      const checkUnits = who === 'player'
        ? (ctx.units || []).filter(u => u.team === 'player' && u.hp > 0)
        : (ctx.units || []).filter(u => u.hp > 0);
      return checkUnits.some(u => zone.some(c => c.x === u.x && c.y === u.y));
    }

    case 'hpBelow': {
      if (timing !== 'hpBelow') return false;
      const target = (ctx.units || []).find(u => u.id === trigger.targetId);
      if (!target || target.hp <= 0) return false;
      return (target.hp / target.maxHp * 100) <= (trigger.hpPct || 50);
    }

    case 'flag':
      return timing === 'flag'
        && String(getFlag(trigger.flag)) === String(trigger.value ?? 'true');

    case 'custom':
      return false; // 将来用

    default:
      return false;
  }
}

// ════════════════════════════════════════════
// 条件評価（AND結合）
// ════════════════════════════════════════════

function evalCondition(cond, ctx) {
  switch (cond.type) {
    case 'flag':
      return String(getFlag(cond.flag)) === String(cond.value ?? 'true');

    case 'probability': {
      let pct;
      if (cond.mode === 'statMult') {
        const target = cond.targetId
          ? (ctx.units || []).find(u => u.id === cond.targetId)
          : ctx.triggerUnit;
        const statVal = target ? (target[cond.stat] || 0) : 0;
        pct = statVal * (cond.mult || 1);
      } else {
        pct = cond.value ?? 50;
      }
      return Math.random() * 100 < pct;
    }

    case 'unitStat': {
      const target = (ctx.units || []).find(u => u.id === cond.targetId);
      if (!target) return false;
      const val = target[cond.stat] || 0;
      const cmpVal = cond.value || 0;
      return compareOp(val, cond.op || '>=', cmpVal);
    }

    case 'allyCount': {
      const count = (ctx.units || []).filter(u => u.team === 'player' && u.hp > 0).length;
      return compareOp(count, cond.op || '<=', cond.value ?? 0);
    }

    case 'enemyCount': {
      const count = (ctx.units || []).filter(u => u.team === 'enemy' && u.hp > 0).length;
      return compareOp(count, cond.op || '<=', cond.value ?? 0);
    }

    case 'unitAlive':
      return (ctx.units || []).some(u => u.id === cond.targetId && u.hp > 0);

    case 'unitDead':
      return !(ctx.units || []).some(u => u.id === cond.targetId && u.hp > 0);

    default:
      return true; // 未知の条件は通す
  }
}

function compareOp(val, op, target) {
  switch (op) {
    case '<=': return val <= target;
    case '>=': return val >= target;
    case '<':  return val < target;
    case '>':  return val > target;
    case '==': return val === target;
    case '!=': return val !== target;
    default: return false;
  }
}

// ════════════════════════════════════════════
// アクション実行
// ════════════════════════════════════════════

function executeAction(action, ctx, result) {
  switch (action.type) {
    case 'spawn': {
      const spawned = (action.units || []).map(u => ({
        template: u.template,
        x: u.x, y: u.y,
        ai: u.ai || (u.behavior ? undefined : { movement: 'rush', action: 'attack' }),
        behavior: u.behavior, // 旧互換用
        level: u.level || 1,
        overrides: u.overrides || {},
        group: Array.isArray(u.group) ? u.group : u.group ? [u.group] : [],
        isMinion: u.minion !== false, // デフォルトtrue（増援はミニオン扱い）
      }));
      result.spawned.push(...spawned);
      result.logs.push({ text: `増援が出現した！(${spawned.length}体)`, type: 'warning' });
      break;
    }

    case 'despawn': {
      const ids = action.targetIds || [];
      result.despawned.push(...ids);
      result.logs.push({ text: `ユニットが消滅した (${ids.join(',')})`, type: 'info' });
      break;
    }

    case 'dialogue': {
      result.dialogues.push(...(action.lines || []));
      break;
    }

    case 'terrainChange': {
      const map = getMap();
      (action.cells || []).forEach(cell => {
        if (map.terrain[cell.y]) {
          map.terrain[cell.y][cell.x] = cell.terrainId;
        }
      });
      result.terrainChanges.push(...(action.cells || []));
      result.logs.push({ text: `地形が変化した`, type: 'info' });
      break;
    }

    case 'objective': {
      result.objectiveResult = action.result || 'win';
      break;
    }

    case 'setFlag': {
      setFlag(action.flag, action.value ?? 'true');
      result.logs.push({ text: `フラグ: ${action.flag} = ${action.value}`, type: 'info' });
      break;
    }

    case 'bgm': {
      result.bgmChange = {
        track: action.track || '',
        priority: action.priority || false,
        fade: action.fade || 0,
        resume: action.resume || false,
      };
      break;
    }

    case 'camera': {
      result.cameraMove = {
        x: action.x || 0,
        y: action.y || 0,
        duration: action.duration || 500,
      };
      break;
    }

    case 'changeAI': {
      const units = ctx.units || [];
      applyChangeAI(action.target, action.ai, units);
      const label = action.ai === null ? 'AIリセット' : 'AI変更';
      result.logs.push({ text: `${label}: ${action.target}`, type: 'info' });
      break;
    }
  }
}
