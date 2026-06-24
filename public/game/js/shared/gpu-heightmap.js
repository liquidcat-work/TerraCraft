/*
  GPU heightmap precomputer.

  WebGPU compute shader that batch-evaluates the world's heightmap noise
  for many (cx, cz) chunk columns in a single dispatch. The result feeds
  ChunkManager._columnScans as { maxCy, layers, maxY }, so the main thread
  never asks the scan-worker for those columns.

  Performance notes:
    • Persistent buffers (params + ring of input/output/readback) — no
      per-dispatch alloc/destroy churn.
    • Single bind-group per ring slot, created once.
    • Heightmap math is numerically equivalent to WorldGenerator.getTerrainInfo().
      Tree overhang is intentionally NOT modeled here; it's bounded by a
      conservative TREE_MARGIN added to maxY. Edited columns still go through
      the CPU scan-worker at chunk-build time, which is the source of truth.

  Fallback:
    • If WebGPU is unavailable, isAvailable() returns false; ChunkManager
      transparently uses the scan-worker for every column.
*/

import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from "./config.js";

let _device = null;
let _pipeline = null;
let _initPromise = null;
let _failed = false;

// ── GPU timing instrumentation ─────────────────────────────────────────────
// Uses WebGPU "timestamp-query" feature when supported. Falls back to
// wall-clock (queue.onSubmittedWorkDone) latency otherwise.
let _hasTimestamps = false;
let _querySet = null;
let _queryResolveBuf = null;
let _queryReadBuf = null;
const _timing = {
  dispatches: 0,
  totalGpuMs: 0,    // GPU compute time (timestamp-query)
  totalWallMs: 0,   // CPU→GPU→CPU round-trip wall time
  totalCols: 0,
  lastLogAt: 0,
};
const TIMING_LOG_INTERVAL_MS = 5000;

function _maybeLogTiming() {
  const now = performance.now();
  if (now - _timing.lastLogAt < TIMING_LOG_INTERVAL_MS) return;
  if (_timing.dispatches === 0) return;
  const avgGpu  = _timing.totalGpuMs  / _timing.dispatches;
  const avgWall = _timing.totalWallMs / _timing.dispatches;
  const colsPerMs = _timing.totalGpuMs > 0 ? (_timing.totalCols / _timing.totalGpuMs) : 0;
  console.log(
    `[gpu-heightmap] ${_timing.dispatches} dispatches · ` +
    `gpu ${avgGpu.toFixed(2)}ms avg · wall ${avgWall.toFixed(2)}ms avg · ` +
    `${_timing.totalCols} cols (${colsPerMs.toFixed(1)} cols/gpu-ms) · ` +
    `timestamps=${_hasTimestamps}`
  );
  _timing.dispatches = 0;
  _timing.totalGpuMs = 0;
  _timing.totalWallMs = 0;
  _timing.totalCols = 0;
  _timing.lastLogAt = now;
}

export function getGpuTimingSnapshot() {
  return { ..._timing, hasTimestamps: _hasTimestamps };
}

const WORKGROUP_SIZE = 64;
// Largest single dispatch (columns). 4096 ≈ 32 RD radius. Bigger than this
// and we just chunk the request — the GPU side is uniform-time.
const MAX_BATCH = 4096;
// Conservative upper-bound for tree height above the surface.
const TREE_MARGIN = 7;

