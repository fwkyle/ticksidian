/**
 * make-icon-transparent.mjs — 앱 아이콘 바깥 배경을 투명하게 만든다 (2026-08-18 [kyle] 요청).
 *
 * Why: 아이콘 세트(v2r)가 둥근 사각형 바깥까지 **불투명한 검정**으로 채워져 있어서,
 * Dock과 앱 전환기에서 검은 네모 배경이 그대로 보였다. 알파 채널은 있지만 완전 투명 픽셀이
 * 0개였다(실측: `RGBA 0,0,0,255`, 투명 0.0%).
 *
 * 방법: 네 모서리에서 flood fill로 **이어져 있는 거의-검정 픽셀만** 투명화한다.
 * 아이콘 안쪽 배경은 `(19~38)` 대역이라 임계값(<=10)에 걸리지 않아 그대로 남는다.
 * 단순히 "검정을 전부 투명화"하면 아이콘 안쪽에 구멍이 뚫린다.
 *
 * 외부 의존성 없이 Node 내장 zlib만으로 PNG를 읽고 쓴다(8-bit RGBA 전용).
 *
 * 실행: node scripts/make-icon-transparent.mjs <png...>
 *      node scripts/make-icon-transparent.mjs --check <png...>   # 검사만
 */

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

/** 바깥 배경으로 볼 밝기 상한. 아이콘 안쪽 배경은 19 이상이라 안전하다. */
const BACKGROUND_MAX_CHANNEL = 10;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function decodePng(buffer) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString("ascii", pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`8-bit RGBA PNG만 지원한다 (bitDepth=${bitDepth}, colorType=${colorType})`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p];
    p += 1;
    const line = raw.subarray(p, p + stride);
    p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += Math.floor((a + b) / 2);
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
  }
  return { width, height, stride, data: out };
}

export function encodePng({ width, height, stride, data }) {
  // 필터는 전부 0(None) — 크기보다 단순함을 택한다(아이콘은 작다).
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const chunk = (type, payload) => {
    const out = Buffer.alloc(payload.length + 12);
    out.writeUInt32BE(payload.length, 0);
    out.write(type, 4, "ascii");
    payload.copy(out, 8);
    const forCrc = Buffer.concat([Buffer.from(type, "ascii"), payload]);
    out.writeUInt32BE(crc32(forCrc), payload.length + 8);
    return out;
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * 네 모서리에서 이어진 "거의 검정" 영역만 투명으로 만든다.
 * 반환값은 투명 처리한 픽셀 수.
 */
export function clearOuterBackground(image, maxChannel = BACKGROUND_MAX_CHANNEL) {
  const { width, height, stride, data } = image;
  const seen = new Uint8Array(width * height);
  const queue = [];

  const isBackground = (x, y) => {
    const i = y * stride + x * 4;
    return data[i] <= maxChannel && data[i + 1] <= maxChannel && data[i + 2] <= maxChannel;
  };
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const key = y * width + x;
    if (seen[key]) return;
    seen[key] = 1;
    if (!isBackground(x, y)) return;
    queue.push(key);
  };

  push(0, 0);
  push(width - 1, 0);
  push(0, height - 1);
  push(width - 1, height - 1);

  let cleared = 0;
  while (queue.length > 0) {
    const key = queue.pop();
    const x = key % width;
    const y = (key - x) / width;
    data[y * stride + x * 4 + 3] = 0; // 알파만 0으로. RGB는 그대로 둔다.
    cleared += 1;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return cleared;
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const files = args.filter((a) => a !== "--check");
  if (files.length === 0) {
    console.error("사용법: node scripts/make-icon-transparent.mjs [--check] <png...>");
    process.exit(1);
  }

  for (const file of files) {
    const image = decodePng(readFileSync(file));
    const total = image.width * image.height;
    let already = 0;
    for (let i = 3; i < image.data.length; i += 4) if (image.data[i] === 0) already += 1;

    if (checkOnly) {
      console.log(
        `${file} (${image.width}x${image.height}) 투명 ${already}/${total} (${((already / total) * 100).toFixed(1)}%)`,
      );
      continue;
    }

    const cleared = clearOuterBackground(image);
    writeFileSync(file, encodePng(image));
    console.log(
      `${file} (${image.width}x${image.height}) 배경 ${cleared}px 투명화 (${((cleared / total) * 100).toFixed(1)}%)`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
