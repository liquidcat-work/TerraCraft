import * as THREE from "three";
import { BLOCK_INFO, INVENTORY_ORDER, ALL_ITEMS, ITEM_INFO, getAnyColor, isItem } from "./blocks.js";
import { ATLAS_COLUMNS, ATLAS_ROWS, TILE_SIZE } from "./config.js";
import { buildProceduralAtlas } from "./texture-gen.js";

const STORAGE_KEY = "voxel-atlas-png";
const ATLAS_W = ATLAS_COLUMNS * TILE_SIZE;
const ATLAS_H = ATLAS_ROWS * TILE_SIZE;

let lastAtlasCanvas = null;

function applyTextureSettings(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  tex.premultiplyAlpha = false;
  tex.flipY = true;
  tex.needsUpdate = true;
}

function canvasFromImage(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  return c;
}

export function createAtlasTexture() {
  let canvas = buildProceduralAtlas();
  const dataUrl = readStoredAtlas();
  const tex = new THREE.CanvasTexture(canvas);
  applyTextureSettings(tex);
  lastAtlasCanvas = canvas;

  if (dataUrl) {
    const img = new Image();
    img.onload = () => {
      const overrideCanvas = canvasFromImage(img);
      lastAtlasCanvas = overrideCanvas;
      tex.image = overrideCanvas;
      applyTextureSettings(tex);
    };
    img.onerror = () => {
      console.warn("[atlas] Failed to load stored atlas override; using procedural.");
    };
    img.src = dataUrl;
  }

  return tex;
}

/* Build swatches for all blocks AND items, for UI rendering.
 * Each swatch has: { id, label, color, tile, isItem } */
export function buildHotbarSwatches() {
  const blockSwatches = INVENTORY_ORDER.map((blockId) => {
    const info = BLOCK_INFO[blockId];
    return { id: blockId, label: info.name, color: info.color, tile: info.tiles.side, isItem: false };
  });
  const itemSwatches = ALL_ITEMS.map((itemId) => {
    const info = ITEM_INFO[itemId];
    return { id: itemId, label: info.name, color: info.color, tile: info.tile, isItem: true };
  });
  return [...blockSwatches, ...itemSwatches];
}

/* Get a swatch for any id (block or item) */
export function getSwatch(id, swatches) {
  return swatches.find(s => s.id === id) || null;
}

/* Get the CSS background for an item/block in the UI.
 * Uses the atlas tile if available (canvas-rendered), falls back to color. */
export function getSwatchStyle(id, swatches, atlasCanvas) {
  const sw = getSwatch(id, swatches);
  if (!sw) return { backgroundColor: "#444" };
  if (sw.tile !== null && sw.tile !== undefined && atlasCanvas) {
    const col = sw.tile % ATLAS_COLUMNS;
    const row = Math.floor(sw.tile / ATLAS_COLUMNS);
    const x = -(col * TILE_SIZE);
    const y = -(row * TILE_SIZE);
    return {
      backgroundImage: `url(${atlasCanvas.toDataURL()})`,
      backgroundPosition: `${x}px ${y}px`,
      backgroundSize: `${ATLAS_W}px ${ATLAS_H}px`,
      backgroundRepeat: "no-repeat",
      imageRendering: "pixelated",
      backgroundColor: isItem(id) ? "transparent" : sw.color
    };
  }
  return { backgroundColor: sw.color };
}

function readStoredAtlas() {
  try { return localStorage.getItem(STORAGE_KEY); }
  catch { return null; }
}

export function hasCustomAtlas() {
  return !!readStoredAtlas();
}

export function exportAtlasPNG() {
  const dataUrl = readStoredAtlas();
  if (dataUrl) return Promise.resolve(dataUrl);
  const canvas = lastAtlasCanvas || buildProceduralAtlas();
  return Promise.resolve(canvas.toDataURL("image/png"));
}

export function importAtlasPNG(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("No file"));
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth !== ATLAS_W || img.naturalHeight !== ATLAS_H) {
          reject(new Error(`Atlas must be ${ATLAS_W}x${ATLAS_H} px (got ${img.naturalWidth}x${img.naturalHeight}).`));
          return;
        }
        try {
          localStorage.setItem(STORAGE_KEY, dataUrl);
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error("Invalid PNG file."));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

export function resetAtlas() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

/* Get the current atlas canvas for UI rendering */
export function getAtlasCanvas() {
  return lastAtlasCanvas || buildProceduralAtlas();
}
