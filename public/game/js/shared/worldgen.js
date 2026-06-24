import {
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  SEA_LEVEL,
  WORLD_HEIGHT,
  chunkOriginX,
  chunkOriginY,
  chunkOriginZ,
  expandedVoxelIndex,
  voxelIndex
} from "./config.js";
import { BLOCK } from "./blocks.js";
import { NoiseGenerator, hash2D } from "./noise.js";

const TREE_CELL_SIZE = 8;
const TREE_RADIUS    = 2;

const TERRAIN_CACHE_MAX = 65536;
const TREE_CACHE_MAX    = 16384;

function makeCache(maxSize) {
  const map  = new Map();
  const keys = [];
  return {
    has(k)  { return map.has(k); },
    get(k)  { return map.get(k); },
    set(k, v) {
      if (!map.has(k)) {
        if (keys.length >= maxSize) {
          const evict = keys.shift();
          map.delete(evict);
        }
        keys.push(k);
      }
      map.set(k, v);
    }
  };
}

export class WorldGenerator {
  constructor(seed) {
    this.seed          = seed >>> 0;
    this.heightNoise   = new NoiseGenerator(this.seed ^ 0x9e3779b9);
    this.detailNoise   = new NoiseGenerator(this.seed ^ 0x85ebca6b);
    this.moistureNoise = new NoiseGenerator(this.seed ^ 0xc2b2ae35);
    this.caveNoise     = new NoiseGenerator(this.seed ^ 0x27d4eb2d);
    this.treeNoise     = new NoiseGenerator(this.seed ^ 0x165667b1);
    this.oreNoise      = new NoiseGenerator(this.seed ^ 0x3a4f5c6d);
    this.terrainCache  = makeCache(TERRAIN_CACHE_MAX);
    this.treeCache     = makeCache(TREE_CACHE_MAX);
    this.chunkSpanCache = makeCache(TREE_CACHE_MAX);
  }

  getTerrainInfo(worldX, worldZ) {
    const key = `${worldX},${worldZ}`;
    if (this.terrainCache.has(key)) return this.terrainCache.get(key);

    const base       = this.heightNoise.fbm2D(worldX * 0.0025, worldZ * 0.0025, 5, 2.05, 0.48);
    const hills      = this.heightNoise.fbm2D(worldX * 0.008,  worldZ * 0.008,  4, 2.2,  0.52);
    const detail     = this.detailNoise.fbm2D(worldX * 0.018,  worldZ * 0.018,  3, 2.1,  0.55);
    const ridgeRaw   = this.detailNoise.fbm2D(worldX * 0.004,  worldZ * 0.004,  4, 2.0, 0.5);
    const ridge      = Math.abs(ridgeRaw) * 2;
    const moisture   = (this.moistureNoise.fbm2D(worldX * 0.005, worldZ * 0.005, 3, 2, 0.5) + 1) * 0.5;

    const continentalness = base * 0.6 + 0.4;
    const hillFactor      = Math.max(0, hills) * 1.8;
    let height = Math.floor(SEA_LEVEL + continentalness * 30 + hillFactor * 18 + ridge * 12 + detail * 6);
    height = Math.max(10, Math.min(WORLD_HEIGHT - 12, height));

    const beach   = height <= SEA_LEVEL + 2;
    const terrain = {
      height,
      moisture,
      surfaceBlock: beach ? BLOCK.SAND  : BLOCK.GRASS,
      fillerBlock:  beach ? BLOCK.SAND  : BLOCK.DIRT
    };
    this.terrainCache.set(key, terrain);
    return terrain;
  }

