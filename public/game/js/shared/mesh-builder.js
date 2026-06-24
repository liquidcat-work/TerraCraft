import { ATLAS_COLUMNS, ATLAS_ROWS, CHUNK_HEIGHT, CHUNK_SIZE, expandedVoxelIndex, clamp } from "./config.js";
import { BLOCK, faceTileForBlock, isOpaque, isSolid, LIGHT_EMISSION, LIGHT_OPACITY, LIGHT_COLOR, MAX_LIGHT } from "./blocks.js";

// ─── Pre-baked UV origin/scale per tile ─────────────────────────────────────
const TILE_U0 = new Float32Array(ATLAS_COLUMNS * ATLAS_ROWS);
const TILE_V0 = new Float32Array(ATLAS_COLUMNS * ATLAS_ROWS);
const TILE_DU = 1 / ATLAS_COLUMNS;
const TILE_DV = 1 / ATLAS_ROWS;

for (let i = 0; i < ATLAS_COLUMNS * ATLAS_ROWS; i++) {
  const col = i % ATLAS_COLUMNS;
  const row = Math.floor(i / ATLAS_COLUMNS);
  TILE_U0[i] = col * TILE_DU;
  TILE_V0[i] = 1 - (row + 1) * TILE_DV;
}

// ─── Fixed-capacity collector ────────────────────────────────────────────────
const MAX_QUADS = 131072;
const FLOATS_PER_QUAD_POS = 12;
const FLOATS_PER_QUAD_NRM = 12;
const FLOATS_PER_QUAD_UV  = 8;   // raw tiling UVs (0..w, 0..h)
const FLOATS_PER_QUAD_TO  = 8;   // tileOrigin (u0, v0) per vertex
const FLOATS_PER_QUAD_AO  = 4;   // one ao value per vertex (0..1)
const FLOATS_PER_QUAD_LT  = 16;  // (sky, blockR, blockG, blockB) per vertex, 0..1 each
const INTS_PER_QUAD_IDX   = 6;

function makeBuf() {
  return {
    pos: new Float32Array(MAX_QUADS * FLOATS_PER_QUAD_POS),
    nrm: new Float32Array(MAX_QUADS * FLOATS_PER_QUAD_NRM),
    uvs: new Float32Array(MAX_QUADS * FLOATS_PER_QUAD_UV),
    tileOrigins: new Float32Array(MAX_QUADS * FLOATS_PER_QUAD_TO),
    aos: new Float32Array(MAX_QUADS * FLOATS_PER_QUAD_AO),
    lts: new Float32Array(MAX_QUADS * FLOATS_PER_QUAD_LT),
    idx: new Uint32Array(MAX_QUADS * INTS_PER_QUAD_IDX),
    n: 0
  };
}

const _oBuf = makeBuf();
const _wBuf = makeBuf();

function resetBuf(b) { b.n = 0; }

const _emptyF32 = new Float32Array(0);
const _emptyU32 = new Uint32Array(0);

// ─── Scratch buffers reused inside the meshing hot path ─────────────────────
// The mesh builder runs single-threaded inside a worker, so module-level
// scratch state is safe and eliminates millions of short-lived allocations
// per chunk build.
const _coordScratch = new Int32Array(3);
const _aoFront = new Int32Array(3);
const _aoSideU = new Int32Array(3);
const _aoSideV = new Int32Array(3);
const _aoCorn  = new Int32Array(3);
const _aoSamples = [_aoFront, _aoSideU, _aoSideV, _aoCorn];
const _rawUVs = new Float32Array(8);

// Push a greedy-merged quad with per-vertex AO values (0..1).
// aoCorners is [c0, c1, c2, c3] matching the 4 vertex order.
function pushGreedyQuad(buf, positions, nx, ny, nz, tile, uSpan, vSpan,
                        aoCorners, skyCorners,
                        blockRCorners, blockGCorners, blockBCorners) {
  const base = buf.n;
  const pi = base * FLOATS_PER_QUAD_POS;
  const ni = base * FLOATS_PER_QUAD_NRM;
  const ui = base * FLOATS_PER_QUAD_UV;
  const ti = base * FLOATS_PER_QUAD_TO;
  const ai = base * FLOATS_PER_QUAD_AO;
  const li = base * FLOATS_PER_QUAD_LT;
  const ii = base * INTS_PER_QUAD_IDX;
  const vi = base * 4;

  const u0 = TILE_U0[tile], v0 = TILE_V0[tile];

  // Raw tiling UVs: 0..span so fract() repeats per block. Reuse module-level
  // scratch buffer to avoid a fresh allocation per quad.
  const rawUVs = _rawUVs;
  rawUVs[0] = 0;     rawUVs[1] = vSpan;
  rawUVs[2] = 0;     rawUVs[3] = 0;
  rawUVs[4] = uSpan; rawUVs[5] = vSpan;
  rawUVs[6] = uSpan; rawUVs[7] = 0;

  for (let c = 0; c < 4; c++) {
    const p = c * 3;
    buf.pos[pi + p]     = positions[p];
    buf.pos[pi + p + 1] = positions[p + 1];
    buf.pos[pi + p + 2] = positions[p + 2];
    buf.nrm[ni + p]     = nx;
    buf.nrm[ni + p + 1] = ny;
    buf.nrm[ni + p + 2] = nz;
    const u = c * 2;
    buf.uvs[ui + u]     = rawUVs[u];
    buf.uvs[ui + u + 1] = rawUVs[u + 1];
    buf.tileOrigins[ti + u]     = u0;
    buf.tileOrigins[ti + u + 1] = v0;
    buf.aos[ai + c] = aoCorners[c];
    buf.lts[li + c * 4]     = skyCorners[c];
    buf.lts[li + c * 4 + 1] = blockRCorners[c];
    buf.lts[li + c * 4 + 2] = blockGCorners[c];
    buf.lts[li + c * 4 + 3] = blockBCorners[c];
  }

  // ── Flip quad diagonal so AO interpolates without "anisotropy" artifact ──
  // Standard trick: if (ao0 + ao3) > (ao1 + ao2) use 0-1-2 / 2-1-3, else 0-3-1 / 0-2-3
  if (aoCorners[0] + aoCorners[3] > aoCorners[1] + aoCorners[2]) {
    buf.idx[ii]     = vi;
    buf.idx[ii + 1] = vi + 1;
    buf.idx[ii + 2] = vi + 2;
    buf.idx[ii + 3] = vi + 2;
    buf.idx[ii + 4] = vi + 1;
    buf.idx[ii + 5] = vi + 3;
  } else {
    buf.idx[ii]     = vi;
    buf.idx[ii + 1] = vi + 1;
    buf.idx[ii + 2] = vi + 3;
    buf.idx[ii + 3] = vi;
    buf.idx[ii + 4] = vi + 3;
    buf.idx[ii + 5] = vi + 2;
  }

  buf.n++;
}

