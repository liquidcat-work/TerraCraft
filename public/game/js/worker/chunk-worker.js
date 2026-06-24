import { buildDetailedChunkGeometry, collectTransferables } from "../shared/mesh-builder.js";
import { CHUNK_HEIGHT, CHUNK_SIZE } from "../shared/config.js";
import { generateExpandedChunk, WorldGenerator } from "../shared/worldgen.js";

let activeSeed = null;
let generator  = null;

function getGenerator(seed) {
  if (generator && activeSeed === seed) return generator;
  activeSeed = seed;
  generator  = new WorldGenerator(seed);
  return generator;
}

self.onmessage = (event) => {
  const { id, payload } = event.data;
  const world     = getGenerator(payload.seed);
  const generated = generateExpandedChunk(world, payload.cx, payload.cy, payload.cz, payload.edits || {});

  if (generated.empty) {
    self.postMessage({
      id,
      key: payload.key,
      cx: payload.cx,
      cy: payload.cy,
      cz: payload.cz,
      blocks: null,
      expandedBlocks: null,
      high: null,
      empty: true,
    });
    return;
  }

  // Per-column "sky height" in WORLD Y: any cell with worldY > skyHeight is
  // open to the sun. This is the authoritative skylight seed and works for
  // every vertical chunk (deep caves, sky islands, anything between).
  const skyHeights = new Int16Array(generated.width * generated.width);
  const startX = payload.cx * CHUNK_SIZE - 1;
  const startZ = payload.cz * CHUNK_SIZE - 1;
  const cyOrigin = payload.cy * CHUNK_HEIGHT;
  let skyOpenToChunk = false;
  const topY = (payload.cy + 1) * CHUNK_HEIGHT;
  for (let lz = 0; lz < generated.width; lz++) {
    for (let lx = 0; lx < generated.width; lx++) {
      const terrain = world.getTerrainInfo(startX + lx, startZ + lz);
      skyHeights[lz * generated.width + lx] = terrain.height;
      if (topY > terrain.height) skyOpenToChunk = true;
    }
  }
  const high = buildDetailedChunkGeometry(
    generated.expandedBlocks, generated.width, generated.height,
    skyOpenToChunk, skyHeights, cyOrigin, payload.seedBorders || null
  );
  high.skyOpenToChunk = skyOpenToChunk;
  high.skyHeights = skyHeights;
  high.cyOrigin = cyOrigin;
  const result = {
    id,
    key:            payload.key,
    cx:             payload.cx,
    cy:             payload.cy,
    cz:             payload.cz,
    blocks:         generated.blocks,
    expandedBlocks: generated.expandedBlocks,
    high,
    empty:          false,
  };

  self.postMessage(result, collectTransferables(result));
};
