// PWA アイコン生成スクリプト（依存ゼロ・Node 標準のみ）
// 濃紺背景に水色のクリスタル菱形を描いた仮アイコンを出力する。
// デザインは後で自由に差し替えてOK。実行: node tools/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

// ─── CRC32（PNG チャンク用）───
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = buf => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
};

// ─── ピクセル描画 → PNG ───
function makePng(size) {
  const bg = [0x0a, 0x0e, 0x1e];   // 背景（濃紺）
  const fill = [0x1b, 0x3a, 0x5c]; // 菱形の塗り
  const edge = [0x5f, 0xe0, 0xff]; // 菱形の縁（水色）
  const cx = (size - 1) / 2, cy = (size - 1) / 2;
  const R = size * 0.34;           // 菱形の半径（マンハッタン）

  // 行ごとにフィルタバイト(0)を先頭に付けた RGBA データ
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      let col = bg;
      if (d < R) col = fill;
      if (d >= R * 0.78 && d < R) col = edge;        // 外周の縁
      // 中央の十字グリント
      if (d < R * 0.66 && (Math.abs(x - cx) < size * 0.018 || Math.abs(y - cy) < size * 0.018)) col = edge;
      const o = y * stride + 1 + x * 4;
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2]; raw[o + 3] = 0xff;
    }
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit, RGBA
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [192, 512]) {
  const p = join(OUT, `icon-${size}.png`);
  writeFileSync(p, makePng(size));
  console.log('wrote', p);
}
