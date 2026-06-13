import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  TILE, GW, GH, STEP_MS, NUM_STAGES, PARTY_MAX,
  INITIAL_SORTIE, HP_RECOVERY_PCT, LEVEL_CAP, COUNTER_DEFS,
  MAP_ZOOM_MOBILE,
} from './engine/constants.js';
import {
  createRoster, createEnemiesFromMap, createEnemyUnit, createMinion, resetUid,
  effectiveAtk, effectiveDef, effectiveInt, getATK, getSlots,
} from './engine/units.js';
import {
  calcDamage, calcPursuit, executeCombat, executeHeal, canUseTech,
} from './engine/combat.js';
import {
  bfs, getMovable, getPath, getAtkCells, getTechRange, getTechAtkCells,
  manhattan, fmtRange, getPathCost, isRangeShielded,
} from './engine/pathfinding.js';
import { loadMap, getMap, getCols, getRows, getDeployZone, getTerrainDef, pickupItemBox, destroyItemBoxesByEnemies, isInZone, getOnStayEffects } from './engine/map.js';
import { checkEvents, executeEvent } from './engine/events.js';
import { decideAction, aiSortEnemies } from './engine/ai.js';
import { awardExp, applyLevelUp, canLevelUp, expNext } from './engine/levelup.js';
import { rollParts, applyPart, swapPart } from './engine/draft.js';
import { getCCOptions, applyCC } from './engine/classChange.js';
import { dispatchTurnStart, getTrait, dispatchTurnEnd, getTraitEffects, applyCounterGen } from './engine/skills.js';
import { isStunned, calcCounterHit } from './engine/debuff.js';
import { playBGM, stopBGM } from './engine/audio.js';
import itemsData from './data/items.json';

import ScreenScaler from './ui/ScreenScaler.jsx';
import useMapZoom from './ui/useMapZoom.js';
import SettingsPanel from './ui/SettingsPanel.jsx';
import ZoomToggle from './ui/ZoomToggle.jsx';
import MapView from './ui/MapView.jsx';
import LogPanel from './ui/LogPanel.jsx';
import { ActionMenu, BattlePreview, ContextMenu } from './ui/BattleUI.jsx';
import DraftUI from './ui/DraftUI.jsx';
import DeployUI from './ui/DeployUI.jsx';
import IntervalUI from './ui/IntervalUI.jsx';
import StatusScreen from './ui/StatusScreen.jsx';
import RecruitUI from './ui/RecruitUI.jsx';

import mapM1 from './maps/m1.json';
import mapM2 from './maps/m2.json';

// ─── お祭りテスト（デバッグ編成投入口・使い捨て） ───
import { buildFestivalUnits } from './debug/festival.js';
import festivalMap from './maps/festival.json';

// 6ステージ分のマップ配列（M3-M6は暫定でM1/M2を使い回し）
const STAGE_MAPS = [mapM1, mapM2, mapM1, mapM2, mapM1, mapM2];

// お祭りテスト起動判定: URL に ?festival / ?fest、または window.__festival=true
const FESTIVAL_MODE = typeof window !== 'undefined' && (() => {
  try {
    const q = new URLSearchParams(window.location.search);
    return q.has('festival') || q.has('fest') || window.__festival === true;
  } catch { return false; }
})();

