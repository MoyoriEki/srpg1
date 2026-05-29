// ═══ ドラフト抽選・パーツ適用・枠管理 ═══
import { DRAFT_PICKS, RARITY_RATES, TAG_WEIGHTS } from './constants.js';
import partsData from '../data/parts.json';
import { makeTech, getSlots, hasSkill, addTech, addSkill } from './units.js';

// コメント行（_comment）をフィルタリング
const ALL_PARTS = partsData.filter(p => !p._comment);

// ═══ ドラフト3択抽選 ═══

export function rollParts(unit, n = DRAFT_PICKS) {
  const t1 = unit.tags?.[0];
  const t2 = unit.tags?.[1];
  // 弱タグ: ユニットが持っていない属性
  const allTags = ['fire', 'water', 'wind'];
  const weak = allTags.find(t => t !== t1 && t !== t2) || 'any';

  // unique持ちで既に所持しているパーツ名を収集
  const ownedTechNames = new Set((unit.techs || []).map(t => t.name));
  const ownedSkillNames = new Set((unit.skills || []).map(s => s.name));

  const result = [];

  // 最大60回試行（重複回避）
  for (let i = 0; i < 60 && result.length < n; i++) {
    // レアリティ抽選
    const rr = Math.random() * 100;
    const rar = rr < RARITY_RATES.C ? 'C' : rr < RARITY_RATES.C + RARITY_RATES.U ? 'U' : 'R';

    // タグ抽選（tagA:38%, tagB:38%, weak:12%, neutral(light/dark/any):12%）
    const tr = Math.random() * 100;
    let tag;
    if (tr < TAG_WEIGHTS.tagA) tag = t1;
    else if (tr < TAG_WEIGHTS.tagA + TAG_WEIGHTS.tagB) tag = t2;
    else if (tr < TAG_WEIGHTS.tagA + TAG_WEIGHTS.tagB + TAG_WEIGHTS.weak) tag = weak;
    else tag = null; // neutral: light/dark/any

    // プール構築
    const pool = ALL_PARTS.filter(p => {
      // タグマッチ
      if (tag) {
        if (p.tag !== tag) return false;
      } else {
        // neutral: light, dark, none
        if (!['light', 'dark', 'none'].includes(p.tag)) return false;
      }
      // レアリティ
      if (p.rarity !== rar) return false;
      // 抽選結果内で重複しない
      if (result.some(r => r.id === p.id)) return false;
      // unique持ちで既に所持しているパーツを除外
      if (p.unique) {
        const name = p.type === 'tech' ? (p.techRef || p.name) : p.name;
        if (p.type === 'tech' && ownedTechNames.has(name)) return false;
        if (p.type === 'skill' && ownedSkillNames.has(name)) return false;
      }
      return true;
    });

    if (pool.length > 0) {
      result.push(pool[Math.floor(Math.random() * pool.length)]);
    }
  }

  return result;
}

// ═══ パーツ適用 ═══

export function applyPart(unit, part) {
  const u = cloneUnit(unit);
  const sl = getSlots(u);

  if (part.type === 'tech') {
    // 技パーツ: techRef経由でtechs.jsonから実体を引く
    const techName = part.techRef || part.name;
    const td = makeTech(techName);
    if (td && countSlotTechs(u) < sl.tech) {
      td._tag = part.tag;  // タグ情報を保持
      if (part.unique) td.unique = true;
      if (part.locked) td.locked = true;
      if (!addTech(u, td)) return u; // unique重複 → 何もしない
      // 技のonAcquireエフェクト処理
      for (const eff of (td.effects || [])) {
        if (eff.trigger !== 'onAcquire') continue;
        if (eff.type === 'system') handleSystemEffect(u, eff.system || eff.action, eff);
      }
    }
  } else if (part.type === 'skill') {
    if (countSlotSkills(u) < sl.skill) {
      const skillObj = {
        name: part.name,
        effects: part.effects || [],
        desc: part.desc || '',
        _tag: part.tag,
      };
      if (part.unique) skillObj.unique = true;
      if (part.locked) skillObj.locked = true;
      if (!addSkill(u, skillObj)) return u; // unique重複 → 何もしない

      // 即時効果: always/self/statMod でcond無しのものを適用
      for (const eff of (part.effects || [])) {
        if (eff.trigger === 'always' && eff.scope === 'self' && eff.type === 'statMod' && !eff.cond) {
          for (const [stat, val] of Object.entries(eff.mods || {})) {
            if (stat === 'hp') { u.maxHp += val; u.hp += val; }
            else if (stat === 'mov') { u.mov = Math.max(1, u.mov + val); }
            else if (stat === 'atk') { /* atkはSTR+PPなので直接加算しない */ }
            else { u[stat] = (u[stat] || 0) + val; }
          }
        }
        // rangeExtend: 射程+1（純近接除外）
        if (eff.trigger === 'always' && eff.type === 'rangeExtend') {
          u.techs = u.techs.map(t =>
            (t.rangeMin >= 2 || !eff.excludeMelee) ? { ...t, rangeMax: t.rangeMax + (eff.value || 1) } : t
          );
        }
        // onAcquire/system: 個別ハンドラ
        if (eff.trigger === 'onAcquire' && eff.type === 'system') {
          handleSystemEffect(u, eff.system || eff.action);
        }
      }
    }
  }

  return u;
}

