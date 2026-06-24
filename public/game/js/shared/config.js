export const CHUNK_SIZE   = 32;
export const CHUNK_HEIGHT = 32;
// Theoretical build ceiling. Empty columns above the surface are NEVER generated
// or scheduled — only chunks containing terrain or player edits become real work.
export const WORLD_HEIGHT = 1024;
export const WORLD_LAYERS = WORLD_HEIGHT / CHUNK_HEIGHT;
// Hard cap on how many vertical chunk layers we will ever load around the player,
// regardless of build height. Keeps per-frame scheduling bounded.
export const MAX_LOADED_VERTICAL_LAYERS = 32;
export const CHUNK_SLICE  = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_SLICE * CHUNK_HEIGHT;

export const SEA_LEVEL = 54;
export const SAVE_KEY  = "megaproject-clean-voxel-v1";

export const DEFAULT_RENDER_DISTANCE = 1;
export const MAX_RENDER_DISTANCE     = 64;
export const DEFAULT_VERTICAL_RENDER_DISTANCE = 2;
export const MAX_VERTICAL_RENDER_DISTANCE     = 16;
export const MAX_QUEUED_CHUNK_JOBS   = 96;
export const TARGET_CHUNK_UPDATES_PER_TICK = 6;
export const PLAYER_VERTICAL_LOAD_RADIUS   = 1;

export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.36;
export const EYE_HEIGHT    = 1.62;
export const WALK_SPEED    = 7.5;
export const SPRINT_SPEED  = 10.8;
export const AIR_ACCELERATION    = 16;
export const GROUND_ACCELERATION = 42;
export const GRAVITY   = 26;
export const JUMP_SPEED = 8.6;
export const INTERACTION_DISTANCE = 8;

export const TILE_SIZE    = 16;
export const ATLAS_COLUMNS = 16;
export const ATLAS_ROWS    = 16;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function euclideanModulo(value, modulo) {
  return ((value % modulo) + modulo) % modulo;
}

export function worldToChunkX(x) { return Math.floor(x / CHUNK_SIZE);  }
export function worldToChunkY(y) { return Math.floor(y / CHUNK_HEIGHT); }
export function worldToChunkZ(z) { return Math.floor(z / CHUNK_SIZE);  }

export function worldToChunkCoords(x, y, z) {
  return { cx: worldToChunkX(x), cy: worldToChunkY(y), cz: worldToChunkZ(z) };
}

export function localCoordX(x) { return euclideanModulo(Math.floor(x), CHUNK_SIZE);  }
export function localCoordY(y) { return euclideanModulo(Math.floor(y), CHUNK_HEIGHT); }
export function localCoordZ(z) { return euclideanModulo(Math.floor(z), CHUNK_SIZE);  }

export function localVoxelCoords(x, y, z) {
  return { lx: localCoordX(x), ly: localCoordY(y), lz: localCoordZ(z) };
}

export function chunkOriginX(cx) { return cx * CHUNK_SIZE;  }
export function chunkOriginY(cy) { return cy * CHUNK_HEIGHT; }
export function chunkOriginZ(cz) { return cz * CHUNK_SIZE;  }

export function isValidChunkY(cy) { return cy >= 0 && cy < WORLD_LAYERS; }

export function chunkKey(cx, cy, cz) { return `${cx},${cy},${cz}`; }

export function voxelIndex(lx, ly, lz, size = CHUNK_SIZE, height = CHUNK_HEIGHT) {
  return ly * size * size + lz * size + lx;
}

export function expandedVoxelIndex(x, y, z, size = CHUNK_SIZE + 2, height = CHUNK_HEIGHT + 2) {
  return y * size * size + z * size + x;
}