function finalize(buf) {
  const n = buf.n;
  if (n === 0) {
    return { positions: _emptyF32, normals: _emptyF32, uvs: _emptyF32, tileOrigins: _emptyF32, aos: _emptyF32, lights: _emptyF32, indices: _emptyU32 };
  }
  return {
    positions:   buf.pos.slice(0, n * FLOATS_PER_QUAD_POS),
    normals:     buf.nrm.slice(0, n * FLOATS_PER_QUAD_NRM),
    uvs:         buf.uvs.slice(0, n * FLOATS_PER_QUAD_UV),
    tileOrigins: buf.tileOrigins.slice(0, n * FLOATS_PER_QUAD_TO),
    aos:         buf.aos.slice(0, n * FLOATS_PER_QUAD_AO),
    lights:      buf.lts.slice(0, n * FLOATS_PER_QUAD_LT),
    indices:     buf.idx.slice(0, n * INTS_PER_QUAD_IDX)
  };
}

function shouldRenderFace(blockId, neighborId) {
  if (neighborId === BLOCK.AIR) return true;
  if (blockId === BLOCK.WATER) return neighborId !== BLOCK.WATER && !isSolid(neighborId);
  if (neighborId === BLOCK.WATER) return true;
  return !isOpaque(neighborId);
}

// Standard Mojang AO formula. side1, side2, corner are 1 if solid+opaque, else 0.
// Returns 0 (darkest) .. 3 (brightest).
function vertexAO(side1, side2, corner) {
  if (side1 && side2) return 0;
  return 3 - (side1 + side2 + corner);
}

// Greedy meshing mask: stores tile index (0 = no face, >0 = tile+1) for each cell in a 2D slice
const _mask     = new Int16Array(CHUNK_SIZE * CHUNK_SIZE); // tile+1, 0=empty
const _maskType = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE); // 0=opaque, 1=water
const _maskAO   = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 4); // 4 corner AO values per cell (0..3)
// 4 corners × per-channel light per cell, stored as 0..15.
const _maskSky    = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 4);
const _maskBlockR = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 4);
const _maskBlockG = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 4);
const _maskBlockB = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 4);

/* ──────────────────────────────────────────────────────────────────────────
 * Light propagation (Minecraft-style smooth lighting)
 * Two channels: skylight + blocklight, each 0..15.
 *
 * Skylight init: column-cast — for each (x,z) walk down from the top of the
 *   expanded chunk; cells stay at 15 until we hit the first opaque block,
 *   then drop to 0. Then BFS spreads sideways under overhangs / through
 *   non-opaque cells at attenuation = LIGHT_OPACITY (min 1).
 * Blocklight init: every emitter (LIGHT_EMISSION > 0) seeds its own value;
 *   BFS spreads with per-step attenuation = max(1, LIGHT_OPACITY).
 *
 * Both passes run on the 34×34×34 expanded chunk so per-vertex smoothing
 * has 1-cell of border data on every side.
 * ────────────────────────────────────────────────────────────────────────── */
let _skyLight   = null;
let _blockR     = null;
let _blockG     = null;
let _blockB     = null;
let _bfsQueue   = null;
let _bfsCap     = 0;

function _ensureLightBuffers(volume) {
  if (!_skyLight || _skyLight.length !== volume) {
    _skyLight   = new Uint8Array(volume);
    _blockR     = new Uint8Array(volume);
    _blockG     = new Uint8Array(volume);
    _blockB     = new Uint8Array(volume);
  }
  // Reusable BFS ring buffer of 32-bit ints holding (idx<<4)|level
  if (!_bfsQueue || _bfsCap < volume) {
    _bfsCap = volume;
    _bfsQueue = new Int32Array(volume);
  }
}

/* Border layout helpers — each face is a Uint8Array indexed in a fixed
 * order so the producer (neighbor's inner edge) and consumer (this
 * chunk's outer border) agree.
 *   nx / px : constant x, indexed [y * width + z]   size = height*width
 *   nz / pz : constant z, indexed [y * width + x]   size = height*width
 *   ny / py : constant y, indexed [z * width + x]   size = width*width
 */
function _faceIdxToChunkIdx(face, k, width, height) {
  const stride = width * width, zStride = width;
  switch (face) {
    case "nx": { const y = (k / width) | 0, z = k - y * width; return y * stride + z * zStride + 0; }
    case "px": { const y = (k / width) | 0, z = k - y * width; return y * stride + z * zStride + (width - 1); }
    case "nz": { const y = (k / width) | 0, x = k - y * width; return y * stride + 0 * zStride + x; }
    case "pz": { const y = (k / width) | 0, x = k - y * width; return y * stride + (width - 1) * zStride + x; }
    case "ny": { const z = (k / width) | 0, x = k - z * width; return 0 * stride + z * zStride + x; }
    case "py": { const z = (k / width) | 0, x = k - z * width; return (height - 1) * stride + z * zStride + x; }
  }
  return -1;
}

