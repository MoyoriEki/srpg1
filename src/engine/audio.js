// ═══ BGM再生管理 ═══
// HTMLAudioElement + audio.loop。ogg形式固定。
// 全体ループのみ。イントロ付きループ・手動ループ監視なし。

let currentAudio = null;
let currentTrack = '';
let bgmVolume = 0.5;
let fadeInterval = null;

// ── localStorage音量保存 ──
const STORAGE_KEY = 'srpg_bgm_volume';
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved !== null) {
    const v = parseFloat(saved);
    if (!isNaN(v)) bgmVolume = Math.max(0, Math.min(1, v));
  }
} catch {}

function clearFade() {
  if (fadeInterval) { clearInterval(fadeInterval); fadeInterval = null; }
}

export function playBGM(track, { fade = 0 } = {}) {
  if (!track) { stopBGM({ fade }); return; }
  if (track === currentTrack && currentAudio && !currentAudio.paused) return;

  clearFade();
  if (currentAudio) { currentAudio.pause(); currentAudio.src = ''; currentAudio = null; }

  currentTrack = track;
  const audio = new Audio();
  audio.loop = true;
  audio.src = `${import.meta.env.BASE_URL}bgm/${track}.ogg?t=${Date.now()}`;
  audio.onerror = () => {
    console.warn(`BGM not found: ${import.meta.env.BASE_URL}bgm/${track}.ogg`);
    if (currentAudio === audio) { currentAudio = null; currentTrack = ''; }
  };
  currentAudio = audio;

  if (fade > 0) {
    audio.volume = 0;
    audio.play().catch(() => {});
    const step = 50;
    const inc = bgmVolume / (fade / step);
    fadeInterval = setInterval(() => {
      if (!currentAudio || currentAudio !== audio) { clearFade(); return; }
      audio.volume = Math.min(bgmVolume, audio.volume + inc);
      if (audio.volume >= bgmVolume) { audio.volume = bgmVolume; clearFade(); }
    }, step);
  } else {
    audio.volume = bgmVolume;
    audio.play().catch(() => {});
  }
}

export function stopBGM({ fade = 0 } = {}) {
  if (!currentAudio) { currentTrack = ''; return; }
  clearFade();

  if (fade > 0) {
    const audio = currentAudio;
    const startVol = audio.volume;
    const step = 50;
    const dec = startVol / (fade / step);
    fadeInterval = setInterval(() => {
      if (!audio || audio.paused) { clearFade(); return; }
      audio.volume = Math.max(0, audio.volume - dec);
      if (audio.volume <= 0) {
        audio.pause(); audio.src = ''; clearFade();
        if (currentAudio === audio) { currentAudio = null; currentTrack = ''; }
      }
    }, step);
  } else {
    currentAudio.pause(); currentAudio.src = '';
    currentAudio = null; currentTrack = '';
  }
}

export function setBGMVolume(vol) {
  bgmVolume = Math.max(0, Math.min(1, vol));
  if (currentAudio && !currentAudio.paused) currentAudio.volume = bgmVolume;
  try { localStorage.setItem(STORAGE_KEY, String(bgmVolume)); } catch {}
}

export function getBGMVolume() { return bgmVolume; }