const WGSL = /* wgsl */ `
struct Params {
  seed       : u32,
  count      : u32,
  chunk_size : u32,
  sea_level  : i32,
  world_max  : i32,
  pad0       : u32,
  pad1       : u32,
  pad2       : u32,
};

struct ColumnIn  { cx : i32, cz : i32 };
struct ColumnOut { max_y : i32, _pad : i32 };

@group(0) @binding(0) var<uniform>             u_params : Params;
@group(0) @binding(1) var<storage, read>       cols_in  : array<ColumnIn>;
@group(0) @binding(2) var<storage, read_write> cols_out : array<ColumnOut>;

fn hash2(seed: u32, x: i32, y: i32) -> f32 {
  var h : u32 = seed ^ u32(x * 374761393) ^ u32(y * 668265263);
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967295.0;
}

fn fade(t: f32) -> f32 { return t * t * (3.0 - 2.0 * t); }

fn value2(seed: u32, x: f32, y: f32) -> f32 {
  let xi = i32(floor(x));
  let yi = i32(floor(y));
  let xf = x - floor(x);
  let yf = y - floor(y);
  let v00 = hash2(seed, xi,     yi);
  let v10 = hash2(seed, xi + 1, yi);
  let v01 = hash2(seed, xi,     yi + 1);
  let v11 = hash2(seed, xi + 1, yi + 1);
  let u = fade(xf);
  let v = fade(yf);
  let a = mix(v00, v10, u);
  let b = mix(v01, v11, u);
  return mix(a, b, v) * 2.0 - 1.0;
}

fn fbm2(seed: u32, x: f32, y: f32, oct: u32, lac: f32, gain: f32) -> f32 {
  var sum  : f32 = 0.0;
  var amp  : f32 = 1.0;
  var freq : f32 = 1.0;
  var norm : f32 = 0.0;
  for (var i: u32 = 0u; i < oct; i = i + 1u) {
    sum  = sum + value2(seed + i * 1013u, x * freq, y * freq) * amp;
    norm = norm + amp;
    amp  = amp * gain;
    freq = freq * lac;
  }
  return sum / max(norm, 0.0001);
}

fn surface_height(seed_h: u32, seed_d: u32, wx: f32, wz: f32) -> i32 {
  let base    = fbm2(seed_h, wx * 0.0025, wz * 0.0025, 5u, 2.05, 0.48);
  let hills   = fbm2(seed_h, wx * 0.008,  wz * 0.008,  4u, 2.2,  0.52);
  let detail  = fbm2(seed_d, wx * 0.018,  wz * 0.018,  3u, 2.1,  0.55);
  let ridgeR  = fbm2(seed_d, wx * 0.004,  wz * 0.004,  4u, 2.0,  0.5);
  let ridge   = abs(ridgeR) * 2.0;
  let cont    = base * 0.6 + 0.4;
  let hillF   = max(0.0, hills) * 1.8;
  var h = floor(f32(u_params.sea_level) + cont * 30.0 + hillF * 18.0 + ridge * 12.0 + detail * 6.0);
  h = clamp(h, 10.0, f32(u_params.world_max - 12));
  return i32(h);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u_params.count) { return; }

  let cx = cols_in[i].cx;
  let cz = cols_in[i].cz;
  let cs = i32(u_params.chunk_size);
  let startX = cx * cs - 1;
  let startZ = cz * cs - 1;
  let endX   = startX + cs + 1;
  let endZ   = startZ + cs + 1;

  let seedH = u_params.seed ^ 0x9e3779b9u;
  let seedD = u_params.seed ^ 0x85ebca6bu;

  var maxY : i32 = u_params.sea_level;
  var z = startZ;
  loop {
    if (z > endZ) { break; }
    var x = startX;
    loop {
      if (x > endX) { break; }
      let h = surface_height(seedH, seedD, f32(x), f32(z));
      if (h > maxY) { maxY = h; }
      x = x + 2;
    }
    z = z + 2;
  }
  cols_out[i].max_y = maxY;
}
`;

// Persistent buffers (created once on init, sized for MAX_BATCH).
let _paramsBuf = null;
let _inBuf = null;
let _outBuf = null;
// Ring of readback buffers so multiple dispatches can be in flight without
// blocking on mapAsync of a single buffer.
const READBACK_RING = 3;
let _readbackRing = null;
let _readbackIdx = 0;
let _bindGroup = null;

export function isAvailable() { return !_failed && _device !== null && _pipeline !== null; }
export function isWebGPUSupported() { return typeof navigator !== "undefined" && !!navigator.gpu; }
export function isFailed() { return _failed; }

export async function init() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (!isWebGPUSupported()) { _failed = true; return false; }
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) { _failed = true; return false; }
      const wantTs = adapter.features.has("timestamp-query");
      const device = await adapter.requestDevice({
        requiredFeatures: wantTs ? ["timestamp-query"] : [],
      });
      _hasTimestamps = wantTs;
      device.lost.then(() => {
        _device = null; _pipeline = null; _failed = true;
        _paramsBuf = _inBuf = _outBuf = _bindGroup = null;
        _readbackRing = null;
        _querySet = _queryResolveBuf = _queryReadBuf = null;
        _hasTimestamps = false;
      });
      const module = device.createShaderModule({ code: WGSL });
      const pipeline = await device.createComputePipelineAsync({
        layout: "auto",
        compute: { module, entryPoint: "main" }
      });

      _paramsBuf = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      _inBuf = device.createBuffer({
        size: MAX_BATCH * 8,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      _outBuf = device.createBuffer({
        size: MAX_BATCH * 8,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      _readbackRing = new Array(READBACK_RING);
      for (let i = 0; i < READBACK_RING; i++) {
        _readbackRing[i] = {
          buf: device.createBuffer({
            size: MAX_BATCH * 8,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
          }),
          inFlight: false,
        };
      }
      _bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: _paramsBuf } },
          { binding: 1, resource: { buffer: _inBuf } },
          { binding: 2, resource: { buffer: _outBuf } },
        ],
      });

      if (_hasTimestamps) {
        try {
          _querySet = device.createQuerySet({ type: "timestamp", count: 2 });
          _queryResolveBuf = device.createBuffer({
            size: 16, // 2 × u64
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
          });
          _queryReadBuf = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
          });
        } catch (err) {
          console.warn("[gpu-heightmap] timestamp-query setup failed:", err);
          _hasTimestamps = false;
        }
      }

      _device = device;
      _pipeline = pipeline;
      console.log(`[gpu-heightmap] WebGPU ready · timestamps=${_hasTimestamps}`);
      return true;
    } catch (err) {
      console.warn("[gpu-heightmap] init failed, using CPU scan-worker:", err);
      _failed = true;
      return false;
    }
  })();
  return _initPromise;
}