  getChunkVerticalSpan(cx, cz) {
    const key = `${cx},${cz}`;
    if (this.chunkSpanCache.has(key)) return this.chunkSpanCache.get(key);

    const startX = chunkOriginX(cx) - 1;
    const startZ = chunkOriginZ(cz) - 1;
    const endX = startX + CHUNK_SIZE + 1;
    const endZ = startZ + CHUNK_SIZE + 1;
    let maxY = SEA_LEVEL;

    for (let z = startZ; z <= endZ; z += 2) {
      for (let x = startX; x <= endX; x += 2) {
        maxY = Math.max(maxY, this.getTerrainInfo(x, z).height);
      }
    }

    this.forEachTreeAffectingBounds(startX, endX, startZ, endZ, (tree) => {
      maxY = Math.max(maxY, tree.baseY + tree.trunkHeight + 2);
    });

    const span = { maxY };
    this.chunkSpanCache.set(key, span);
    return span;
  }

  hasChunkContent(cx, cy, cz) {
    const bottomY = chunkOriginY(cy);
    if (bottomY < 0) return true;
    return bottomY <= this.getChunkVerticalSpan(cx, cz).maxY;
  }

  getTreeCandidate(cellX, cellZ) {
    const key = `${cellX},${cellZ}`;
    if (this.treeCache.has(key)) return this.treeCache.get(key);

    const offsetX = 2 + Math.floor(hash2D(this.seed ^ 0x11111111, cellX, cellZ) * (TREE_CELL_SIZE - 4));
    const offsetZ = 2 + Math.floor(hash2D(this.seed ^ 0x22222222, cellX, cellZ) * (TREE_CELL_SIZE - 4));
    const x       = cellX * TREE_CELL_SIZE + offsetX;
    const z       = cellZ * TREE_CELL_SIZE + offsetZ;
    const terrain = this.getTerrainInfo(x, z);
    const density = (this.treeNoise.fbm2D(x * 0.05, z * 0.05, 3, 2.2, 0.55) + 1) * 0.5;

    let tree = null;
    if (terrain.surfaceBlock === BLOCK.GRASS && density > 0.62 && terrain.height > SEA_LEVEL + 1) {
      tree = {
        x, z,
        baseY:       terrain.height + 1,
        trunkHeight: 4 + Math.floor(hash2D(this.seed ^ 0x33333333, cellX, cellZ) * 3)
      };
    }
    this.treeCache.set(key, tree);
    return tree;
  }