// ═══ パーツ除去 ═══

export function removePart(unit, partName) {
  const u = cloneUnit(unit);

  // 技から探す
  const techIdx = u.techs.findIndex(t => t.name === partName);
  if (techIdx >= 0) {
    if (u.techs[techIdx].locked) return u; // 取り外し不可
    u.techs.splice(techIdx, 1);
    return u;
  }

  // スキルから探す
  const skillIdx = u.skills.findIndex(s => s.name === partName);
  if (skillIdx >= 0) {
    if (u.skills[skillIdx].locked) return u; // 取り外し不可
    const skill = u.skills[skillIdx];

    // effects配列ベースのステ巻き戻し
    const partDef = ALL_PARTS.find(p => p.name === partName);
    if (partDef) {
      for (const eff of (partDef.effects || [])) {
        if (eff.trigger === 'always' && eff.scope === 'self' && eff.type === 'statMod' && !eff.cond) {
          for (const [stat, val] of Object.entries(eff.mods || {})) {
            if (stat === 'hp') { u.maxHp -= val; u.hp = Math.min(u.hp, u.maxHp); }
            else if (stat === 'mov') { u.mov = Math.max(1, u.mov - val); }
            else if (stat === 'atk') { /* skip */ }
            else { u[stat] = (u[stat] || 0) - val; }
          }
        }
      }
    }

    u.skills.splice(skillIdx, 1);
    return u;
  }

  return u;
}

function handleSystemEffect(unit, system, eff) {
  switch (system) {
    case 'copySkill':
      if (unit.skills.length > 1) {
        const orig = unit.skills[0];
        addSkill(unit, { ...orig, name: orig.name + '(写)', desc: orig.desc || '' });
      }
      break;
    case 'darkWings':
      // 飛行+呪い1（飛行システム未実装）
      break;
    case 'cursedMask':
      // STR/INT/DEFから+2選択+呪い1（UI選択。仮実装: STR+2）
      unit.str += 2;
      break;
    case 'monsterCollar':
      // 魔物選択（UI選択。仮実装: nop）
      break;
    case 'angel':
      // 呪い全除去+ステ変動+飛行（呪いシステム未実装）
      break;
    case 'devilPact':
    case 'curseContract': {
      // カウンターをレベル数付与 + パーツ付与（データ駆動）
      const cn = eff?.counter || '呪い';
      if (!unit._counters) unit._counters = {};
      unit._counters[cn] = (unit._counters[cn] || 0) + unit.level;
      const contractPartIds = eff?.grantPartIds || [];
      if (!unit.extraParts) unit.extraParts = [];
      for (const pid of contractPartIds) {
        const part = ALL_PARTS.find(p => p.id === pid);
        if (!part) continue;
        if (unit.extraParts.some(p => p.id === pid)) continue;
        unit.extraParts.push({ ...part });
        // tech型ならtechsに追加（枠外）
        if (part.type === 'tech') {
          const techName = part.techRef || part.name;
          const td = makeTech(techName);
          if (td) {
            if (part.unique) td.unique = true;
            if (part.locked) td.locked = true;
            addTech(unit, td);
          }
        }
        // skill型ならskillsに追加（effectsを持たせる）
        if (part.type === 'skill') {
          const sk = {
            name: part.name,
            effects: part.effects || [],
            desc: part.desc || '',
            _tag: part.tag,
            _extra: true,
          };
          if (part.unique) sk.unique = true;
          if (part.locked) sk.locked = true;
          addSkill(unit, sk);
        }
      }
      break;
    }
  }
}

// ═══ 枠カウント（_extra除外） ═══

export function countSlotTechs(unit) {
  return (unit.techs || []).filter(t => !t._extra).length;
}
export function countSlotSkills(unit) {
  return (unit.skills || []).filter(s => !s._extra).length;
}

// ═══ 入れ替え可能パーツ一覧（locked/_extra除外） ═══

export function getRemovableParts(unit, type) {
  if (type === 'tech') return (unit.techs || []).filter(t => !t.locked && !t._extra);
  if (type === 'skill') return (unit.skills || []).filter(s => !s.locked && !s._extra);
  return [];
}

// ═══ パーツ入れ替え ═══

export function swapPart(unit, removeName, newPart) {
  const u = removePart(unit, removeName);
  return applyPart(u, newPart);
}

// ═══ ヘルパー ═══

function cloneUnit(unit) {
  return {
    ...unit,
    techs: unit.techs.map(t => ({ ...t })),
    skills: [...(unit.skills || [])],
    items: (unit.items || []).map(it => ({ ...it })),
    _counters: unit._counters ? { ...unit._counters } : undefined,
  };
}