// Reusable typed-array scratch (avoid GC pressure).
const _inScratch = new Int32Array(MAX_BATCH * 2);
const _paramsScratch = new ArrayBuffer(32);
const _paramsU32 = new Uint32Array(_paramsScratch);
const _paramsI32 = new Int32Array(_paramsScratch);

/*
  Compute maxY for an array of columns [{cx, cz, seed}, ...].
  Returns Promise<Array<{cx, cz, maxY}>>. Throws if not initialized.
*/
export async function computeColumnMaxY(columns) {
  if (!_device || !_pipeline) throw new Error("gpu-heightmap not initialized");
  const count = columns.length;
  if (count === 0) return [];
  if (count > MAX_BATCH) {
    const out = [];
    for (let off = 0; off < count; off += MAX_BATCH) {
      const slice = await computeColumnMaxY(columns.slice(off, off + MAX_BATCH));
      for (const r of slice) out.push(r);
    }
    return out;
  }

  // Wait for a free readback slot. With a 3-deep ring this almost never blocks.
  let slot = null;
  for (let tries = 0; tries < 64; tries++) {
    const candidate = _readbackRing[_readbackIdx % READBACK_RING];
    _readbackIdx++;
    if (!candidate.inFlight) { slot = candidate; break; }
    await new Promise((r) => setTimeout(r, 1));
  }
  if (!slot) throw new Error("gpu-heightmap: no free readback slot");
  slot.inFlight = true;

  const device = _device;
  const bytes = count * 8;

  for (let i = 0; i < count; i++) {
    _inScratch[i * 2]     = columns[i].cx | 0;
    _inScratch[i * 2 + 1] = columns[i].cz | 0;
  }
  device.queue.writeBuffer(_inBuf, 0, _inScratch.buffer, 0, bytes);

  _paramsU32[0] = (columns[0].seed >>> 0) || 0;
  _paramsU32[1] = count >>> 0;
  _paramsU32[2] = CHUNK_SIZE >>> 0;
  _paramsI32[3] = SEA_LEVEL | 0;
  _paramsI32[4] = WORLD_HEIGHT | 0;
  device.queue.writeBuffer(_paramsBuf, 0, _paramsScratch, 0, 32);

  const encoder = device.createCommandEncoder();
  const wallStart = performance.now();
  const useTs = _hasTimestamps && _querySet && !_queryReadBuf._mapped;
  const pass = encoder.beginComputePass(
    useTs
      ? { timestampWrites: { querySet: _querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } }
      : undefined
  );
  pass.setPipeline(_pipeline);
  pass.setBindGroup(0, _bindGroup);
  pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP_SIZE));
  pass.end();
  encoder.copyBufferToBuffer(_outBuf, 0, slot.buf, 0, bytes);
  if (useTs) {
    encoder.resolveQuerySet(_querySet, 0, 2, _queryResolveBuf, 0);
    encoder.copyBufferToBuffer(_queryResolveBuf, 0, _queryReadBuf, 0, 16);
  }
  device.queue.submit([encoder.finish()]);

  // Read timestamp asynchronously — don't block the main result on it.
  if (useTs) {
    _queryReadBuf._mapped = true;
    _queryReadBuf.mapAsync(GPUMapMode.READ, 0, 16).then(() => {
      const ts = new BigInt64Array(_queryReadBuf.getMappedRange(0, 16).slice(0));
      _queryReadBuf.unmap();
      _queryReadBuf._mapped = false;
      // Timestamps are in nanoseconds.
      const gpuNs = Number(ts[1] - ts[0]);
      if (gpuNs > 0) {
        _timing.totalGpuMs += gpuNs / 1e6;
      }
    }).catch(() => { _queryReadBuf._mapped = false; });
  }

  try {
    await slot.buf.mapAsync(GPUMapMode.READ, 0, bytes);
    const view = new Int32Array(slot.buf.getMappedRange(0, bytes).slice(0));
    slot.buf.unmap();

    const out = new Array(count);
    for (let i = 0; i < count; i++) {
      out[i] = { cx: columns[i].cx, cz: columns[i].cz, maxY: view[i * 2] + TREE_MARGIN };
    }
    _timing.dispatches++;
    _timing.totalCols += count;
    _timing.totalWallMs += (performance.now() - wallStart);
    if (!_hasTimestamps) _timing.totalGpuMs += (performance.now() - wallStart); // approximation
    _maybeLogTiming();
    return out;
  } finally {
    slot.inFlight = false;
  }
}
