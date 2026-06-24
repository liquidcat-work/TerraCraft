import { CHUNK_HEIGHT, CHUNK_SIZE, chunkOriginX, chunkOriginZ, SEA_LEVEL } from "../shared/config.js";
import { WorldGenerator } from "../shared/worldgen.js";

/*
  Scan worker: given (cx, cz), returns the set of vertical chunk layers
  (cy values) that contain ANY non-air content from generation. Empty
  air columns are reported as []. The main thread uses this to decide
  which chunks to ever schedule — air chunks above the surface are
  simply never created until a player places a block there.
*/

let activeSeed = null;
let generator = null;

function getGenerator(seed) {
  if (generator && activeSeed === seed) return generator;
  activeSeed = seed;
  generator = new WorldGenerator(seed);
  return generator;
}

self.onmessage = (event) => {
  const { id, payload } = event.data;
  const { seed, cx, cz } = payload;
  const world = getGenerator(seed);
  const span = world.getChunkVerticalSpan(cx, cz);
  // Convert max world-Y → inclusive max chunk layer.
  const maxCy = Math.max(0, Math.floor(span.maxY / CHUNK_HEIGHT));
  const layers = new Array(maxCy + 1);
  for (let i = 0; i <= maxCy; i++) layers[i] = i;
  self.postMessage({ id, cx, cz, maxCy, layers, maxY: span.maxY });
};