function _applyBorderSeeds(seedBorders, channelKey, arr, width, height, queue, qTail) {
  const faces = ["nx", "px", "nz", "pz", "ny", "py"];
  for (let f = 0; f < 6; f++) {
    const face = faces[f];
    const entry = seedBorders[face];
    if (!entry) continue;
    const data = entry[channelKey];
    if (!data) continue;
    const len = data.length;
    for (let k = 0; k < len; k++) {
      const v = data[k];
      if (v === 0) continue;
      const idx = _faceIdxToChunkIdx(face, k, width, height);
      if (idx < 0) continue;
      if (v > arr[idx]) {
        arr[idx] = v;
        if (v > 1 && qTail < _bfsCap) queue[qTail++] = (idx << 4) | v;
      }
    }
  }
  return qTail;
}

/* Extract this chunk's outgoing edge light — the slab one cell inside the
 * expanded border on each of the 6 faces. These are the values the
 * neighbor chunk will inject as border seeds on its corresponding face. */
function _extractOutgoingEdges(width, height) {
  const stride = width * width, zStride = width;
  const planeYZ = height * width;       // for ±X faces
  const planeXY = height * width;       // for ±Z faces
  const planeXZ = width  * width;       // for ±Y faces

  function alloc(n) {
    return { sky: new Uint8Array(n), br: new Uint8Array(n), bg: new Uint8Array(n), bb: new Uint8Array(n) };
  }
  const edges = {
    nx: alloc(planeYZ), px: alloc(planeYZ),
    nz: alloc(planeXY), pz: alloc(planeXY),
    ny: alloc(planeXZ), py: alloc(planeXZ),
  };

  // ±X: inner edge x=1 (out toward -X) and x=width-2 (out toward +X).
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < width; z++) {
      const k = y * width + z;
      const iNx = y * stride + z * zStride + 1;
      const iPx = y * stride + z * zStride + (width - 2);
      edges.nx.sky[k] = _skyLight[iNx]; edges.nx.br[k] = _blockR[iNx]; edges.nx.bg[k] = _blockG[iNx]; edges.nx.bb[k] = _blockB[iNx];
      edges.px.sky[k] = _skyLight[iPx]; edges.px.br[k] = _blockR[iPx]; edges.px.bg[k] = _blockG[iPx]; edges.px.bb[k] = _blockB[iPx];
    }
  }
  // ±Z: inner edge z=1 / z=width-2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = y * width + x;
      const iNz = y * stride + 1 * zStride + x;
      const iPz = y * stride + (width - 2) * zStride + x;
      edges.nz.sky[k] = _skyLight[iNz]; edges.nz.br[k] = _blockR[iNz]; edges.nz.bg[k] = _blockG[iNz]; edges.nz.bb[k] = _blockB[iNz];
      edges.pz.sky[k] = _skyLight[iPz]; edges.pz.br[k] = _blockR[iPz]; edges.pz.bg[k] = _blockG[iPz]; edges.pz.bb[k] = _blockB[iPz];
    }
  }
  // ±Y: inner layer y=1 / y=height-2
  for (let z = 0; z < width; z++) {
    for (let x = 0; x < width; x++) {
      const k = z * width + x;
      const iNy = 1 * stride + z * zStride + x;
      const iPy = (height - 2) * stride + z * zStride + x;
      edges.ny.sky[k] = _skyLight[iNy]; edges.ny.br[k] = _blockR[iNy]; edges.ny.bg[k] = _blockG[iNy]; edges.ny.bb[k] = _blockB[iNy];
      edges.py.sky[k] = _skyLight[iPy]; edges.py.br[k] = _blockR[iPy]; edges.py.bg[k] = _blockG[iPy]; edges.py.bb[k] = _blockB[iPy];
    }
  }
  return edges;
}