  forEachTreeAffectingBounds(minX, maxX, minZ, maxZ, callback) {
    const minCellX = Math.floor((minX - TREE_RADIUS) / TREE_CELL_SIZE);
    const maxCellX = Math.floor((maxX + TREE_RADIUS) / TREE_CELL_SIZE);
    const minCellZ = Math.floor((minZ - TREE_RADIUS) / TREE_CELL_SIZE);
    const maxCellZ = Math.floor((maxZ + TREE_RADIUS) / TREE_CELL_SIZE);

    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        const tree = this.getTreeCandidate(cellX, cellZ);
        if (!tree) continue;
        if (tree.x + TREE_RADIUS < minX || tree.x - TREE_RADIUS > maxX ||
            tree.z + TREE_RADIUS < minZ || tree.z - TREE_RADIUS > maxZ) continue;
        callback(tree);
      }
    }
  }

  /* ── Ore / underground block selection ──
   * Minecraft-style ore distribution by Y-level:
   *   Coal:      y 0-128 (most common ore, found everywhere underground)
   *   Iron:      y 0-80  (common, slightly less than coal)
   *   Gold:      y 0-40  (uncommon, deeper)
   *   Diamond:   y 0-20  (rare, deepest)
   *   Gravel:    small pockets
   *   Clay:      near water level
   */
  getUndergroundBlock(x, y, z) {
    if (y <= 0) return BLOCK.BEDROCK;
    if (y <= 4) {
      const r = hash2D(this.seed ^ 0xDEADBEEF, x * 31 + y, z * 17 + y);
      if (r < (5 - y) * 0.2) return BLOCK.BEDROCK;
    }

    // Coal ore — most common, found at all underground levels
    const coalNoise = this.oreNoise.fbm3D(x * 0.07 + 500, y * 0.07, z * 0.07 + 500, 2, 2, 0.5);
    if (y < 128 && coalNoise > 0.52) return BLOCK.COAL_ORE;

    // Iron ore — common, y 0-80
    const ironNoise = this.oreNoise.fbm3D(x * 0.08, y * 0.08, z * 0.08, 2, 2, 0.5);
    if (y < 80 && ironNoise > 0.55) return BLOCK.IRON_ORE;

    // Gold ore — uncommon, deeper levels y 0-40
    const goldNoise = this.oreNoise.fbm3D(x * 0.1 + 100, y * 0.1, z * 0.1 + 100, 2, 2, 0.5);
    if (y < 40 && goldNoise > 0.62) return BLOCK.GOLD_ORE;

    // Diamond ore — rare, deepest levels y 0-20
    const diamondNoise = this.oreNoise.fbm3D(x * 0.12 + 200, y * 0.12, z * 0.12 + 200, 2, 2, 0.5);
    if (y < 20 && diamondNoise > 0.68) return BLOCK.DIAMOND_ORE;

    // Gravel pockets
    const gravelNoise = this.oreNoise.fbm3D(x * 0.06 + 300, y * 0.06, z * 0.06 + 300, 2, 2, 0.5);
    if (y < 60 && gravelNoise > 0.58) return BLOCK.GRAVEL;

    // Clay near water level
    if (y >= SEA_LEVEL - 8 && y <= SEA_LEVEL + 2) {
      const clayNoise = this.oreNoise.fbm3D(x * 0.07 + 400, y * 0.07, z * 0.07 + 400, 2, 2, 0.5);
      if (clayNoise > 0.55) return BLOCK.CLAY;
    }

    return BLOCK.STONE;
  }

  getBlockAt(x, y, z) {
    if (y < 0)            return BLOCK.BEDROCK;
    if (y >= WORLD_HEIGHT) return BLOCK.AIR;

    const terrain   = this.getTerrainInfo(x, z);
    const cave      = this.caveNoise.fbm3D(x * 0.03, y * 0.03, z * 0.03, 3, 2, 0.5);
    const caveCarved = y < terrain.height - 5 && y > 8 && cave > 0.32;

    if (y <= terrain.height && !caveCarved) {
      if (y === terrain.height)         return terrain.surfaceBlock;
      if (y >= terrain.height - 3)      return terrain.fillerBlock;
      if (terrain.surfaceBlock === BLOCK.SAND && y >= terrain.height - 6) return BLOCK.SANDSTONE;
      return this.getUndergroundBlock(x, y, z);
    }

    const minCellX = Math.floor((x - TREE_RADIUS) / TREE_CELL_SIZE);
    const maxCellX = Math.floor((x + TREE_RADIUS) / TREE_CELL_SIZE);
    const minCellZ = Math.floor((z - TREE_RADIUS) / TREE_CELL_SIZE);
    const maxCellZ = Math.floor((z + TREE_RADIUS) / TREE_CELL_SIZE);

    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        const tree = this.getTreeCandidate(cellX, cellZ);
        if (!tree) continue;
        if (x === tree.x && z === tree.z && y >= tree.baseY && y < tree.baseY + tree.trunkHeight)
          return BLOCK.LOG;
        const canopyBase = tree.baseY + tree.trunkHeight - 2;
        if (y < canopyBase || y > canopyBase + 2) continue;
        const dx     = Math.abs(x - tree.x);
        const dz     = Math.abs(z - tree.z);
        const radius = y === canopyBase + 2 ? 1 : TREE_RADIUS;
        if (dx <= radius && dz <= radius && dx + dz <= radius + 1) return BLOCK.LEAVES;
      }
    }

    if (y <= SEA_LEVEL) return BLOCK.WATER;
    return BLOCK.AIR;
  }
}

