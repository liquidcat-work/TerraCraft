// GZip compress a string using the browser's CompressionStream API
export async function compress(str) {
  const encoder = new TextEncoder();
  const input = encoder.encode(str);
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(input);
  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  let bin = "";
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
  return btoa(bin);
}

// GZip decompress a base64 string
export async function decompress(b64) {
  const bin = atob(b64);
  const input = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) input[i] = bin.charCodeAt(i);
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(input);
  writer.close();
  const chunks = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return new TextDecoder().decode(out);
}

const WORLDS_LIST_KEY = "mproj-worlds";
const EDITS_PREFIX = "mproj-edits-";
const META_PREFIX = "mproj-meta-";

export function loadWorldsList() {
  try { return JSON.parse(localStorage.getItem(WORLDS_LIST_KEY) || "[]"); }
  catch { return []; }
}

export function saveWorldsList(worlds) {
  localStorage.setItem(WORLDS_LIST_KEY, JSON.stringify(worlds));
}

export function loadWorldMeta(worldId) {
  try { return JSON.parse(localStorage.getItem(META_PREFIX + worldId) || "null"); }
  catch { return null; }
}

export function saveWorldMeta(worldId, meta) {
  localStorage.setItem(META_PREFIX + worldId, JSON.stringify(meta));
}

export async function saveWorldEdits(worldId, editMap) {
  const raw = {};
  for (const [key, map] of editMap.entries()) {
    if (!map || map.size === 0) continue;
    const flat = [];
    for (const [voxel, blockId] of map.entries()) flat.push(voxel, blockId);
    raw[key] = flat;
  }
  const json = JSON.stringify(raw);
  try {
    const compressed = await compress(json);
    localStorage.setItem(EDITS_PREFIX + worldId, compressed);
  } catch {
    localStorage.setItem(EDITS_PREFIX + worldId, json);
  }
}

export async function loadWorldEdits(worldId) {
  const stored = localStorage.getItem(EDITS_PREFIX + worldId);
  if (!stored) return new Map();
  let json;
  try { json = await decompress(stored); }
  catch { json = stored; }
  try {
    const raw = JSON.parse(json);
    const edits = new Map();
    for (const [key, flat] of Object.entries(raw)) {
      const map = new Map();
      for (let i = 0; i < flat.length; i += 2) map.set(flat[i], flat[i + 1]);
      edits.set(key, map);
    }
    return edits;
  } catch { return new Map(); }
}

export function deleteWorldData(worldId) {
  localStorage.removeItem(META_PREFIX + worldId);
  localStorage.removeItem(EDITS_PREFIX + worldId);
}
