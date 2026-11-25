// Small, dependency-free readers and writers for the campus scan pipeline (build-campus-scan.mjs):
// a GeoTIFF reader (float32, LZW or Deflate, tiled or stripped, any overview level), a streaming
// reader for Agisoft Metashape OBJ exports (lon / lat / elevation vertices with RGB colours), and a
// PNG writer for debug images and game assets.

import { createReadStream, openSync, readSync, closeSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';

// ------------------------------------------------------------------ GeoTIFF

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8 };

/** TIFF LZW (MSB-first codes, early change), as used by GDAL and Metashape. */
function lzwDecode(src, outLen) {
  const out = new Uint8Array(outLen);
  let op = 0;
  const dictStart = new Int32Array(4096);
  const dictLen = new Int32Array(4096);
  // The dictionary entries point into `out` (each entry is a previous string plus one byte).
  let next = 258;
  let width = 9;
  let bitPos = 0;
  const totalBits = src.length * 8;
  const read = () => {
    if (bitPos + width > totalBits) return 257;
    let v = 0;
    for (let i = 0; i < width; i += 1) {
      const bit = (src[(bitPos + i) >> 3] >> (7 - ((bitPos + i) & 7))) & 1;
      v = (v << 1) | bit;
    }
    bitPos += width;
    return v;
  };
  let prevStart = -1;
  let prevLen = 0;
  for (;;) {
    const code = read();
    if (code === 257) break;
    if (code === 256) {
      next = 258;
      width = 9;
      prevStart = -1;
      continue;
    }
    let start;
    let len;
    if (code < 256) {
      if (op >= outLen) break;
      out[op] = code;
      start = op;
      len = 1;
      op += 1;
    } else if (code < next) {
      start = op;
      len = dictLen[code];
      if (op + len > outLen) len = outLen - op;
      out.copyWithin(op, dictStart[code], dictStart[code] + len);
      op += len;
    } else {
      // KwKwK: previous string plus its own first byte.
      start = op;
      len = prevLen + 1;
      if (op + len > outLen) break;
      out.copyWithin(op, prevStart, prevStart + prevLen);
      out[op + prevLen] = out[prevStart];
      op += len;
    }
    if (prevStart >= 0 && next < 4096) {
      dictStart[next] = prevStart;
      dictLen[next] = prevLen + 1;
      next += 1;
    }
    prevStart = start;
    prevLen = len;
    if (next + 1 >= 1 << width && width < 12) width += 1;
    if (op >= outLen) break;
  }
  return out;
}

/**
 * Reads one image (IFD `level`: 0 full resolution, 1.. overviews) of a single-band float32 GeoTIFF
 * in geographic coordinates. Returns the raster with its top-left corner and pixel size in degrees.
 */