function paintBlock(expandedBlocks, width, height, startX, startY, startZ, x, y, z, blockId) {
  if (y < startY || y >= startY + height) return;
  const lx = x - startX, ly = y - startY, lz = z - startZ;
  if (lx < 0 || lx >= width || ly < 0 || ly >= height || lz < 0 || lz >= width) return;
  expandedBlocks[expandedVoxelIndex(lx, ly, lz, width, height)] = blockId;
}

function applyTree(expandedBlocks, width, height, startX, startY, startZ, tree) {
  for (let step = 0; step < tree.trunkHeight; step++) {
    paintBlock(expandedBlocks, width, height, startX, startY, startZ, tree.x, tree.baseY + step, tree.z, BLOCK.LOG);
  }
  const canopyBase = tree.baseY + tree.trunkHeight - 2;
  for (let dy = 0; dy <= 2; dy++) {
    const radius = dy === 2 ? 1 : TREE_RADIUS;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
        paintBlock(expandedBlocks, width, height, startX, startY, startZ, tree.x + dx, canopyBase + dy, tree.z + dz, BLOCK.LEAVES);
      }
    }
  }
}

function applyEdits(expandedBlocks, width, height, startX, startY, startZ, editsByChunk) {
  for (const [key, flat] of Object.entries(editsByChunk || {})) {
    const [cx, cy, cz] = key.split(",").map(Number);
    const originX = chunkOriginX(cx);
    const originY = chunkOriginY(cy);
    const originZ = chunkOriginZ(cz);
    for (let i = 0; i < flat.length; i += 2) {
      const voxel   = flat[i];
      const blockId = flat[i + 1];
      const lx      = voxel % CHUNK_SIZE;
      const lz      = Math.floor(voxel / CHUNK_SIZE) % CHUNK_SIZE;
      const ly      = Math.floor(voxel / (CHUNK_SIZE * CHUNK_SIZE));
      const wx = originX + lx, wy = originY + ly, wz = originZ + lz;
      if (wx >= startX && wx < startX + width &&
          wz >= startZ && wz < startZ + width &&
          wy >= startY && wy < startY + height) {
        const ex = wx - startX, ey = wy - startY, ez = wz - startZ;
        expandedBlocks[expandedVoxelIndex(ex, ey, ez, width, height)] = blockId;
      }
    }
  }
}

export function generateExpandedChunk(generator, cx, cy, cz, editsByChunk = {}) {
  const width  = CHUNK_SIZE + 2;
  const height = CHUNK_HEIGHT + 2;
  const startX = chunkOriginX(cx) - 1;
  const startY = chunkOriginY(cy) - 1;
  const startZ = chunkOriginZ(cz) - 1;
  const endX   = startX + width - 1;
  const endZ   = startZ + width - 1;
  const chunkEdits = editsByChunk[`${cx},${cy},${cz}`];
  if ((!chunkEdits || chunkEdits.length === 0) && !generator.hasChunkContent(cx, cy, cz)) {
    return { blocks: null, expandedBlocks: null, width, height, empty: true };
  }
  const expandedBlocks = new Uint8Array(width * width * height);

  for (let ly = 0; ly < height; ly++) {
    const y = startY + ly;
    for (let lz = 0; lz < width; lz++) {
      const z = startZ + lz;
      for (let lx = 0; lx < width; lx++) {
        const x = startX + lx;
        expandedBlocks[expandedVoxelIndex(lx, ly, lz, width, height)] = generator.getBlockAt(x, y, z);
      }
    }
  }

  generator.forEachTreeAffectingBounds(startX, endX, startZ, endZ, (tree) => {
    applyTree(expandedBlocks, width, height, startX, startY, startZ, tree);
  });
  applyEdits(expandedBlocks, width, height, startX, startY, startZ, editsByChunk);

  const blocks = new Uint8Array(CHUNK_VOLUME);
  for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        blocks[voxelIndex(lx, ly, lz)] = expandedBlocks[expandedVoxelIndex(lx + 1, ly + 1, lz + 1, width, height)];
      }
    }
  }

  return { blocks, expandedBlocks, width, height, empty: false };
}