function computeChunkLight(expandedBlocks, width, height, skyOpenToChunk = true, skyHeights = null, cyOrigin = 0, seedBorders = null) {
  const volume = width * width * height;
  _ensureLightBuffers(volume);
  _skyLight.fill(0);
  _blockR.fill(0);
  _blockG.fill(0);
  _blockB.fill(0);

  const stride = width * width;     // y-stride
  const zStride = width;            // z-stride
  const queue = _bfsQueue;
  let qHead = 0, qTail = 0;

  // ── Skylight seed (column-based on absolute world Y) ───────────────────
  // For every (x,z) column we know the world-Y of the terrain surface
  // (skyHeights). Any cell with worldY > skyHeight is "open sky" and
  // starts at MAX_LIGHT. Walking top-down, transparent cells in open sky
  // stay bright; the first opaque cell stops the column. This is the
  // standard Minecraft skylight seed and works correctly for every
  // vertical chunk, including ones far above or below the surface.
  for (let z = 0; z < width; z++) {
    for (let x = 0; x < width; x++) {
      const colSkyH = skyHeights ? skyHeights[z * width + x]
                                 : (skyOpenToChunk ? -32768 : 32767);
      let blocked = false;
      for (let y = height - 1; y >= 0; y--) {
        // expanded coord y=0 → worldY = cyOrigin - 1
        const worldY = cyOrigin + y - 1;
        const idx = y * stride + z * zStride + x;
        const opa = LIGHT_OPACITY[expandedBlocks[idx]];
        if (blocked) {
          _skyLight[idx] = 0;
          continue;
        }
        if (worldY > colSkyH) {
          // Open sky above the terrain surface → full daylight.
          if (opa >= MAX_LIGHT) { blocked = true; _skyLight[idx] = 0; continue; }
          _skyLight[idx] = MAX_LIGHT;
          // Seed BFS so horizontal spread under overhangs works.
          queue[qTail++] = (idx << 4) | MAX_LIGHT;
        } else {
          // Below terrain: assume dark until BFS proves otherwise.
          if (opa >= MAX_LIGHT) blocked = true;
          _skyLight[idx] = 0;
        }
      }
    }
  }

  // ── Apply neighbor-supplied border seeds for skylight ────────────────
  // Each face is a flat Uint8Array sized to the expanded plane. These
  // values come from the inside edge of the adjacent chunk and let light
  // (sun or torch) cross chunk seams instead of dying at the border.
  if (seedBorders) qTail = _applyBorderSeeds(seedBorders, "sky", _skyLight, width, height, queue, qTail);

  // ── Skylight horizontal BFS ────────────────────────────────────────────
  while (qHead < qTail) {
    const packed = queue[qHead++];
    const idx = packed >>> 4;
    const lvl = packed & 0xF;
    if (lvl <= 1) continue;
    if (_skyLight[idx] > lvl) continue; // stale
    const y = (idx / stride) | 0;
    const rem = idx - y * stride;
    const z = (rem / zStride) | 0;
    const x = rem - z * zStride;

    // 6-neighborhood
    // -x
    if (x > 0) {
      const nIdx = idx - 1;
      const opa  = Math.max(1, LIGHT_OPACITY[expandedBlocks[nIdx]]);
      const nl = lvl - opa;
      if (nl > _skyLight[nIdx]) {
        _skyLight[nIdx] = nl;
        if (nl > 1 && qTail < _bfsCap) queue[qTail++] = (nIdx << 4) | nl;
      }
    }
    // +x
    if (x < width - 1) {
      const nIdx = idx + 1;
      const opa  = Math.max(1, LIGHT_OPACITY[expandedBlocks[nIdx]]);
      const nl = lvl - opa;
      if (nl > _skyLight[nIdx]) {
        _skyLight[nIdx] = nl;
        if (nl > 1 && qTail < _bfsCap) queue[qTail++] = (nIdx << 4) | nl;
      }
    }
    // -z
    if (z > 0) {
      const nIdx = idx - zStride;
      const opa  = Math.max(1, LIGHT_OPACITY[expandedBlocks[nIdx]]);
      const nl = lvl - opa;
      if (nl > _skyLight[nIdx]) {
        _skyLight[nIdx] = nl;
        if (nl > 1 && qTail < _bfsCap) queue[qTail++] = (nIdx << 4) | nl;
      }
    }
    // +z
    if (z < width - 1) {
      const nIdx = idx + zStride;
      const opa  = Math.max(1, LIGHT_OPACITY[expandedBlocks[nIdx]]);
      const nl = lvl - opa;
      if (nl > _skyLight[nIdx]) {
        _skyLight[nIdx] = nl;
        if (nl > 1 && qTail < _bfsCap) queue[qTail++] = (nIdx << 4) | nl;
      }
    }
    // -y (but skylight already handled top-down via column cast for full-bright;
    // this handles spread under overhangs)
    if (y > 0) {
      const nIdx = idx - stride;
      const opa  = Math.max(1, LIGHT_OPACITY[expandedBlocks[nIdx]]);
      const nl = lvl - opa;
      if (nl > _skyLight[nIdx]) {
        _skyLight[nIdx] = nl;
        if (nl > 1 && qTail < _bfsCap) queue[qTail++] = (nIdx << 4) | nl;
      }
    }
    // +y
    if (y < height - 1) {
      const nIdx = idx + stride;
      const opa  = Math.max(1, LIGHT_OPACITY[expandedBlocks[nIdx]]);
      const nl = lvl - opa;
      if (nl > _skyLight[nIdx]) {
        _skyLight[nIdx] = nl;
        if (nl > 1 && qTail < _bfsCap) queue[qTail++] = (nIdx << 4) | nl;
      }
    }
  }

  // ── Blocklight: 3 BFS passes (R, G, B) ────────────────────────────────
  // Each emitter seeds each channel scaled by its color (0..255 → 0..emission).
  // Channels propagate independently with the same opacity attenuation.
  const channels = [_blockR, _blockG, _blockB];
  const chanNames = ["br", "bg", "bb"];
  for (let ch = 0; ch < 3; ch++) {
    const arr = channels[ch];
    qHead = 0; qTail = 0;
    for (let i = 0; i < volume; i++) {
      const id = expandedBlocks[i];
      const em = LIGHT_EMISSION[id];
      if (em === 0) continue;
      const tint = LIGHT_COLOR[id * 3 + ch] / 255;     // 0..1 channel weight
      const seed = Math.round(em * tint);              // 0..15
      if (seed === 0) continue;
      arr[i] = seed;
      if (seed > 1) queue[qTail++] = (i << 4) | seed;
    }
    // Border seeds from neighbor chunks for this color channel.
    if (seedBorders) {
      qTail = _applyBorderSeeds(seedBorders, chanNames[ch], arr, width, height, queue, qTail);
    }
    while (qHead < qTail) {
      const packed = queue[qHead++];
      const idx = packed >>> 4;
      const lvl = packed & 0xF;
      if (lvl <= 1) continue;
      if (arr[idx] > lvl) continue;
      const y = (idx / stride) | 0;
      const rem = idx - y * stride;
      const z = (rem / zStride) | 0;
      const x = rem - z * zStride;
      // Inlined neighbor checks — avoids per-iteration closure allocation,
      // which dominates BFS cost when many emitters are present.
      let nIdx, opa, nl;
      if (x > 0) {
        nIdx = idx - 1;
        opa = LIGHT_OPACITY[expandedBlocks[nIdx]]; if (opa < 1) opa = 1;
        nl = lvl - opa;
        if (nl > arr[nIdx]) { arr[nIdx] = nl; if (nl > 1 && qTail < _bfsCap) queue[qTail++] = (nIdx << 4) | nl; }
      }
      if (x < width - 1) {
        nIdx = idx + 1;
        opa = LIGHT_OPACITY[expandedBlocks[nIdx]]; if (opa < 1) opa = 1;
        nl = lvl - opa;
        if (nl > arr[nIdx]) { arr[nIdx] = nl; if (nl > 1 && qTail < _bfsCap) queue[qTail++] = (nIdx << 4) | nl; }
      }
      if (z > 0) {
        nIdx = idx - zStride;
        opa = LIGHT_OPACITY[expandedBlocks[nIdx]]; if (opa < 1) opa = 1;
        nl = lvl - opa;
        if (nl > arr[nIdx]) { arr[nIdx] = nl; if (nl > 1 && qTail < _bfsCap) queue[qTail++] = (nIdx << 4) | nl; }
      }
      if (z < width - 1) {
        nIdx = idx + zStride;
        opa = LIGHT_OPACITY[expandedBlocks[nIdx]]; if (opa < 1) opa = 1;
        nl = lvl - opa;
        if (nl > arr[nIdx]) { arr[nIdx] = nl; if (nl > 1 && qTail < _bfsCap) queue[qTail++] = (nIdx << 4) | nl; }
      }
      if (y > 0) {
        nIdx = idx - stride;
        opa = LIGHT_OPACITY[expandedBlocks[nIdx]]; if (opa < 1) opa = 1;
        nl = lvl - opa;
        if (nl > arr[nIdx]) { arr[nIdx] = nl; if (nl > 1 && qTail < _bfsCap) queue[qTail++] = (nIdx << 4) | nl; }
      }
      if (y < height - 1) {
        nIdx = idx + stride;
        opa = LIGHT_OPACITY[expandedBlocks[nIdx]]; if (opa < 1) opa = 1;
        nl = lvl - opa;
        if (nl > arr[nIdx]) { arr[nIdx] = nl; if (nl > 1 && qTail < _bfsCap) queue[qTail++] = (nIdx << 4) | nl; }
      }
    }
  }
}