export function readGeoTiff(path, level = 0) {
  const fd = openSync(path, 'r');
  const read = (off, len) => {
    const b = Buffer.alloc(len);
    readSync(fd, b, 0, len, off);
    return b;
  };
  const head = read(0, 16);
  const le = head.toString('ascii', 0, 2) === 'II';
  const u16 = (b, o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (b, o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const big = u16(head, 2) === 43;
  const u64 = (b, o) => Number(le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o));
  let ifd = big ? u64(head, 8) : u32(head, 4);
  for (let i = 0; i < level; i += 1) {
    const n = big ? u64(read(ifd, 8), 0) : u16(read(ifd, 2), 0);
    const es = big ? 20 : 12;
    const tail = read(ifd + (big ? 8 : 2) + n * es, 8);
    ifd = big ? u64(tail, 0) : u32(tail, 0);
    if (!ifd) throw new Error(`no image level ${level}`);
  }
  const n = big ? u64(read(ifd, 8), 0) : u16(read(ifd, 2), 0);
  const es = big ? 20 : 12;
  const body = read(ifd + (big ? 8 : 2), n * es);
  const tags = new Map();
  for (let i = 0; i < n; i += 1) {
    const e = i * es;
    const tag = u16(body, e);
    const type = u16(body, e + 2);
    const cnt = big ? u64(body, e + 4) : u32(body, e + 4);
    const size = (TYPE_SIZE[type] ?? 1) * cnt;
    const inl = big ? 8 : 4;
    const vb = size <= inl ? body.subarray(e + (big ? 12 : 8), e + (big ? 12 : 8) + size) : read(big ? u64(body, e + 12) : u32(body, e + 8), size);
    const vals = [];
    for (let j = 0; j < cnt; j += 1) {
      if (type === 3) vals.push(u16(vb, j * 2));
      else if (type === 4) vals.push(u32(vb, j * 4));
      else if (type === 16) vals.push(u64(vb, j * 8));
      else if (type === 12) vals.push(le ? vb.readDoubleLE(j * 8) : vb.readDoubleBE(j * 8));
      else if (type === 2) { vals.push(vb.toString('ascii', 0, cnt)); break; }
      else break;
    }
    tags.set(tag, vals);
  }
  const W = tags.get(256)[0];
  const H = tags.get(257)[0];
  if (tags.get(258)?.[0] !== 32 || (tags.get(339)?.[0] ?? 1) !== 3) throw new Error('expected float32 samples');
  const comp = tags.get(259)?.[0] ?? 1;
  const pred = tags.get(317)?.[0] ?? 1;
  const scale = tags.get(33550);
  const tie = tags.get(33922);
  const nodataStr = tags.get(42113)?.[0];
  const nodata = nodataStr !== undefined ? parseFloat(nodataStr) : NaN;
  const tiled = tags.has(322);
  const tw = tiled ? tags.get(322)[0] : W;
  const th = tiled ? tags.get(323)[0] : tags.get(278)?.[0] ?? H;
  const offs = tiled ? tags.get(324) : tags.get(273);
  const lens = tiled ? tags.get(325) : tags.get(279);
  const data = new Float32Array(W * H).fill(NaN);
  const across = Math.ceil(W / tw);
  for (let t = 0; t < offs.length; t += 1) {
    if (!lens[t]) continue;
    const raw = read(offs[t], lens[t]);
    const bytes = tw * th * 4;
    let buf;
    if (comp === 1) buf = raw;
    else if (comp === 5) buf = lzwDecode(raw, bytes);
    else if (comp === 8 || comp === 32946) buf = inflateSync(raw);
    else throw new Error(`unsupported compression ${comp}`);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const tx = (t % across) * tw;
    const ty = Math.floor(t / across) * th;
    for (let y = 0; y < th; y += 1) {
      const gy = ty + y;
      if (gy >= H) break;
      let prev = 0;
      for (let x = 0; x < tw; x += 1) {
        const gx = tx + x;
        const o = (y * tw + x) * 4;
        if (o + 4 > buf.length) break;
        let v = view.getFloat32(o, le);
        if (pred === 3) throw new Error('floating-point predictor not supported');
        void prev;
        if (gx >= W) continue;
        if (v === nodata || v < -1e4 || !Number.isFinite(v)) v = NaN;
        data[gy * W + gx] = v;
      }
    }
  }
  closeSync(fd);
  return { w: W, h: H, data, lon0: tie[3], lat0: tie[4], dlon: scale[0], dlat: scale[1] };
}

// ------------------------------------------------------------------ OBJ (Metashape, vertex colours)

/**
 * Streams a Metashape OBJ: `v lon lat elev r g b` vertices and `f a//a b//b c//c` triangles.
 * Vertices are handed to `onVertex(lon, lat, elev, r, g, b)` in order; faces to `onFace(i0, i1, i2)`
 * (0-based). Parsing is by hand over raw chunks: readline is several times slower on 400 MB.
 */
export async function streamObj(path, onVertex, onFace) {
  const stream = createReadStream(path, { highWaterMark: 1 << 22 });
  let rest = '';
  let nv = 0;
  let nf = 0;
  const line = (s) => {
    if (s.charCodeAt(0) === 118 && s.charCodeAt(1) === 32) {
      const p = s.split(' ');
      onVertex(+p[1], +p[2], +p[3], p.length > 6 ? +p[4] : 0.5, p.length > 6 ? +p[5] : 0.5, p.length > 6 ? +p[6] : 0.5);
      nv += 1;
    } else if (s.charCodeAt(0) === 102 && s.charCodeAt(1) === 32) {
      const p = s.split(' ');
      const idx = (t) => parseInt(t, 10) - 1;
      const a = idx(p[1]);
      for (let i = 3; i < p.length; i += 1) {
        if (!p[i]) continue;
        onFace(a, idx(p[i - 1]), idx(p[i]));
        nf += 1;
      }
    }
  };
  for await (const chunk of stream) {
    const text = rest + chunk.toString('latin1');
    let start = 0;
    for (;;) {
      const nl = text.indexOf('\n', start);
      if (nl < 0) break;
      let end = nl;
      if (text.charCodeAt(end - 1) === 13) end -= 1;
      if (end > start) line(text.slice(start, end));
      start = nl + 1;
    }
    rest = text.slice(start);
  }
  if (rest) line(rest.trim());
  return { vertices: nv, faces: nf };
}

// ------------------------------------------------------------------ PNG

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Writes an 8-bit PNG: `channels` 1 (grey), 3 (RGB) or 4 (RGBA), rows top to bottom. */
export async function writePng(path, w, h, pixels, channels) {
  const ct = { 1: 0, 3: 2, 4: 6 }[channels];
  const stride = w * channels;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let i = 0; i < stride; i += 1) raw[y * (stride + 1) + 1 + i] = pixels[y * stride + i];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = ct;
  await writeFile(path, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}