// ════════════════════════════════════════════
// sleep helper
// ════════════════════════════════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ════════════════════════════════════════════
// App
// ════════════════════════════════════════════
export default function App() {
  // --- ゲーム状態 ---
  const [stage, setStage]         = useState(0);
  const [phase, setPhase]         = useState('deploy'); // deploy | player | enemy | stageClear | interval
  const [turn, setTurn]           = useState(1);
  const [units, setUnits]         = useState([]);
  const [roster, setRoster]       = useState([]); // 味方全員（配置前）
  const [log, setLog]             = useState([]);
  const [gameOver, setGameOver]   = useState(null); // null | 'stageClear' | 'defeat' | 'loopClear'

  // --- 選択・UI ---
  const [selId, setSelId]         = useState(null);
  const [mode, setMode]           = useState('select'); // select | moved | action | targetAtk | targetHeal
  const [origPos, setOrigPos]     = useState(null);
  const [moveCells, setMoveCells] = useState([]);
  const [atkCells, setAtkCells]   = useState([]);
  const [healCells, setHealCells] = useState([]);
  const [pathCells, setPathCells] = useState([]);
  const [chosenTech, setChosenTech] = useState(null);
  const [menuPos, setMenuPos]     = useState(null);
  const [hoverCell, setHoverCell] = useState(null);
  const [ctxMenu, setCtxMenu]     = useState(null);
  const [enemyRanges, setEnemyRanges] = useState([]);
  const [rangeEnemyIds, setRangeEnemyIds] = useState([]);

  // --- マップ表示倍率（A:等倍=従来PC / B:今回追加した倍率）---
  const autoZoom = useMapZoom();             // 画面サイズによる自動判定
  const [zoomManual, setZoomManual] = useState(null); // null=自動、それ以外は手動指定
  const mapZoom = zoomManual ?? autoZoom;
  const toggleZoom = () => setZoomManual(mapZoom === MAP_ZOOM_MOBILE ? 1 : MAP_ZOOM_MOBILE);

  // --- アニメーション ---
  const [dmgPops, setDmgPops]     = useState([]);
  const [shaking, setShaking]     = useState({});
  const [banner, setBanner]       = useState(null);

  // --- モーダル ---
  const [statScreen, setStatScreen] = useState(null);
  const [pendingLvUp, setPendingLvUp] = useState(null);
  // { unit, gains, parts, ccOptions }

  // --- 配置 ---
  const [deploySelId, setDeploySelId] = useState(null);

  // --- CC（インターバル） ---
  const [ccQueue, setCcQueue]     = useState([]); // CC対象ユニットIDの配列
  const [ccCurrent, setCcCurrent] = useState(null); // { unit, ccOptions, draftParts }
  // CC対象ステージ: stage=1(M2後)→中級, stage=3(M4後)→上級
  const CC_STAGES = { 1: 'mid', 3: 'adv' };

  // --- 合流 ---
  const [fullPool, setFullPool]         = useState([]);
  const [recruitPhase, setRecruitPhase] = useState(null);
  // { candidates: Unit[], picked: string[] }

  // --- busy ---
  const busyRef = useRef(false);
  const popKeyRef = useRef(0);
  const rootRef = useRef(null);
  const mapApiRef = useRef(null);    // MapViewが公開するセル→画面座標API
  const usedMovCostRef = useRef(0);  // noAction再移動用: 累積移動コスト
  const noActionPosRef = useRef(null); // noAction再移動前の位置
  const lastMoveCostRef = useRef(0);  // 最後の移動セグメントのコスト

  // ════════════════════════════════════════════
  // アクションメニュー位置（マップ拡大/パンを加味してユニット右脇に出す）
  // ════════════════════════════════════════════
  function menuAnchorFor(cx, cy) {
    const a = mapApiRef.current?.cellMenuAnchor?.(cx, cy);
    const base = a || { x: (cx + 1) * TILE + 168, y: cy * TILE + 8 };
    return {
      x: Math.max(4, Math.min(base.x, GW - 300)),
      y: Math.max(4, Math.min(base.y, GH - 220)),
    };
  }

  // ════════════════════════════════════════════
  // ログ追加
  // ════════════════════════════════════════════
  const addLog = useCallback((text, type = 'info') => {
    setLog(prev => [...prev, { text, type }]);
  }, []);

  // ════════════════════════════════════════════
  // ダメージポップ
  // ════════════════════════════════════════════
  const showPop = useCallback((uid, val, type = 'dmg') => {
    const key = ++popKeyRef.current;
    setDmgPops(prev => [...prev, { uid, val, type, key }]);
    setTimeout(() => setDmgPops(prev => prev.filter(p => p.key !== key)), 1000);
  }, []);

  const shake = useCallback((uid) => {
    setShaking(prev => ({ ...prev, [uid]: true }));
    setTimeout(() => setShaking(prev => ({ ...prev, [uid]: false })), 450);
  }, []);

  const showBanner = useCallback((text, color, ms = 1500) => {
    setBanner({ text, color });
    setTimeout(() => setBanner(null), ms);
  }, []);

  // ════════════════════════════════════════════
  // ゲーム初期化
  // ════════════════════════════════════════════
  useEffect(() => {
    resetUid(0);
    // お祭りテスト: ドラフト/CC/配置をスキップして育成済み8体を直置き
    if (FESTIVAL_MODE) {
      const festUnits = buildFestivalUnits();
      setFullPool(festUnits);
      setRoster(festUnits);
      startFestivalStage(festUnits);
      return;
    }
    const allRoster = createRoster(); // 13人全員
    setFullPool(allRoster);
    const shuffled = [...allRoster].sort(() => Math.random() - 0.5);
    const initial = shuffled.slice(0, INITIAL_SORTIE); // 6人
    setRoster(initial);
    initStage(0, initial);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // マーキング自動再計算（敵死亡時など）
  useEffect(() => {
    if (rangeEnemyIds.length > 0) recalcRanges(rangeEnemyIds, units);
  }, [units]); // eslint-disable-line react-hooks/exhaustive-deps

  // ═══ デバッグ用コンソールAPI ═══
  const debugRef = useRef({});
  debugRef.current.units = units;
  debugRef.current.roster = roster;
  debugRef.current.handleLevelUp = handleLevelUp;
  debugRef.current.setUnits = setUnits;
  debugRef.current.setRoster = setRoster;
  debugRef.current.setFullPool = setFullPool;
  debugRef.current.startFestivalStage = startFestivalStage;
  if (!window.__debug) {
    window.__debug = {
      get units() { return debugRef.current.units; },
      get roster() { return debugRef.current.roster; },
      async levelUp(unitId) {
        const u = debugRef.current.units.find(u => u.id === unitId);
        if (!u) { console.error('ユニットが見つからない:', unitId); return; }
        const newUnit = await debugRef.current.handleLevelUp(u);
        debugRef.current.setUnits(prev => prev.map(x => x.id === newUnit.id ? newUnit : x));
        debugRef.current.setRoster(prev => prev.map(x => x.id === newUnit.id ? newUnit : x));
        console.log('レベルアップ完了:', newUnit.name, 'Lv', newUnit.level);
      },
      // お祭りテスト面を即起動（?festival を付けなくても呼べる）
      festival() {
        const festUnits = buildFestivalUnits();
        debugRef.current.setFullPool(festUnits);
        debugRef.current.setRoster(festUnits);
        debugRef.current.startFestivalStage(festUnits);
        console.log('お祭りテスト面を開始:', festUnits.map(u => `${u.name}(${u.cls})`).join(', '));
      },
    };
    console.log('__debug 有効: __debug.levelUp("p0"), __debug.festival(), __debug.units');
  }

  function initStage(stageIdx, currentRoster) {
    const mapData = STAGE_MAPS[stageIdx] || mapM1;
    loadMap(mapData);

    const enemies = createEnemiesFromMap(mapData);
    // リセットプレイヤーユニットのacted/deployed
    const players = (currentRoster || roster).map(u => ({
      ...u, acted: false, deployed: false, x: -1, y: -1,
    }));

    setUnits([...players, ...enemies]);
    setPhase('deploy');
    setTurn(1);
    setGameOver(null);
    setLog([{ text: `── ステージ ${stageIdx + 1} 開始 ──`, type: 'phase' }]);
    clearSelection();
    const bgm = mapData.bgm || {};
    playBGM(bgm.default || 'map');
  }

  // ════════════════════════════════════════════
  // お祭りテスト: 育成済み8体を直置きして即 player フェーズ
  // （配置フェーズもスキップ。使い捨て・ボツ時はこの関数ごと削除）
  // ════════════════════════════════════════════
  function startFestivalStage(festRoster) {
    loadMap(festivalMap);
    const enemies = createEnemiesFromMap(festivalMap);
    const dz = getDeployZone();
    // デプロイゾーン先頭から順に直置き
    const placed = festRoster.map((u, i) => {
      const cell = dz[i] || dz[dz.length - 1] || { x: 1, y: 1 };
      return { ...u, x: cell.x, y: cell.y, deployed: true, acted: false };
    });
    let all = [...placed, ...enemies];
    // mapStartイベント（敵チャージ即発動など本番同様）
    all = fireEvents('mapStart', { units: all }, all);
    setUnits(all);
    setStage(NUM_STAGES - 1); // クリア後は次面に進まずループクリア扱い
    setTurn(1);
    setGameOver(null);
    setPhase('player');
    setLog([{ text: '── お祭りテスト面 開始（デバッグ編成・運排除） ──', type: 'phase' }]);
    clearSelection();
    playBGM(festivalMap.bgm?.default || 'map');
    showBanner('FESTIVAL', '#f59e0b', 1400);
    // ターン開始スキル
    all.filter(u => u.team === 'player' && u.hp > 0).forEach(u => dispatchTurnStart(u, all, []));
  }

  // ════════════════════════════════════════════
  // イベント結果処理
  // ════════════════════════════════════════════
  function processEventResult(result, currentUnits) {
    result.logs.forEach(l => addLog(l.text, l.type));

    let updated = [...currentUnits];

    // 増援出現
    if (result.spawned.length > 0) {
      const newEnemies = result.spawned
        .map(spec => createEnemyUnit(spec.template, spec.x, spec.y, {
          level: spec.level,
          ai: spec.ai,
          ...spec.overrides,
        }))
        .filter(Boolean);
      // 新形式フィールドをセット
      result.spawned.forEach((spec, i) => {
        if (newEnemies[i]) {
          newEnemies[i].group = spec.group || [];
          newEnemies[i].isMinion = spec.isMinion !== false;
          if (spec.behavior) newEnemies[i].behavior = spec.behavior;
        }
      });
      updated = [...updated, ...newEnemies];
    }

    // ユニット消滅
    if (result.despawned.length > 0) {
      updated = updated.filter(u => !result.despawned.includes(u.id));
    }

    // BGM再生
    if (result.bgmChange) {
      const { track, fade } = result.bgmChange;
      if (track) playBGM(track, { fade });
      else       stopBGM({ fade });
    }

    // 勝敗判定
    if (result.objectiveResult === 'win') {
      setGameOver('stageClear');
    } else if (result.objectiveResult === 'lose') {
      setGameOver('defeat');
    }

    return updated;
  }

  // イベントチェック＋実行（共通ヘルパー）
  function fireEvents(timing, context, currentUnits) {
    const evts = checkEvents(timing, context);
    let updated = currentUnits;
    for (const evt of evts) {
      const result = executeEvent(evt, { ...context, units: updated });
      updated = processEventResult(result, updated);
    }
    return updated;
  }

  // ════════════════════════════════════════════
  // 選択クリア
  // ════════════════════════════════════════════
  function clearSelection() {
    setSelId(null);
    setMode('select');
    setOrigPos(null);
    setMoveCells([]);
    setAtkCells([]);
    setHealCells([]);
    setPathCells([]);
    setChosenTech(null);
    setMenuPos(null);
    setCtxMenu(null);
    usedMovCostRef.current = 0;
    noActionPosRef.current = null;
    lastMoveCostRef.current = 0;
  }

  // ════════════════════════════════════════════
  // 配置フェーズ
  // ════════════════════════════════════════════
  function handleDeploySelect(uid) {
    setDeploySelId(prev => prev === uid ? null : uid);
  }

  function handleDeployCellClick(cx, cy) {
    if (phase !== 'deploy') return;
    const dz = getDeployZone();
    if (!dz.some(c => c.x === cx && c.y === cy)) return;

    if (deploySelId) {
      // 配置実行
      setUnits(prev => {
        const next = prev.map(u => {
          if (u.id === deploySelId) return { ...u, x: cx, y: cy, deployed: true };
          return u;
        });
        return next;
      });
      setDeploySelId(null);
    }
  }

  function handleDeployStart() {
    const deployed = units.filter(u => u.team === 'player' && u.deployed);
    if (deployed.length < (stage === 0 ? INITIAL_SORTIE : PARTY_MAX)) return;

    // 未配置プレイヤーを除外
    let activeUnits = units.filter(u => u.team !== 'player' || u.deployed);

    // mapStartイベント
    activeUnits = fireEvents('mapStart', { units: activeUnits }, activeUnits);

    setUnits(activeUnits);
    setPhase('player');
    addLog('── 自ターン開始 ──', 'phase');
    showBanner('PLAYER PHASE', '#3b82f6', 1200);
    // ターン開始スキル
    activeUnits.filter(u => u.team === 'player' && u.hp > 0).forEach(u => dispatchTurnStart(u, activeUnits, []));
  }

  // ════════════════════════════════════════════
  // ユニットクリック
  // ════════════════════════════════════════════
  function handleUnitClick(u) {
    if (busyRef.current) return;
    if (phase === 'deploy') {
      // 配置済みユニットをクリック → マップから外してロスターに戻す
      if (u.team === 'player' && u.deployed) {
        setUnits(prev => prev.map(unit =>
          unit.id === u.id ? { ...unit, x: -1, y: -1, deployed: false } : unit
        ));
        setDeploySelId(null);
        return;
      }
      handleDeployCellClick(u.x, u.y);
      return;
    }
    if (phase !== 'player') return;

    // ターゲット選択中
    if (mode === 'targetAtk' && u.team === 'enemy') {
      const sel = units.find(unit => unit.id === selId);
      if (sel && isRangeShielded(sel.x, sel.y, u.x, u.y, units, u.team)) return; // 遮蔽
      executeAttack(u);
      return;
    }
    if (mode === 'targetHeal' && u.team === 'player') {
      executeHealAction(u);
      return;
    }
    if (mode === 'targetBuff' && u.team === 'player') {
      executeBuffAction(u);
      return;
    }
    if (mode === 'targetRefresh' && u.team === 'player' && u.id !== selId && u.acted) {
      // 再行動付与
      const sel = units.find(unit => unit.id === selId);
      if (sel && chosenTech) {
        if (chosenTech.maxUses < 99) {
          chosenTech.uses--;
          if (chosenTech.uses <= 0 && chosenTech.consumable) {
            sel.techs = sel.techs.filter(t => t !== chosenTech);
          }
        }
        u.acted = false;
        setUnits(prev => prev.map(unit => unit.id === u.id ? { ...unit, acted: false } : unit));
        addLog(`${sel.name} の ${chosenTech.name} → ${u.name} は再行動！`, 'info');
        showPop(u.id, '再行動', 'buff');
        setHealCells([]);
        setChosenTech(null);
        finishAction(selId);
      }
      return;
    }

    // アクション中/ターゲット選択中は他ユニットへの切替を禁止
    if (mode === 'targetAtk' || mode === 'targetHeal' || mode === 'targetBuff' || mode === 'targetRefresh' || mode === 'targetSummon') {
      // 非対象クリック → 無視（キャンセルは右クリックで）
      return;
    }
    if (mode === 'action') {
      if (!origPos) {
        // noAction使用後: メニューからしか行動できない
        return;
      }
      // 通常の移動後: 位置を戻してキャンセル
      const sel = units.find(unit => unit.id === selId);
      if (sel && origPos) {
        setUnits(prev => prev.map(unit =>
          unit.id === sel.id ? { ...unit, x: origPos.x, y: origPos.y } : unit
        ));
      }
      clearSelection();
      return;
    }

    // 味方選択（select modeのみ）
    if (mode === 'select' && !origPos && selId) {
      // noAction再移動中: 他ユニットへの切替禁止。メニュー表示で現在地行動
      const sel = units.find(unit => unit.id === selId);
      if (sel) {
        setMoveCells([]);
        setMode('action');
        setMenuPos(menuAnchorFor(sel.x, sel.y));
      }
      return;
    }
    if (u.team === 'player' && !u.acted) {
      if (mode === 'select' && selId === u.id) {
        // 自分をクリック → その場でアクションメニュー
        setMoveCells([]);
        setMode('action');
        setMenuPos(menuAnchorFor(u.x, u.y));
      } else {
        selectUnit(u);
      }
    } else if (u.team === 'enemy') {
      // 敵通常クリック: 攻撃範囲マーキング（トグル）
      toggleEnemyMarking(u);
    } else if (u.team === 'player') {
      setStatScreen(u);
    }
  }

  function selectUnit(u) {
    clearSelection();
    setSelId(u.id);
    setOrigPos({ x: u.x, y: u.y });
    const mv = getMovable(u, units);
    setMoveCells(mv);
    setMode('select');
  }

  // ════════════════════════════════════════════
  // セルクリック
  // ════════════════════════════════════════════
  function handleCellClick(cx, cy) {
    if (busyRef.current) return;
    if (phase === 'deploy') {
      handleDeployCellClick(cx, cy);
      return;
    }
    if (phase !== 'player') return;

    const sel = units.find(u => u.id === selId);
    if (!sel) { clearSelection(); return; }

    if (mode === 'select') {
      // 移動先をクリック
      if (moveCells.some(c => c.x === cx && c.y === cy)) {
        moveUnit(sel, cx, cy);
      } else if (!origPos) {
        // noAction再移動中: 範囲外→メニュー表示（移動せず現在地で行動）
        setMoveCells([]);
        setMode('action');
        setMenuPos(menuAnchorFor(sel.x, sel.y));
      } else {
        clearSelection();
      }
    } else if (mode === 'targetSummon') {
      // 召喚: 隣接空きマスに配置
      const adj = getAdj(sel.x, sel.y);
      if (adj.some(c => c.x === cx && c.y === cy) && !units.some(u => u.x === cx && u.y === cy && u.hp > 0)) {
        if (chosenTech) {
          if (chosenTech.maxUses < 99) {
            chosenTech.uses--;
            if (chosenTech.uses <= 0 && chosenTech.consumable) {
              sel.techs = sel.techs.filter(t => t !== chosenTech);
            }
          }
          const minion = createMinion(chosenTech.summon, cx, cy, sel.team);
          if (minion) {
            setUnits(prev => [...prev, minion]);
            addLog(`${sel.name} が ${minion.name} を召喚した！`, 'info');
            showPop(minion.id, '召喚', 'buff');
          }
          setChosenTech(null);
          finishAction(selId);
        }
      }
      return;
    } else if (mode === 'targetAtk' || mode === 'targetHeal' || mode === 'targetBuff' || mode === 'targetRefresh') {
      // 対象がいない空セルクリック → 何もしない（キャンセルは右クリックで）
      return;
    } else if (mode === 'action') {
      if (!origPos) {
        // noAction使用後: メニューからしか操作できない。空クリック無視
        return;
      }
      // 通常: 移動前に戻してキャンセル
      setUnits(prev => prev.map(u =>
        u.id === sel.id ? { ...u, x: origPos.x, y: origPos.y } : u
      ));
      clearSelection();
    } else {
      clearSelection();
    }
  }

  // ════════════════════════════════════════════
  // ユニット移動
  // ════════════════════════════════════════════
  async function moveUnit(u, tx, ty) {
    busyRef.current = true;
    const remainingMov = u.mov - usedMovCostRef.current;
    const path = getPath(u, tx, ty, units, remainingMov);
    const pathCost = getPathCost(path);
    usedMovCostRef.current += pathCost;
    lastMoveCostRef.current = pathCost;

    // アニメーション：1マスずつ移動
    for (const step of path) {
      setUnits(prev => prev.map(unit =>
        unit.id === u.id ? { ...unit, x: step.x, y: step.y } : unit
      ));
      await sleep(STEP_MS);
    }

    // アイテムボックス拾い（Bug6修正: インベントリに追加）
    const item = pickupItemBox(tx, ty);
    if (item) {
      const currentItems = (u.items || []).filter(it => it.uses > 0);
      const itemSlots = 4;
      if (currentItems.length < itemSlots) {
        const newItem = { ...item, uses: item.maxUses || item.uses || 1 };
        setUnits(prev => prev.map(unit =>
          unit.id === u.id ? { ...unit, items: [...(unit.items || []), newItem] } : unit
        ));
        addLog(`${u.name} は ${item.name} を獲得した`, 'item');
        showPop(u.id, item.name, 'buff');
      } else {
        addLog(`${u.name} は ${item.name} を見つけたが所持品がいっぱいだ`, 'info');
      }
    }

    // arriveイベントチェック（味方移動完了時）
    const currentUnits = units.map(unit => unit.id === u.id ? { ...unit, x: tx, y: ty } : unit);
    const arrUpdated = fireEvents('arrive', { units: currentUnits }, currentUnits);
    if (arrUpdated !== currentUnits) {
      setUnits([...arrUpdated]);
    }

    // アクションメニュー表示
    setMoveCells([]);
    setPathCells([]);
    setMode('action');
    setMenuPos(menuAnchorFor(tx, ty));
    busyRef.current = false;
  }

  // ════════════════════════════════════════════
  // アクションメニュー
  // ════════════════════════════════════════════
  function handlePlainAtk() {
    const sel = units.find(u => u.id === selId);
    if (!sel) return;
    setChosenTech(null);
    const cells = getAtkCells(sel.x, sel.y, sel.rangeMin, sel.rangeMax);
    setAtkCells(cells);
    setMenuPos(null);
    setMode('targetAtk');
  }

  function handleTechSelect(tech) {
    const sel = units.find(u => u.id === selId);
    if (!sel) return;
    setChosenTech(tech);
    if (tech.type === 'heal') {
      const rng = getTechRange(tech, sel);
      const cells = getAtkCells(sel.x, sel.y, rng.min, rng.max);
      setHealCells(cells);
      setAtkCells([]);
      setMenuPos(null);
      setMode('targetHeal');
    } else if (tech.type === 'buff' || tech.type === 'selfBuff') {
      if (tech.selfOnly || tech.type === 'selfBuff') {
        // 自己バフは即実行
        executeSelfBuff(sel, tech);
      } else {
        // 味方バフ: 味方選択モード
        const rng = getTechRange(tech, sel);
        const cells = getAtkCells(sel.x, sel.y, rng.min, rng.max);
        setHealCells(cells); // healCellsを味方ハイライトに流用
        setAtkCells([]);
        setMenuPos(null);
        setMode('targetBuff');
      }
    } else if (tech.type === 'special' && tech.subType === 'extraAction') {
      // 2回行動付与（反逆発動等）→ 即実行
      executeExtraActionTech(sel, tech);
    } else if (tech.type === 'special' && tech.subType === 'refresh') {
      // 再行動付与: 味方選択モードへ
      const rng = getTechRange(tech, sel);
      const cells = getAtkCells(sel.x, sel.y, rng.min, rng.max);
      setHealCells(cells);
      setAtkCells([]);
      setMenuPos(null);
      setMode('targetRefresh');
    } else if (tech.type === 'special' && tech.subType === 'summon') {
      // 召喚: 隣接空きマス選択モードへ
      setAtkCells([]);
      setMenuPos(null);
      setMode('targetSummon');
    } else if (tech.type === 'special' && tech.rangeMin === 0 && tech.rangeMax === 0) {
      // 自己対象特殊技（狂気のやすらぎ、解呪等）→ 即実行
      executeSelfSpecial(sel, tech);
    } else if (tech.type === 'debuffOnly') {
      const rng = getTechRange(tech, sel);
      const cells = getAtkCells(sel.x, sel.y, rng.min, rng.max);
      setAtkCells(cells);
      setMenuPos(null);
      setMode('targetAtk');
    } else {
      const rng = getTechRange(tech, sel);
      const cells = getAtkCells(sel.x, sel.y, rng.min, rng.max);
      setAtkCells(cells);
      setMenuPos(null);
      setMode('targetAtk');
    }
  }

  function handleItemUse(item) {
    const sel = units.find(u => u.id === selId);
    if (!sel) return;

    if (item.effects?.length) {
      // effects配列形式
      for (const eff of item.effects) {
        switch (eff.type) {
          case 'heal': {
            const amt = Math.min(eff.value || 0, sel.maxHp - sel.hp);
            if (amt > 0) { sel.hp += amt; showPop(sel.id, `+${amt}`, 'heal'); }
            addLog(`${sel.name} は ${item.name} を使った (HP+${amt})`, 'heal');
            break;
          }
          case 'statMod': {
            for (const [stat, val] of Object.entries(eff.mods || {})) {
              sel[stat] = (sel[stat] || 0) + val;
            }
            addLog(`${sel.name} は ${item.name} を使った`, 'info');
            showPop(sel.id, item.name, 'buff');
            break;
          }
        }
      }
      setUnits(prev => prev.map(u => u.id === sel.id ? { ...sel } : u));
    } else if (item.effect === 'heal') {
      // 旧形式互換
      const healed = Math.min(sel.maxHp - sel.hp, item.value);
      setUnits(prev => prev.map(u =>
        u.id === sel.id ? { ...u, hp: u.hp + healed } : u
      ));
      showPop(sel.id, `+${healed}`, 'heal');
      addLog(`${sel.name} は ${item.name} を使った (HP+${healed})`, 'heal');
    }

    item.uses = (item.uses || 1) - 1;

    if (item.noAction) {
      const updated = units.map(unit =>
        unit.id === sel.id
          ? { ...unit, _usedNoActionThisTurn: [...(unit._usedNoActionThisTurn || []), item.name] }
          : unit
      );
      setUnits(updated);
      enterNoActionReselect(sel.id, updated);
    } else {
      finishAction(sel.id);
      setMenuPos(null);
    }
  }

  function handleWait() {
    finishAction(selId);
  }

  function handleCancel() {
    const sel = units.find(u => u.id === selId);
    if (!sel) { clearSelection(); return; }

    if (origPos) {
      // 通常: 移動前に戻す
      setUnits(prev => prev.map(u =>
        u.id === sel.id ? { ...u, x: origPos.x, y: origPos.y } : u
      ));
      clearSelection();
    } else if (mode === 'targetAtk' || mode === 'targetHeal' || mode === 'targetBuff' || mode === 'targetRefresh' || mode === 'targetSummon') {
      // ターゲット選択中 → アクションメニューに戻る
      setAtkCells([]);
      setHealCells([]);
      setChosenTech(null);
      setMode('action');
      setMenuPos(menuAnchorFor(sel.x, sel.y));
    } else if (mode === 'action' && noActionPosRef.current) {
      // 再移動後（or その場クリック後）→ 再移動前の位置に戻す
      const pos = noActionPosRef.current;
      if (lastMoveCostRef.current > 0) {
        const updatedUnits = units.map(u =>
          u.id === sel.id ? { ...u, x: pos.x, y: pos.y } : u
        );
        setUnits(updatedUnits);
        usedMovCostRef.current -= lastMoveCostRef.current;
        lastMoveCostRef.current = 0;
        setMenuPos(null);
        enterNoActionReselect(sel.id, updatedUnits);
      } else {
        // その場クリックだった場合、位置は変わってないので再移動画面に戻すだけ
        setMenuPos(null);
        enterNoActionReselect(sel.id);
      }
    }
    // それ以外（残MOV0のアクションメニュー等）は何もしない
  }

  // ════════════════════════════════════════════
  // 戦闘実行
  // ════════════════════════════════════════════
  async function executeAttack(target) {
    const atk = units.find(u => u.id === selId);
    if (!atk) return;
    busyRef.current = true;
    setAtkCells([]);
    setMenuPos(null);

    try {
    const prevUnits = units; // 戦闘前状態を保持
    const result = executeCombat(atk, target, chosenTech, units);

    // 今回新たに撃破された敵を特定
    const newlyDefeatedIds = result.units
      .filter(u => u.team === 'enemy' && u.hp <= 0)
      .filter(u => { const before = prevUnits.find(p => p.id === u.id); return before && before.hp > 0; })
      .map(u => u.id);

    // ログ
    result.logs.forEach(l => addLog(l.text, l.type));

    // ヒットアニメ
    for (const hit of result.hits) {
      shake(hit.uid);
      const popType = hit.phase === 'counter' ? 'counter'
        : hit.phase === 'followup' ? 'followup' : 'dmg';
      showPop(hit.uid, hit.dmg, popType);
      await sleep(400);
    }

    // ユニット状態更新（コピーしてstateに入れる。result.unitsは後で再利用するため変異させない）
    setUnits(result.units.map(u => ({ ...u })));

    // 経験値
    if (result.expGain) {
      showPop(result.expGain.uid, `+${result.expGain.xp}EXP`, 'exp');
      addLog(`${atk.name} EXP+${result.expGain.xp}`, 'exp');
    }

    // ドロップ品
    for (const did of newlyDefeatedIds) {
      const defeated = result.units.find(u => u.id === did);
      const killer = result.units.find(u => u.id === atk.id);
      if (defeated && killer) handleDrop(defeated, killer);
    }

    // 副次効果（隣接スキル等）のダメージポップ（Bug4修正）
    const prevHpMap = {};
    prevUnits.forEach(u => { prevHpMap[u.id] = u.hp; });
    for (const u of result.units) {
      if (u.id === atk.id || u.id === target.id) continue;
      const prevHp = prevHpMap[u.id];
      if (prevHp === undefined) continue;
      const diff = u.hp - prevHp;
      if (diff < 0) {
        showPop(u.id, Math.abs(diff), 'dmg');
      } else if (diff > 0) {
        showPop(u.id, `+${diff}`, 'heal');
      }
    }

    await sleep(200);

    // レベルアップチェック（whileループで連続レベルアップ対応: Bug5修正）
    let updatedAtk = result.units.find(u => u.id === atk.id);
    while (updatedAtk && updatedAtk.hp > 0 && canLevelUp(updatedAtk)) {
      const newUnit = await handleLevelUp(updatedAtk);
      const idx = result.units.findIndex(u => u.id === newUnit.id);
      if (idx >= 0) result.units[idx] = newUnit;
      updatedAtk = newUnit;
    }

    if (chosenTech?.noAction) {
      // noAction攻撃技（投擲等）: 使用済みリスト追加 → 残移動力で再移動
      const updated = result.units.map(unit => {
        if (unit.id === atk.id) {
          return { ...unit, _usedNoActionThisTurn: [...(unit._usedNoActionThisTurn || []), chosenTech.name] };
        }
        return unit;
      });
      setUnits(updated);
      setAtkCells([]);
      setChosenTech(null);
      enterNoActionReselect(atk.id, updated);
      checkStageClear(updated, newlyDefeatedIds);
    } else {
      // ── cantoチェック（result.unitsから直接判定、staleクロージャに頼らない）──
      const atkU = result.units.find(u => u.id === atk.id);
      const hasCanto = atkU && atkU.hp > 0 && (
        getTraitEffects(atkU).some(e => e.type === 'canto') || atkU._techCanto
      );

      if (hasCanto) {
        // Canto: 再移動モードへ。acted=trueはまだ設定しない
        // ★ stateオブジェクトを変異させず、map()で新しいオブジェクトを作る
        const updated = result.units.map(u =>
          u.id === atk.id ? { ...u } : u
        );
        setUnits(updated);
        enterNoActionReselect(atk.id, updated);
        checkStageClear(updated, newlyDefeatedIds);
      } else {
        // 通常: acted=trueを含む新しいオブジェクトで1回だけsetUnits
        // ★ _didAttackの変異を完全に排除（Bug3修正）
        const updated = result.units.map(u =>
          u.id === atk.id ? { ...u, acted: true } : u
        );
        setUnits(updated);
        const alivePlayers = updated.filter(u => u.team === 'player' && u.hp > 0);
        if (alivePlayers.length > 0 && alivePlayers.every(u => u.acted)) {
          setTimeout(() => handleEndTurn(), 400);
        }
        clearSelection();
        checkStageClear(updated, newlyDefeatedIds);
      }
    }
    } catch (err) {
      console.error('executeAttack error:', err);
      addLog(`エラー: ${err.message}`, 'info');
    } finally {
      busyRef.current = false;
    }
  }

  async function executeHealAction(target) {
    const healer = units.find(u => u.id === selId);
    if (!healer || !chosenTech) return;
    busyRef.current = true;
    setHealCells([]);
    setMenuPos(null);

    try {
    const result = executeHeal(healer, target, chosenTech, units);

    result.logs.forEach(l => addLog(l.text, l.type));
    showPop(target.id, `+${result.healAmt}`, 'heal');

    setUnits(result.units);
    await sleep(400);

    if (chosenTech.noAction) {
      const updated = result.units.map(unit =>
        unit.id === healer.id
          ? { ...unit, _usedNoActionThisTurn: [...(unit._usedNoActionThisTurn || []), chosenTech.name] }
          : unit
      );
      setUnits(updated);
      setHealCells([]);
      setChosenTech(null);
      enterNoActionReselect(healer.id, updated);
    } else {
      finishAction(healer.id);
    }
    } catch (err) {
      console.error('executeHealAction error:', err);
      addLog(`エラー: ${err.message}`, 'info');
    } finally {
      busyRef.current = false;
    }
  }

  // バフ技共通: uses消費 + counterCost + カウンター付与 + 追加effects
  function applyBuffTech(caster, target, tech) {
    if (tech.maxUses < 99) {
      tech.uses--;
      if (tech.uses <= 0 && tech.consumable) {
        caster.techs = caster.techs.filter(t => t !== tech);
      }
    }
    if (tech.counterCost) {
      if (!caster._counters) caster._counters = {};
      caster._counters[tech.counterCost.name] = (caster._counters[tech.counterCost.name] || 0) - tech.counterCost.cost;
      addLog(`${tech.counterCost.name}${tech.counterCost.cost}消費`, 'info');
    }
    // 基本カウンター付与（tech.buffCounter）
    if (tech.buffCounter) {
      const eff = { counter: tech.buffCounter, amount: tech.buffAmount || 1 };
      if (tech.buffHitCheck) {
        const hitPct = calcCounterHit(caster, target, tech.buffHitCheck.baseHit || 75);
        const roll = Math.random() * 100;
        if (roll < hitPct) {
          applyCounterGen(target, eff, null, tech.name);
          addLog(`  ${tech.name}: ${target.name} に ${eff.counter}付与`, 'buff');
        } else {
          addLog(`  ${tech.name}: ${eff.counter}付与失敗（${hitPct}%）`, 'info');
        }
      } else {
        applyCounterGen(target, eff, null, tech.name);
        addLog(`  ${tech.name}: ${target.name} に ${eff.counter}付与`, 'buff');
      }
    }
    // 追加effects（onCombat）
    for (const eff of (tech.effects || [])) {
      if (eff.trigger !== 'onCombat') continue;
      const tgt = eff.scope === 'self' ? caster : target;
      if (eff.type === 'counterGen') {
        applyCounterGen(tgt, eff, null, tech.name);
        addLog(`  ${tech.name}: ${tgt.name} に ${eff.counter}付与`, 'buff');
      }
      if (eff.type === 'heal' && tgt.hp > 0 && tgt.hp < tgt.maxHp) {
        const amt = Math.min(eff.value || 0, tgt.maxHp - tgt.hp);
        if (amt > 0) { tgt.hp += amt; addLog(`  ${tech.name}: ${tgt.name} HP${amt}回復`, 'heal'); }
      }
    }
  }

  function executeSelfBuff(u, tech) {
    applyBuffTech(u, u, tech);
    addLog(`${u.name} は ${tech.name} を使った`, 'info');
    showPop(u.id, tech.name, 'buff');

    if (tech.noAction) {
      const updated = units.map(unit =>
        unit.id === u.id
          ? { ...unit, _usedNoActionThisTurn: [...(unit._usedNoActionThisTurn || []), tech.name] }
          : unit
      );
      setUnits(updated);
      enterNoActionReselect(u.id, updated);
    } else {
      finishAction(u.id);
      setMenuPos(null);
    }
  }

  function executeBuffAction(targetUnit) {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
    const caster = units.find(u => u.id === selId);
    const tech = chosenTech;
    if (!caster || !tech) return;
    const target = units.find(u => u.id === targetUnit.id);
    if (!target) return;

    applyBuffTech(caster, target, tech);
    addLog(`${caster.name} の ${tech.name} → ${target.name}`, 'info');
    showPop(target.id, tech.name, 'buff');
    setHealCells([]);
    setChosenTech(null);

    if (tech.noAction) {
      const updated = units.map(unit =>
        unit.id === caster.id
          ? { ...unit, _usedNoActionThisTurn: [...(unit._usedNoActionThisTurn || []), tech.name] }
          : unit
      );
      setUnits(updated);
      enterNoActionReselect(caster.id, updated);
    } else {
      finishAction(caster.id);
    }
    } catch (err) {
      console.error('executeBuffAction error:', err);
      addLog(`エラー: ${err.message}`, 'info');
    } finally {
      busyRef.current = false;
    }
  }

  function executeSelfSpecial(u, tech) {
    // 自己対象special技（curseHeal, uncurse等）
    // executeCombatのspecial分岐を利用（attacker=defender=self）
    const result = executeCombat(u, u, tech, units);
    result.logs.forEach(l => addLog(l.text, l.type));
    setUnits(result.units);
    finishAction(u.id);
    setMenuPos(null);
  }

  function executeExtraActionTech(u, tech) {
    // 2回行動付与（反逆発動等）
    // counterCost消費
    if (tech.counterCost) {
      if (!u._counters) u._counters = {};
      u._counters[tech.counterCost.name] = (u._counters[tech.counterCost.name] || 0) - tech.counterCost.cost;
      addLog(`${tech.counterCost.name}${tech.counterCost.cost}消費`, 'info');
    }
    addLog(`${u.name} は ${tech.name} を使った → 2回行動！`, 'info');
    showPop(u.id, '2回行動', 'buff');

    // noAction技として扱い、再移動→次アクションに進む
    const updated = units.map(unit =>
      unit.id === u.id
        ? { ...unit, _usedNoActionThisTurn: [...(unit._usedNoActionThisTurn || []), tech.name] }
        : unit
    );
    setUnits(updated);
    enterNoActionReselect(u.id, updated);
  }

  // ════════════════════════════════════════════
  // 行動完了
  // ════════════════════════════════════════════
  function finishAction(uid) {
    // ★ cantoロジックはexecuteAttack内に移動済み（Bug3修正）
    setUnits(prev => {
      const next = prev.map(u =>
        u.id === uid ? { ...u, acted: true, _didAttack: false } : u
      );
      const alivePlayers = next.filter(u => u.team === 'player' && u.hp > 0);
      if (alivePlayers.length > 0 && alivePlayers.every(u => u.acted)) {
        setTimeout(() => handleEndTurn(), 400);
      }
      return next;
    });
    clearSelection();
  }

  // noAction技使用後: 残移動力があれば再移動モード、なければメニュー再表示
  function enterNoActionReselect(unitId, updatedUnits) {
    const sel = (updatedUnits || units).find(u => u.id === unitId);
    if (!sel) return;
    setOrigPos(null); // 移動確定
    noActionPosRef.current = { x: sel.x, y: sel.y }; // 再移動前の位置を保存
    lastMoveCostRef.current = 0; // 再移動コストをリセット

    const remainingMov = sel.mov - usedMovCostRef.current;
    if (remainingMov > 0) {
      const mv = getMovable(sel, updatedUnits || units, remainingMov);
      if (mv.length <= 1) {
        setMoveCells([]);
        setMode('action');
        setMenuPos(menuAnchorFor(sel.x, sel.y));
      } else {
        setMoveCells(mv);
        setMode('select');
        setMenuPos(null);
      }
    } else {
      setMoveCells([]);
      setMode('action');
      setMenuPos(menuAnchorFor(sel.x, sel.y));
    }
  }

  // ════════════════════════════════════════════
  // レベルアップ処理
  // ════════════════════════════════════════════
  async function handleLevelUp(u) {
    const { unit: lvUnit, gains } = applyLevelUp(u);

    // CC判定は削除（CCはインターバルで行う）
    const parts = rollParts(lvUnit);

    return new Promise(resolve => {
      setPendingLvUp({
        unit: lvUnit, gains, parts, ccOptions: null,
        resolve: (updatedUnit) => {
          setPendingLvUp(null);
          // ★ setUnitsは呼び出し元で一括管理する（Bug5修正: 競合防止）
          resolve(updatedUnit);
        },
      });
    });
  }

  function handlePickPart(part) {
    if (!pendingLvUp) return;
    if (!part) { pendingLvUp.resolve(pendingLvUp.unit); return; } // 獲得しない
    const updated = applyPart(pendingLvUp.unit, part);
    pendingLvUp.resolve(updated);
  }

  function handleSwapPart(removeName, newPart) {
    if (!pendingLvUp) return;
    const updated = swapPart(pendingLvUp.unit, removeName, newPart);
    pendingLvUp.resolve(updated);
  }

  function handlePickCC(className) {
    if (!pendingLvUp) return;
    const updated = applyCC(pendingLvUp.unit, className);
    // CC後ドラフト
    const parts = rollParts(updated);
    setPendingLvUp(prev => ({
      ...prev, unit: updated, ccOptions: null, parts,
    }));
  }

  // ════════════════════════════════════════════
  // ステージクリア判定
  // ════════════════════════════════════════════
  function checkStageClear(currentUnits, newlyDefeatedIds = []) {
    let cu = currentUnits || units;
    const obj = getMap()?.objective;

    // rout（敵全滅）判定
    const enemies = cu.filter(u => u.team === 'enemy' && u.hp > 0);
    if ((!obj || obj.type === 'rout') && enemies.length === 0) {
      setGameOver('stageClear');
      showBanner('STAGE CLEAR', '#4ade80', 2000);
      playBGM('clear', { fade: 500 });
      return;
    }

    // arrive（到達）判定
    if (obj?.type === 'arrive' && obj.zoneId) {
      const players = cu.filter(u => u.team === 'player' && u.hp > 0);
      if (players.some(u => isInZone(obj.zoneId, u.x, u.y))) {
        setGameOver('stageClear');
        showBanner('STAGE CLEAR', '#4ade80', 2000);
        playBGM('clear', { fade: 500 });
        return;
      }
    }

    // boss（ボス撃破）判定
    if (obj?.type === 'boss' && obj.targetId) {
      const boss = cu.find(u => u.id === obj.targetId || u.label === obj.targetId);
      if (boss && boss.hp <= 0) {
        setGameOver('stageClear');
        showBanner('STAGE CLEAR', '#4ade80', 2000);
        playBGM('clear', { fade: 500 });
        return;
      }
    }

    // 味方全滅チェック
    const players = cu.filter(u => u.team === 'player' && u.hp > 0);
    if (players.length === 0) {
      setGameOver('defeat');
      showBanner('DEFEAT', '#ef4444', 2000);
      stopBGM({ fade: 1000 });
    }

    // defeatイベント（今回新たに撃破された敵のみ）
    for (const deadId of newlyDefeatedIds) {
      const dead = cu.find(u => u.id === deadId);
      if (!dead) continue;
      const evtUpdated = fireEvents('defeat', { targetId: dead.id, units: cu }, cu);
      if (evtUpdated !== cu) {
        cu = evtUpdated;
        setUnits([...cu]);
      }
      // defeatGroup: この敵のgroupの全員が死んでいたら発火
      if (dead.group) {
        const groupAlive = cu.filter(u => u.group === dead.group && u.hp > 0);
        if (groupAlive.length === 0) {
          const grpUpdated = fireEvents('defeatGroup', { group: dead.group, units: cu }, cu);
          if (grpUpdated !== cu) {
            cu = grpUpdated;
            setUnits([...cu]);
          }
        }
      }
    }

    // defeatCount: 総撃破数でチェック
    if (newlyDefeatedIds.length > 0) {
      const totalDefeated = cu.filter(u => u.team === 'enemy' && u.hp <= 0).length;
      const cntUpdated = fireEvents('defeatCount', { defeatCount: totalDefeated, units: cu }, cu);
      if (cntUpdated !== cu) {
        cu = cntUpdated;
        setUnits([...cu]);
      }
    }
  }

  // ════════════════════════════════════════════
  // ターン終了
  // ════════════════════════════════════════════
  // ドロップ品処理
  function handleDrop(defeated, killer) {
    if (!defeated.drop) return;
    if (Math.random() * 100 >= defeated.drop.rate) return;
    if (defeated.drop.type === 'item') {
      const item = itemsData.find(i => i.id === defeated.drop.ref);
      if (item && killer) {
        killer.items.push({ ...item, uses: item.maxUses || 1 });
        addLog(`${defeated.name} が ${item.name} を落とした！`, 'item');
        showPop(killer.id, item.name, 'buff');
      }
    } else if (defeated.drop.type === 'part') {
      addLog(`${defeated.name} がパーツを落とした！`, 'item');
    }
  }

  // onStay地形効果の適用
  function applyOnStay(unit, fx, logs) {
    switch (fx.type) {
      case 'damage': {
        const dmg = fx.value || 0;
        unit.hp = Math.max(0, unit.hp - dmg);
        logs.push({ text: `  地形: ${unit.name} に${dmg}ダメージ`, type: 'debuff' });
        break;
      }
      case 'heal': {
        const amt = Math.min(fx.value || 0, unit.maxHp - unit.hp);
        if (amt > 0) { unit.hp += amt; logs.push({ text: `  地形: ${unit.name} HP${amt}回復`, type: 'heal' }); }
        break;
      }
      case 'healPct': {
        const amt = Math.min(Math.floor(unit.maxHp * (fx.value || 0) / 100), unit.maxHp - unit.hp);
        if (amt > 0) { unit.hp += amt; logs.push({ text: `  地形: ${unit.name} HP${amt}回復`, type: 'heal' }); }
        break;
      }
      case 'counter': {
        if (!unit._counters) unit._counters = {};
        unit._counters[fx.counter] = Math.min(fx.max || 99, (unit._counters[fx.counter] || 0) + (fx.value || 1));
        break;
      }
    }
  }

  async function handleEndTurn() {
    if (busyRef.current || phase !== 'player') return;
    setCtxMenu(null);
    clearSelection();
    busyRef.current = true;

    try {
    // プレイヤーターン終了処理
    const logs = [];
    let updated = [...units];
    updated.forEach(u => {
      if (u.team === 'player' && u.hp > 0) {
        dispatchTurnEnd(u, updated, logs); // 風まとい等
        // onStay地形効果
        for (const fx of getOnStayEffects(u.x, u.y)) {
          applyOnStay(u, fx, logs);
        }
      }
    });
    logs.forEach(l => addLog(l.text, l.type));

    // === 敵ターン ===
    setPhase('enemy');
    addLog('── 敵ターン ──', 'phase');
    showBanner('ENEMY PHASE', '#ef4444', 1400);
    await sleep(1400);

    // 敵ターン開始: _currentTurn++、_wasHit/_aiChangedリセット
    updated.filter(u => u.team === 'enemy' && u.hp > 0).forEach(u => {
      u._currentTurn = (u._currentTurn || 1) + 1;
      u._wasHit = false;
      u._aiChanged = false;
    });
    // 味方フラグリセット（perTurn用）
    updated.filter(u => u.team === 'player' && u.hp > 0).forEach(u => {
      u._preemptiveUsed = false;
      u._substituteUsed = false;
    });

    // 敵ターン開始イベント
    updated = fireEvents('turn', { turn: turn, phase: 'enemy', units: updated }, updated);
    setUnits([...updated]);

    // 1体ずつ計画→実行（逐次処理で位置衝突を防ぐ）
    const enemyIds = aiSortEnemies(
      updated.filter(u => u.team === 'enemy' && u.hp > 0).map(u => u.id),
      updated
    );

    for (const eid of enemyIds) {
      const enemy = updated.find(u => u.id === eid);
      if (!enemy || enemy.hp <= 0) continue;
      if (isStunned(enemy)) continue; // 行動不能: スキップ

      const action = decideAction(enemy, updated);
      if (!action) continue;

      // 移動アニメ（パスに沿って1マスずつ）
      if (action.move) {
        const { x: mx, y: my } = action.move;
        if (mx !== enemy.x || my !== enemy.y) {
          const path = getPath(enemy, mx, my, updated);
          for (const step of path) {
            enemy.x = step.x;
            enemy.y = step.y;
            setUnits([...updated]);
            await sleep(STEP_MS);
          }
          await sleep(50);
        }
      }

      // 攻撃
      if (action.target) {
        const tid = typeof action.target === 'object' ? action.target.id : action.target;
        const target = updated.find(u => u.id === tid && u.hp > 0);
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

          // 反撃で経験値を得た味方のレベルアップチェック（whileループ: Bug5修正）
          if (result.expGain && result.expGain.uid) {
            let lvUnit = updated.find(u => u.id === result.expGain.uid);
            while (lvUnit && lvUnit.hp > 0 && canLevelUp(lvUnit)) {
              showPop(lvUnit.id, `+EXP`, 'exp');
              const newUnit = await handleLevelUp(lvUnit);
              const idx = updated.findIndex(u => u.id === newUnit.id);
              if (idx >= 0) updated[idx] = newUnit;
              lvUnit = newUnit;
            }
            setUnits([...updated]);
          }
        }
      }
    }

    // 敵ターン終了処理
    updated.forEach(u => {
      if (u.team === 'enemy' && u.hp > 0) {
        dispatchTurnEnd(u, updated, []);
        for (const fx of getOnStayEffects(u.x, u.y)) {
          applyOnStay(u, fx, []);
        }
      }
    });

    // 敵ターン終了時: アイテムボックス消去チェック
    const destroyedBoxes = destroyItemBoxesByEnemies(updated);
    destroyedBoxes.forEach(box => {
      addLog(`敵がアイテムボックスを破壊した (${box.x},${box.y})`, 'info');
    });

    // 敵ターン終了イベント
    updated = fireEvents('turnEnd', { turn: turn, phase: 'enemy', units: updated }, updated);

    // === 次の自ターン ===
    const nextTurn = turn + 1;
    setTurn(nextTurn);
    updated.forEach(u => { u.acted = false; u._usedNoActionThisTurn = []; });

    // プレイヤーターン開始イベント
    updated = fireEvents('turn', { turn: nextTurn, phase: 'player', units: updated }, updated);

    updated.forEach(u => {
      if (u.team === 'player' && u.hp > 0) dispatchTurnStart(u, updated, []);
    });
    // 行動不能ユニットはacted扱い（行動スキップ）
    updated.forEach(u => {
      if (u.team === 'player' && u.hp > 0 && isStunned(u)) u.acted = true;
    });
    setUnits([...updated]);
    setPhase('player');
    addLog('── 自ターン開始 ──', 'phase');
    showBanner('PLAYER PHASE', '#3b82f6', 1200);

    checkStageClear(updated);
    } catch (err) {
      console.error('handleEndTurn error:', err);
      addLog(`エラー: ${err.message}`, 'info');
    } finally {
      busyRef.current = false;
    }
  }

  // ════════════════════════════════════════════
  // ステージ進行
  // ════════════════════════════════════════════
  function advanceStage() {
    if (stage >= NUM_STAGES - 1) {
      setGameOver('loopClear');
      playBGM('ending', { fade: 500 });
      return;
    }
    const nextStage = stage + 1;

    // HP回復 + 技回数回復 + 非永続カウンターリセット
    const recovered = units.filter(u => u.team === 'player').map(u => {
      // 非永続カウンターを除去
      let counters = u._counters ? { ...u._counters } : undefined;
      if (counters) {
        for (const name of Object.keys(counters)) {
          const def = COUNTER_DEFS[name];
          if (!def || !def.persistent) delete counters[name];
        }
        if (Object.keys(counters).length === 0) counters = undefined;
      }
      return {
        ...u,
        hp: Math.min(u.maxHp, u.hp + Math.floor(u.maxHp * HP_RECOVERY_PCT)),
        techs: u.techs.map(t => t.consumable || t.maxUses >= 99 ? t : { ...t, uses: t.maxUses }),
        _counters: counters,
      };
    });
    setRoster(recovered);
    setUnits(recovered);
    setStage(nextStage);
    setGameOver(null);

    // M1クリア後: 合流フェーズ
    if (stage === 0 && fullPool.length > 0) {
      const currentIds = recovered.map(u => u.id);
      const remaining = fullPool.filter(u => !currentIds.includes(u.id));
      const shuffled = [...remaining].sort(() => Math.random() - 0.5);
      const candidates = shuffled.slice(0, 3);
      // 合流キャラのレベルを2-3に
      candidates.forEach(c => {
        for (let i = 0; i < 2; i++) {
          if (c.level < 3) {
            const { unit } = applyLevelUp(c);
            Object.assign(c, unit);
          }
        }
      });
      setRecruitPhase({ candidates, picked: [] });
      setPhase('recruit');
      return;
    }

    // CC対象ステージ判定
    const ccType = CC_STAGES[stage];
    if (ccType) {
      const targets = recovered.filter(u => {
        const opts = getCCOptions(u);
        return opts && opts.type === ccType;
      });
      if (targets.length > 0) {
        setCcQueue(targets.map(u => u.id));
        // 最初のユニットのCC画面を出す
        startCCForUnit(targets[0], recovered);
      }
    }

    setPhase('interval');
  }

  function startCCForUnit(u, allUnits) {
    const ccOpts = getCCOptions(u);
    setCcCurrent({ unit: u, ccOptions: ccOpts, draftParts: null });
  }

  function handleIntervalCC(className) {
    if (!ccCurrent) return;
    const updated = applyCC(ccCurrent.unit, className);
    // CC後特殊ドラフト
    const parts = rollParts(updated);
    setCcCurrent(prev => ({ ...prev, unit: updated, ccOptions: null, draftParts: parts }));
  }

  function handleIntervalCCDraft(part) {
    if (!ccCurrent) return;
    const updated = applyPart(ccCurrent.unit, part);
    finishIntervalCCDraft(updated);
  }

  function handleIntervalCCSwap(removeName, newPart) {
    if (!ccCurrent) return;
    const updated = swapPart(ccCurrent.unit, removeName, newPart);
    finishIntervalCCDraft(updated);
  }

  function finishIntervalCCDraft(updated) {
    // ユニット更新
    setRoster(prev => prev.map(u => u.id === updated.id ? updated : u));
    setUnits(prev => prev.map(u => u.id === updated.id ? updated : u));

    // 次のCC対象へ
    const remaining = ccQueue.filter(id => id !== updated.id);
    setCcQueue(remaining);

    if (remaining.length > 0) {
      const nextUnit = roster.find(u => u.id === remaining[0]) || units.find(u => u.id === remaining[0]);
      if (nextUnit) {
        startCCForUnit(nextUnit);
      } else {
        setCcCurrent(null);
      }
    } else {
      setCcCurrent(null);
    }
  }

  function handleRecruitToggle(uid) {
    setRecruitPhase(prev => {
      if (!prev) return prev;
      const picked = prev.picked.includes(uid)
        ? prev.picked.filter(id => id !== uid)
        : prev.picked.length < 2 ? [...prev.picked, uid] : prev.picked;
      return { ...prev, picked };
    });
  }

  function handleRecruitConfirm() {
    if (!recruitPhase || recruitPhase.picked.length !== 2) return;
    const newMembers = recruitPhase.candidates.filter(u =>
      recruitPhase.picked.includes(u.id)
    );
    const updatedRoster = [...roster, ...newMembers];

    // HP回復 + 技回数回復 + 非永続カウンターリセットしてインターバルへ
    const recovered = updatedRoster.map(u => {
      let counters = u._counters ? { ...u._counters } : undefined;
      if (counters) {
        for (const name of Object.keys(counters)) {
          const def = COUNTER_DEFS[name];
          if (!def || !def.persistent) delete counters[name];
        }
        if (Object.keys(counters).length === 0) counters = undefined;
      }
      return {
        ...u,
        hp: Math.min(u.maxHp, u.hp + Math.floor(u.maxHp * HP_RECOVERY_PCT)),
        techs: u.techs.map(t => t.consumable || t.maxUses >= 99 ? t : { ...t, uses: t.maxUses }),
        _counters: counters,
      };
    });
    setRoster(recovered);
    setUnits(recovered);
    setRecruitPhase(null);

    setPhase('interval');
  }

  function handleIntervalNext() {
    initStage(stage, roster);
  }

  function handleReset() {
    resetUid(0);
    const allRoster = createRoster();
    setFullPool(allRoster);
    const shuffled = [...allRoster].sort(() => Math.random() - 0.5);
    const initial = shuffled.slice(0, INITIAL_SORTIE);
    setRoster(initial);
    setStage(0);
    setCcQueue([]);
    setCcCurrent(null);
    setRecruitPhase(null);
    initStage(0, initial);
    playBGM('title');
  }

  // ════════════════════════════════════════════
  // コンテキストメニュー
  // ════════════════════════════════════════════
  function handleCellRightClick(cx, cy, e) {
    if (busyRef.current) return;
    setCtxMenu(null);
    setStatScreen(null);

    if (phase === 'deploy') {
      // 配置中: ユニットがいればステータス
      const u = units.find(u => u.hp > 0 && u.x === cx && u.y === cy);
      if (u) setStatScreen(u);
      return;
    }

    // action/target系モード中 → キャンセル
    if (mode === 'action' || mode === 'targetAtk' || mode === 'targetHeal' || mode === 'targetBuff') {
      handleCancel();
      return;
    }

    // select中で移動範囲表示中 → キャンセル
    if (mode === 'select' && selId) {
      if (!origPos) {
        const sel = units.find(u => u.id === selId);
        if (sel) { setMoveCells([]); setMode('action'); setMenuPos(menuAnchorFor(sel.x, sel.y)); }
      } else { clearSelection(); }
      return;
    }

    // ユニットがいればステータス
    const u = units.find(u => u.hp > 0 && u.x === cx && u.y === cy);
    if (u) {
      setStatScreen(u);
      return;
    }

    // 空セル → コンテキストメニュー
    if (phase === 'player') {
      const el = rootRef.current;
      const rect = el?.getBoundingClientRect();
      // CSSスケール補正（スマホ縮小表示時）
      const scale = el && el.offsetWidth ? rect.width / el.offsetWidth : 1;
      const px = rect ? (e.clientX - rect.left) / scale : cx * TILE;
      const py = rect ? (e.clientY - rect.top) / scale : cy * TILE;
      setCtxMenu({ x: px, y: py });
    }
  }

  function handleUnitRightClick(u, e) {
    if (busyRef.current) return;
    setCtxMenu(null);

    if (phase === 'deploy') {
      setStatScreen(u);
      return;
    }

    // action/target中 → キャンセル
    if (mode === 'action' || mode === 'targetAtk' || mode === 'targetHeal' || mode === 'targetBuff') {
      handleCancel();
      return;
    }

    // select中で移動範囲表示中 → キャンセル
    if (mode === 'select' && selId) {
      if (!origPos) {
        const sel = units.find(unit => unit.id === selId);
        if (sel) { setMoveCells([]); setMode('action'); setMenuPos(menuAnchorFor(sel.x, sel.y)); }
      } else { clearSelection(); }
      return;
    }

    // それ以外 → ステータス表示
    setStatScreen(u);
  }

  // ════════════════════════════════════════════
  // 敵マーキング（攻撃範囲トグル表示・複数敵対応）
  // ════════════════════════════════════════════
  function recalcRanges(ids, curUnits) {
    const liveIds = ids.filter(id => curUnits.some(u => u.id === id && u.hp > 0));
    if (liveIds.length !== ids.length) setRangeEnemyIds(liveIds);
    // セルごとに「ブロックされない攻撃元が1つでもあるか」を管理
    const cellMap = {}; // key -> { x, y, unblocked: boolean }
    const key = (x, y) => `${x},${y}`;
    for (const id of liveIds) {
      const eu = curUnits.find(u => u.id === id && u.hp > 0);
      if (!eu) continue;
      const movable = getMovable(eu, curUnits, undefined, { ignoreSameTeam: true });
      for (const mc of movable) {
        const atk = getAtkCells(mc.x, mc.y, eu.rangeMin, eu.rangeMax);
        for (const ac of atk) {
          const k = key(ac.x, ac.y);
          if (cellMap[k]?.unblocked) continue; // 既にブロック不可確定
          const blocked = isRangeShielded(mc.x, mc.y, ac.x, ac.y, curUnits, 'player');
          if (!cellMap[k]) cellMap[k] = { x: ac.x, y: ac.y, unblocked: !blocked };
          else if (!blocked) cellMap[k].unblocked = true;
        }
      }
    }
    setEnemyRanges(Object.values(cellMap).filter(c => c.unblocked).map(c => ({ x: c.x, y: c.y })));
  }

  function toggleEnemyMarking(enemy) {
    const eid = enemy.id;
    let newIds;
    if (rangeEnemyIds.includes(eid)) {
      newIds = rangeEnemyIds.filter(id => id !== eid);
    } else {
      newIds = [...rangeEnemyIds, eid];
    }
    setRangeEnemyIds(newIds);
    recalcRanges(newIds, units);
  }

  // ════════════════════════════════════════════
  // ホバー
  // ════════════════════════════════════════════
  function handleHover(cx, cy) {
    setHoverCell({ x: cx, y: cy });
  }

  // ════════════════════════════════════════════
  // 配置パラメータ
  // ════════════════════════════════════════════
  const sortieLimit = stage === 0 ? INITIAL_SORTIE : PARTY_MAX;
  const deployCount = units.filter(u => u.team === 'player' && u.deployed).length;
  const deployZone = phase === 'deploy' ? getDeployZone() : [];

  // 戦闘予測
  const selUnit = units.find(u => u.id === selId);
  const previewTarget = (mode === 'targetAtk' && hoverCell)
    ? units.find(u => u.hp > 0 && u.x === hoverCell.x && u.y === hoverCell.y && u.team === 'enemy')
    : null;

  // ════════════════════════════════════════════
  // レンダー
  // ════════════════════════════════════════════
  const mapData = getMap();
  const terrain = mapData?.terrain || [];

  return (
    <ScreenScaler>
    <div ref={rootRef} style={{
      width: GW, height: GH, position: 'relative', overflow: 'hidden',
      background: '#0c0f1a',
      fontFamily: "'Noto Sans JP','Hiragino Sans',sans-serif",
      userSelect: 'none',
      cursor: 'default',
    }}>
      <SettingsPanel />
      {/* マップ */}
      <MapView
        ref={mapApiRef}
        mapZoom={mapZoom}
        units={units} phase={phase} terrain={terrain}
        moveCells={moveCells} atkCells={atkCells} healCells={healCells}
        pathCells={pathCells} deployZone={deployZone}
        enemyRanges={enemyRanges}
        rangeEnemyIds={rangeEnemyIds}
        selId={selId} hoverCell={hoverCell}
        dmgPops={dmgPops} shaking={shaking}
        onCellClick={phase === 'deploy' ? handleDeployCellClick : handleCellClick}
        onCellRightClick={handleCellRightClick}
        onUnitClick={handleUnitClick}
        onUnitRightClick={handleUnitRightClick}
        onHover={handleHover}
        banner={banner}
        menuOpen={!!ctxMenu || mode === 'action' || !!statScreen}
      />

      {/* ログ */}
      <LogPanel log={log} phase={phase} stage={stage} turn={turn} />

      {/* マップ倍率トグル（右下） */}
      <ZoomToggle zoom={mapZoom} onToggle={toggleZoom} />

      {/* 配置UI */}
      {phase === 'deploy' && (
        <DeployUI
          roster={units.filter(u => u.team === 'player')}
          deployCount={deployCount}
          sortieLimit={sortieLimit}
          deploySelId={deploySelId}
          onSelect={handleDeploySelect}
          onStart={handleDeployStart}
        />
      )}

      {/* アクションメニュー */}
      {mode === 'action' && selUnit && (
        <ActionMenu
          unit={selUnit} units={units} menuPos={menuPos}
          onPlainAtk={handlePlainAtk}
          onTechSelect={handleTechSelect}
          onItemUse={handleItemUse}
          onWait={handleWait}
          onCancel={handleCancel}
          canCancel={!!origPos || !!noActionPosRef.current}
        />
      )}

      {/* 戦闘予測 */}
      {previewTarget && selUnit && (
        <BattlePreview
          attacker={selUnit} defender={previewTarget}
          tech={chosenTech} units={units}
        />
      )}

      {/* 右クリックメニュー */}
      {ctxMenu && phase === 'player' && (
        <ContextMenu
          pos={ctxMenu}
          onEndTurn={handleEndTurn}
          onClearMarks={() => { setRangeEnemyIds([]); setEnemyRanges([]); setCtxMenu(null); }}
          onClose={() => setCtxMenu(null)}
          hasMarks={rangeEnemyIds.length > 0}
        />
      )}

      {/* ステータス画面 */}
      {statScreen && (
        <StatusScreen
          unit={statScreen} units={units}
          onClose={() => setStatScreen(null)}
        />
      )}

      {/* ドラフト/CC */}
      {pendingLvUp && (
        <DraftUI
          unit={pendingLvUp.unit}
          gains={pendingLvUp.gains}
          parts={pendingLvUp.parts}
          ccOptions={pendingLvUp.ccOptions}
          units={units}
          onPickPart={handlePickPart}
          onSwapPart={handleSwapPart}
          onPickCC={handlePickCC}
        />
      )}

      {/* インターバル */}
      {phase === 'interval' && (
        <IntervalUI
          roster={roster}
          stage={stage}
          onNext={handleIntervalNext}
          onUnitClick={u => setStatScreen(u)}
          ccCurrent={ccCurrent}
          ccQueue={ccQueue}
          onCCSelect={handleIntervalCC}
          onCCDraft={handleIntervalCCDraft}
          onCCSwap={handleIntervalCCSwap}
        />
      )}

      {/* 合流フェーズ */}
      {phase === 'recruit' && recruitPhase && (
        <RecruitUI
          candidates={recruitPhase.candidates}
          picked={recruitPhase.picked}
          onToggle={handleRecruitToggle}
          onConfirm={handleRecruitConfirm}
          onUnitClick={u => setStatScreen(u)}
        />
      )}

      {/* ─── ゲームオーバー画面 ─── */}
      {gameOver === 'stageClear' && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300,
        }}>
          <div style={{ textAlign: 'center', animation: 's-fin 0.5s ease-out' }}>
            <div style={{
              fontSize: 40, fontWeight: 900, letterSpacing: 6, color: '#4ade80',
              textShadow: '0 0 40px rgba(74,222,128,0.5)', marginBottom: 4,
            }}>STAGE CLEAR</div>
            <div style={{ fontSize: 16, color: '#94a3b8', marginBottom: 16 }}>
              ステージ {stage + 1} / {NUM_STAGES}
            </div>
            <button onClick={advanceStage} style={{
              padding: '10px 32px', fontSize: 15, fontWeight: 700,
              background: 'linear-gradient(135deg,#22c55e,#16a34a)',
              color: '#fff', border: 'none', borderRadius: 6,
              cursor: 'pointer', letterSpacing: 2, fontFamily: 'inherit',
            }}>
              {stage >= NUM_STAGES - 1 ? '結果を見る' : '次のステージへ'}
            </button>
          </div>
        </div>
      )}

      {gameOver === 'defeat' && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300,
        }}>
          <div style={{ textAlign: 'center', animation: 's-fin 0.5s ease-out' }}>
            <div style={{
              fontSize: 48, fontWeight: 900, letterSpacing: 8, color: '#ef4444',
              textShadow: '0 0 40px rgba(239,68,68,0.5)', marginBottom: 16,
            }}>DEFEAT</div>
            <button onClick={handleReset} style={{
              padding: '10px 32px', fontSize: 15, fontWeight: 700,
              background: 'linear-gradient(135deg,#3b82f6,#2563eb)',
              color: '#fff', border: 'none', borderRadius: 6,
              cursor: 'pointer', letterSpacing: 2, fontFamily: 'inherit',
            }}>最初からやり直す</button>
          </div>
        </div>
      )}

      {gameOver === 'loopClear' && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300,
        }}>
          <div style={{ textAlign: 'center', animation: 's-fin 0.5s ease-out' }}>
            <div style={{
              fontSize: 52, fontWeight: 900, letterSpacing: 8, color: '#facc15',
              textShadow: '0 0 60px rgba(250,204,21,0.5)', marginBottom: 8,
            }}>LOOP CLEAR</div>
            <div style={{ fontSize: 16, color: '#94a3b8', marginBottom: 16 }}>
              全{NUM_STAGES}ステージ制覇
            </div>
            <button onClick={handleReset} style={{
              padding: '10px 32px', fontSize: 15, fontWeight: 700,
              background: 'linear-gradient(135deg,#facc15,#eab308)',
              color: '#1a1f35', border: 'none', borderRadius: 6,
              cursor: 'pointer', letterSpacing: 2, fontFamily: 'inherit',
            }}>新しいループを開始</button>
          </div>
        </div>
      )}
    </div>
    </ScreenScaler>
  );
}