/* Smooth per-vertex light: average the 4 cells touching the vertex on the
 * front face side. Mirrors the AO sampling pattern. Returns averaged 0..15
 * separately for sky and block channels. We exclude opaque neighbors from
 * the average so a face directly against a wall doesn't pull in 0-light from
 * inside the wall (Minecraft-equivalent fix).                              */
function smoothCornerLight(expandedBlocks, width, height,
                           sliceAxis, uAxis, vAxis,
                           fs, u, v, du, dv,
                           outSky, outBlk) {
  const stride  = width * width;
  const zStride = width;
  // 4 sample positions: (fs, u, v), (fs, u+du, v), (fs, u, v+dv), (fs, u+du, v+dv)
  const offs = [
    [0,   0  ],
    [du,  0  ],
    [0,   dv ],
    [du,  dv ],
  ];
  let skySum = 0, blkSum = 0, count = 0;
  for (let i = 0; i < 4; i++) {
    const c = [0, 0, 0];
    c[sliceAxis] = fs;
    c[uAxis] = u + offs[i][0];
    c[vAxis] = v + offs[i][1];
    if (c[0] < 0 || c[0] >= width || c[2] < 0 || c[2] >= width || c[1] < 0 || c[1] >= height) continue;
    const idx = c[1] * stride + c[2] * zStride + c[0];
    if (LIGHT_OPACITY[expandedBlocks[idx]] >= MAX_LIGHT) continue; // skip solid
    skySum += _skyLight[idx];
    // (Function unused for RGB path; kept as-is for compatibility.)
    blkSum += _blockR[idx];
    count++;
  }
  if (count === 0) {
    // All 4 are opaque (shouldn't happen for a visible face) — fall back to
    // the front cell directly.
    const c = [0, 0, 0];
    c[sliceAxis] = fs; c[uAxis] = u; c[vAxis] = v;
    const idx = c[1] * stride + c[2] * zStride + c[0];
    outSky[0] = _skyLight[idx]   / MAX_LIGHT;
    outBlk[0] = _blockR[idx]     / MAX_LIGHT;
  } else {
    outSky[0] = (skySum / count) / MAX_LIGHT;
    outBlk[0] = (blkSum / count) / MAX_LIGHT;
  }
}

// Face configs for greedy meshing:
// For each face direction we define how to iterate slices and build quad positions.
// axis: which axis the slice is perpendicular to
// sliceRange: range of the slice axis
// uAxis, vAxis: the two axes forming the face plane
// uRange, vRange: iteration ranges for those axes
// neighbor delta for visibility check
const GREEDY_FACES = [
  { // top (Y+)
    name: "top", nx: 0, ny: 1, nz: 0,
    sliceAxis: 1, uAxis: 0, vAxis: 2,
    sliceMin: 1, sliceMax: CHUNK_HEIGHT,
    uMin: 1, uMax: CHUNK_SIZE, vMin: 1, vMax: CHUNK_SIZE,
    dn: [0, 1, 0],
    aoOrder: [2, 3, 0, 1],
    quad(s, u0, v0, du, dv) {
      const lx = u0 - 1, lz = v0 - 1, ly = s;
      return [
        lx,      ly, lz + dv,
        lx + du, ly, lz + dv,
        lx,      ly, lz,
        lx + du, ly, lz
      ];
    }
  },
  { // bottom (Y-)
    name: "bottom", nx: 0, ny: -1, nz: 0,
    sliceAxis: 1, uAxis: 0, vAxis: 2,
    sliceMin: 1, sliceMax: CHUNK_HEIGHT,
    uMin: 1, uMax: CHUNK_SIZE, vMin: 1, vMax: CHUNK_SIZE,
    dn: [0, -1, 0],
    aoOrder: [3, 2, 1, 0],
    quad(s, u0, v0, du, dv) {
      const lx = u0 - 1, lz = v0 - 1, ly = s - 1;
      return [
        lx + du, ly, lz + dv,
        lx,      ly, lz + dv,
        lx + du, ly, lz,
        lx,      ly, lz
      ];
    }
  },
  { // front (Z+)
    name: "front", nx: 0, ny: 0, nz: 1,
    sliceAxis: 2, uAxis: 0, vAxis: 1,
    sliceMin: 1, sliceMax: CHUNK_SIZE,
    uMin: 1, uMax: CHUNK_SIZE, vMin: 1, vMax: CHUNK_HEIGHT,
    dn: [0, 0, 1],
    aoOrder: [0, 1, 2, 3],
    quad(s, u0, v0, du, dv) {
      const lx = u0 - 1, ly = v0 - 1, lz = s;
      return [
        lx,      ly,      lz,
        lx + du, ly,      lz,
        lx,      ly + dv, lz,
        lx + du, ly + dv, lz
      ];
    }
  },
  { // back (Z-)
    name: "back", nx: 0, ny: 0, nz: -1,
    sliceAxis: 2, uAxis: 0, vAxis: 1,
    sliceMin: 1, sliceMax: CHUNK_SIZE,
    uMin: 1, uMax: CHUNK_SIZE, vMin: 1, vMax: CHUNK_HEIGHT,
    dn: [0, 0, -1],
    aoOrder: [1, 0, 3, 2],
    quad(s, u0, v0, du, dv) {
      const lx = u0 - 1, ly = v0 - 1, lz = s - 1;
      return [
        lx + du, ly,      lz,
        lx,      ly,      lz,
        lx + du, ly + dv, lz,
        lx,      ly + dv, lz
      ];
    }
  },
  { // right (X+)
    name: "right", nx: 1, ny: 0, nz: 0,
    sliceAxis: 0, uAxis: 2, vAxis: 1,
    sliceMin: 1, sliceMax: CHUNK_SIZE,
    uMin: 1, uMax: CHUNK_SIZE, vMin: 1, vMax: CHUNK_HEIGHT,
    dn: [1, 0, 0],
    aoOrder: [1, 0, 3, 2],
    quad(s, u0, v0, du, dv) {
      const lz = u0 - 1, ly = v0 - 1, lx = s;
      return [
        lx, ly,      lz + du,
        lx, ly,      lz,
        lx, ly + dv, lz + du,
        lx, ly + dv, lz
      ];
    }
  },
  { // left (X-)
    name: "left", nx: -1, ny: 0, nz: 0,
    sliceAxis: 0, uAxis: 2, vAxis: 1,
    sliceMin: 1, sliceMax: CHUNK_SIZE,
    uMin: 1, uMax: CHUNK_SIZE, vMin: 1, vMax: CHUNK_HEIGHT,
    dn: [-1, 0, 0],
    aoOrder: [0, 1, 2, 3],
    quad(s, u0, v0, du, dv) {
      const lz = u0 - 1, ly = v0 - 1, lx = s - 1;
      return [
        lx, ly,      lz,
        lx, ly,      lz + du,
        lx, ly + dv, lz,
        lx, ly + dv, lz + du
      ];
    }
  }
];

function getBlock(expandedBlocks, x, y, z, width, height) {
  const sx = clamp(x, 0, width - 1);
  const sy = clamp(y, 0, height - 1);
  const sz = clamp(z, 0, width - 1);
  return expandedBlocks[expandedVoxelIndex(sx, sy, sz, width, height)];
}

function coordsForAxes(sliceAxis, uAxis, vAxis, s, u, v) {
  // Returns a shared Int32Array(3). Callers must consume immediately
  // before the next call mutates it.
  _coordScratch[sliceAxis] = s;
  _coordScratch[uAxis] = u;
  _coordScratch[vAxis] = v;
  return _coordScratch;
}

export function buildDetailedChunkGeometry(
  expandedBlocks,
  width  = CHUNK_SIZE + 2,
  height = CHUNK_HEIGHT + 2,
  skyOpenToChunk = true,
  skyHeights = null,
  cyOrigin = 0,
  seedBorders = null
) {
  resetBuf(_oBuf);
  resetBuf(_wBuf);

  // Compute skylight + blocklight for the whole expanded chunk before meshing.
  computeChunkLight(expandedBlocks, width, height, skyOpenToChunk, skyHeights, cyOrigin, seedBorders);

  for (let fi = 0; fi < 6; fi++) {
    const face = GREEDY_FACES[fi];
    const { sliceAxis, uAxis, vAxis, sliceMin, sliceMax, uMin, uMax, vMin, vMax, dn, name, nx, ny, nz } = face;

    const uSize = uMax - uMin + 1;
    const vSize = vMax - vMin + 1;

    for (let s = sliceMin; s <= sliceMax; s++) {
      // ── Build mask + corner AO for this slice ──
      let maskIdx = 0;
      for (let v = vMin; v <= vMax; v++) {
        for (let u = uMin; u <= uMax; u++) {
          coordsForAxes(sliceAxis, uAxis, vAxis, s, u, v);
          const c0 = _coordScratch[0], c1 = _coordScratch[1], c2 = _coordScratch[2];
          const blockId = expandedBlocks[expandedVoxelIndex(c0, c1, c2, width, height)];

          if (blockId === BLOCK.AIR) {
            _mask[maskIdx] = 0;
            _maskType[maskIdx] = 0;
            maskIdx++;
            continue;
          }

          const nc0 = c0 + dn[0], nc1 = c1 + dn[1], nc2 = c2 + dn[2];
          const neighborId = getBlock(expandedBlocks, nc0, nc1, nc2, width, height);

          if (!shouldRenderFace(blockId, neighborId)) {
            _mask[maskIdx] = 0;
            _maskType[maskIdx] = 0;
            maskIdx++;
            continue;
          }

          const tile = faceTileForBlock(blockId, name);
          _mask[maskIdx] = tile + 1;
          _maskType[maskIdx] = blockId === BLOCK.WATER ? 1 : 0;

          // ── Compute 4 corner AOs (front layer = nc above) ──
          // For each corner (uOff, vOff) ∈ {0,1}², sample 3 cells in front layer
          // at (u + (2uOff-1), v), (u, v + (2vOff-1)), and the diagonal.
          // Water faces always get full brightness (no AO darkening on water).
          if (blockId === BLOCK.WATER) {
            _maskAO[maskIdx * 4]     = 3;
            _maskAO[maskIdx * 4 + 1] = 3;
            _maskAO[maskIdx * 4 + 2] = 3;
            _maskAO[maskIdx * 4 + 3] = 3;
            // Water faces sample light directly from the front-layer cell
            // (the water-air interface) so they shimmer with the surface.
            const fsW = s + dn[sliceAxis];
            _coordScratch[sliceAxis]=fsW; _coordScratch[uAxis]=u; _coordScratch[vAxis]=v;
            const cw0 = _coordScratch[0], cw1 = _coordScratch[1], cw2 = _coordScratch[2];
            const wIdx = cw1 * width * width + cw2 * width + cw0;
            const skyW = (cw0>=0 && cw0<width && cw1>=0 && cw1<height && cw2>=0 && cw2<width)
                          ? _skyLight[wIdx] : 15;
            const inBounds = (cw0>=0 && cw0<width && cw1>=0 && cw1<height && cw2>=0 && cw2<width);
            const blkR = inBounds ? _blockR[wIdx] : 0;
            const blkG = inBounds ? _blockG[wIdx] : 0;
            const blkB = inBounds ? _blockB[wIdx] : 0;
            for (let cI = 0; cI < 4; cI++) {
              _maskSky[maskIdx * 4 + cI]    = skyW;
              _maskBlockR[maskIdx * 4 + cI] = blkR;
              _maskBlockG[maskIdx * 4 + cI] = blkG;
              _maskBlockB[maskIdx * 4 + cI] = blkB;
            }
          } else {
            const fs = s + dn[sliceAxis]; // front-layer slice coord
            for (let cornerIdx = 0; cornerIdx < 4; cornerIdx++) {
              const uOff = cornerIdx & 1;
              const vOff = (cornerIdx >> 1) & 1;
              const du = uOff * 2 - 1;
              const dv = vOff * 2 - 1;
              const sideU = _aoSideU; sideU[sliceAxis]=fs; sideU[uAxis]=u+du; sideU[vAxis]=v;
              const sideV = _aoSideV; sideV[sliceAxis]=fs; sideV[uAxis]=u;    sideV[vAxis]=v+dv;
              const corn  = _aoCorn;  corn[sliceAxis]=fs;  corn[uAxis]=u+du;  corn[vAxis]=v+dv;
              const s1 = isOpaque(getBlock(expandedBlocks, sideU[0], sideU[1], sideU[2], width, height)) ? 1 : 0;
              const s2 = isOpaque(getBlock(expandedBlocks, sideV[0], sideV[1], sideV[2], width, height)) ? 1 : 0;
              const cr = isOpaque(getBlock(expandedBlocks, corn[0],  corn[1],  corn[2],  width, height)) ? 1 : 0;
              _maskAO[maskIdx * 4 + cornerIdx] = vertexAO(s1, s2, cr);
              // Smooth light at this corner: average front, sideU, sideV, corn
              // (skipping any opaque cell). Mirrors the standard MC algorithm
              // and lets light bleed nicely around overhangs.
              const stride = width * width;
              const zStride = width;
              const front = _aoFront; front[sliceAxis]=fs; front[uAxis]=u; front[vAxis]=v;
              let skySum = 0, blkRSum = 0, blkGSum = 0, blkBSum = 0, cnt = 0;
              const samples = _aoSamples;
              for (let si = 0; si < 4; si++) {
                const sp = samples[si];
                if (sp[0] < 0 || sp[0] >= width || sp[2] < 0 || sp[2] >= width || sp[1] < 0 || sp[1] >= height) continue;
                const sIdx = sp[1] * stride + sp[2] * zStride + sp[0];
                if (LIGHT_OPACITY[expandedBlocks[sIdx]] >= MAX_LIGHT) continue;
                skySum += _skyLight[sIdx];
                blkRSum += _blockR[sIdx];
                blkGSum += _blockG[sIdx];
                blkBSum += _blockB[sIdx];
                cnt++;
              }
              if (cnt === 0) {
                const sIdx = front[1] * stride + front[2] * zStride + front[0];
                _maskSky[maskIdx * 4 + cornerIdx]    = _skyLight[sIdx];
                _maskBlockR[maskIdx * 4 + cornerIdx] = _blockR[sIdx];
                _maskBlockG[maskIdx * 4 + cornerIdx] = _blockG[sIdx];
                _maskBlockB[maskIdx * 4 + cornerIdx] = _blockB[sIdx];
              } else {
                _maskSky[maskIdx * 4 + cornerIdx]    = (skySum / cnt)  | 0;
                _maskBlockR[maskIdx * 4 + cornerIdx] = (blkRSum / cnt) | 0;
                _maskBlockG[maskIdx * 4 + cornerIdx] = (blkGSum / cnt) | 0;
                _maskBlockB[maskIdx * 4 + cornerIdx] = (blkBSum / cnt) | 0;
              }
            }
          }
          maskIdx++;
        }
      }

      // ── Greedy merge: cells must match tile + type + ALL 4 AOs ──
      for (let j = 0; j < vSize; j++) {
        for (let i = 0; i < uSize; ) {
          const idx = j * uSize + i;
          const val = _mask[idx];
          if (val === 0) { i++; continue; }

          const type = _maskType[idx];
          const ao0 = _maskAO[idx*4], ao1 = _maskAO[idx*4+1], ao2 = _maskAO[idx*4+2], ao3 = _maskAO[idx*4+3];
          const sk0 = _maskSky[idx*4], sk1 = _maskSky[idx*4+1], sk2 = _maskSky[idx*4+2], sk3 = _maskSky[idx*4+3];
          const br0 = _maskBlockR[idx*4], br1 = _maskBlockR[idx*4+1], br2 = _maskBlockR[idx*4+2], br3 = _maskBlockR[idx*4+3];
          const bg0 = _maskBlockG[idx*4], bg1 = _maskBlockG[idx*4+1], bg2 = _maskBlockG[idx*4+2], bg3 = _maskBlockG[idx*4+3];
          const bb0 = _maskBlockB[idx*4], bb1 = _maskBlockB[idx*4+1], bb2 = _maskBlockB[idx*4+2], bb3 = _maskBlockB[idx*4+3];

          // Expand width
          let w = 1;
          while (i + w < uSize) {
            const ni = idx + w;
            if (_mask[ni] !== val || _maskType[ni] !== type) break;
            if (_maskAO[ni*4]!==ao0 || _maskAO[ni*4+1]!==ao1 || _maskAO[ni*4+2]!==ao2 || _maskAO[ni*4+3]!==ao3) break;
            if (_maskSky[ni*4]!==sk0 || _maskSky[ni*4+1]!==sk1 || _maskSky[ni*4+2]!==sk2 || _maskSky[ni*4+3]!==sk3) break;
            if (_maskBlockR[ni*4]!==br0 || _maskBlockR[ni*4+1]!==br1 || _maskBlockR[ni*4+2]!==br2 || _maskBlockR[ni*4+3]!==br3) break;
            if (_maskBlockG[ni*4]!==bg0 || _maskBlockG[ni*4+1]!==bg1 || _maskBlockG[ni*4+2]!==bg2 || _maskBlockG[ni*4+3]!==bg3) break;
            if (_maskBlockB[ni*4]!==bb0 || _maskBlockB[ni*4+1]!==bb1 || _maskBlockB[ni*4+2]!==bb2 || _maskBlockB[ni*4+3]!==bb3) break;
            w++;
          }

          // Expand height
          let h = 1;
          let done = false;
          while (j + h < vSize && !done) {
            for (let k = 0; k < w; k++) {
              const ni2 = (j + h) * uSize + i + k;
              if (_mask[ni2] !== val || _maskType[ni2] !== type) { done = true; break; }
              if (_maskAO[ni2*4]!==ao0 || _maskAO[ni2*4+1]!==ao1 || _maskAO[ni2*4+2]!==ao2 || _maskAO[ni2*4+3]!==ao3) { done = true; break; }
              if (_maskSky[ni2*4]!==sk0 || _maskSky[ni2*4+1]!==sk1 || _maskSky[ni2*4+2]!==sk2 || _maskSky[ni2*4+3]!==sk3) { done = true; break; }
              if (_maskBlockR[ni2*4]!==br0 || _maskBlockR[ni2*4+1]!==br1 || _maskBlockR[ni2*4+2]!==br2 || _maskBlockR[ni2*4+3]!==br3) { done = true; break; }
              if (_maskBlockG[ni2*4]!==bg0 || _maskBlockG[ni2*4+1]!==bg1 || _maskBlockG[ni2*4+2]!==bg2 || _maskBlockG[ni2*4+3]!==bg3) { done = true; break; }
              if (_maskBlockB[ni2*4]!==bb0 || _maskBlockB[ni2*4+1]!==bb1 || _maskBlockB[ni2*4+2]!==bb2 || _maskBlockB[ni2*4+3]!==bb3) { done = true; break; }
            }
            if (!done) h++;
          }

          // Zero merged region
          for (let dv2 = 0; dv2 < h; dv2++) {
            for (let du2 = 0; du2 < w; du2++) {
              _mask[(j + dv2) * uSize + i + du2] = 0;
            }
          }

          const buf = type === 1 ? _wBuf : _oBuf;
          const u0v = uMin + i;
          const v0v = vMin + j;
          const positions = face.quad(s, u0v, v0v, w, h);
          const aoBase = idx * 4;
          const aoCorners = [
            _maskAO[aoBase + face.aoOrder[0]] / 3,
            _maskAO[aoBase + face.aoOrder[1]] / 3,
            _maskAO[aoBase + face.aoOrder[2]] / 3,
            _maskAO[aoBase + face.aoOrder[3]] / 3,
          ];
          const skyCorners = [
            _maskSky[aoBase + face.aoOrder[0]] / MAX_LIGHT,
            _maskSky[aoBase + face.aoOrder[1]] / MAX_LIGHT,
            _maskSky[aoBase + face.aoOrder[2]] / MAX_LIGHT,
            _maskSky[aoBase + face.aoOrder[3]] / MAX_LIGHT,
          ];
          const blockRCorners = [
            _maskBlockR[aoBase + face.aoOrder[0]] / MAX_LIGHT,
            _maskBlockR[aoBase + face.aoOrder[1]] / MAX_LIGHT,
            _maskBlockR[aoBase + face.aoOrder[2]] / MAX_LIGHT,
            _maskBlockR[aoBase + face.aoOrder[3]] / MAX_LIGHT,
          ];
          const blockGCorners = [
            _maskBlockG[aoBase + face.aoOrder[0]] / MAX_LIGHT,
            _maskBlockG[aoBase + face.aoOrder[1]] / MAX_LIGHT,
            _maskBlockG[aoBase + face.aoOrder[2]] / MAX_LIGHT,
            _maskBlockG[aoBase + face.aoOrder[3]] / MAX_LIGHT,
          ];
          const blockBCorners = [
            _maskBlockB[aoBase + face.aoOrder[0]] / MAX_LIGHT,
            _maskBlockB[aoBase + face.aoOrder[1]] / MAX_LIGHT,
            _maskBlockB[aoBase + face.aoOrder[2]] / MAX_LIGHT,
            _maskBlockB[aoBase + face.aoOrder[3]] / MAX_LIGHT,
          ];
          pushGreedyQuad(buf, positions, nx, ny, nz, val - 1, w, h,
                         aoCorners, skyCorners,
                         blockRCorners, blockGCorners, blockBCorners);

          i += w;
        }
      }
    }
  }

  return {
    opaque: finalize(_oBuf),
    water:  finalize(_wBuf),
    lightEdges: _extractOutgoingEdges(width, height),
  };
}

export function collectTransferables(result) {
  const transferables = [];
  if (result.blocks) transferables.push(result.blocks.buffer);
  if (result.expandedBlocks) transferables.push(result.expandedBlocks.buffer);
  if (result.high) {
    if (result.high.skyHeights) transferables.push(result.high.skyHeights.buffer);
    if (result.high.lightEdges) {
      const e = result.high.lightEdges;
      for (const f of ["nx","px","nz","pz","ny","py"]) {
        const face = e[f]; if (!face) continue;
        if (face.sky) transferables.push(face.sky.buffer);
        if (face.br)  transferables.push(face.br.buffer);
        if (face.bg)  transferables.push(face.bg.buffer);
        if (face.bb)  transferables.push(face.bb.buffer);
      }
    }
    for (const part of [result.high.opaque, result.high.water]) {
      if (part.positions.length) transferables.push(part.positions.buffer);
      if (part.normals.length)   transferables.push(part.normals.buffer);
      if (part.uvs.length)       transferables.push(part.uvs.buffer);
      if (part.tileOrigins && part.tileOrigins.length) transferables.push(part.tileOrigins.buffer);
      if (part.aos && part.aos.length) transferables.push(part.aos.buffer);
      if (part.lights && part.lights.length) transferables.push(part.lights.buffer);
      if (part.indices.length)   transferables.push(part.indices.buffer);
    }
  }
  return transferables;
}
