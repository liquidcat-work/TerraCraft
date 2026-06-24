import { loadWorldsList, saveWorldsList, deleteWorldData } from "./storage.js";

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function getWorlds() {
  return loadWorldsList();
}

export function getWorld(id) {
  return loadWorldsList().find((w) => w.id === id) || null;
}

export function createWorld({ name, seed, gamemode }) {
  const worlds = loadWorldsList();
  const baseName = (name || "").trim() || "New World";
  const uniqueName = uniqueWorldName(baseName, worlds);
  const world = {
    id: generateId(),
    name: uniqueName,
    seed: typeof seed === "number" && Number.isFinite(seed)
      ? seed >>> 0
      : Math.floor(Math.random() * 0x7fffffff),
    gamemode: gamemode || "creative",
    created: Date.now(),
    lastPlayed: null,
    playTime: 0
  };
  worlds.unshift(world);
  saveWorldsList(worlds);
  return world;
}

/* Ensure no two worlds share the same name. If `base` is taken, returns
 * `${base} 1`, `${base} 2`, … until a free slot is found. Case-insensitive. */
export function uniqueWorldName(base, worldsList = null, excludeId = null) {
  const worlds = worldsList || loadWorldsList();
  const taken = new Set(
    worlds.filter((w) => w.id !== excludeId).map((w) => w.name.toLowerCase())
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 1; i < 9999; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}

export function renameWorld(id, newName) {
  const worlds = loadWorldsList();
  const w = worlds.find((w) => w.id === id);
  if (w) {
    const base = (newName || "").trim() || w.name;
    w.name = uniqueWorldName(base, worlds, id);
    saveWorldsList(worlds);
  }
}

export function deleteWorld(id) {
  const worlds = loadWorldsList().filter((w) => w.id !== id);
  saveWorldsList(worlds);
  deleteWorldData(id);
}

export function moveWorld(id, direction) {
  const worlds = loadWorldsList();
  const idx = worlds.findIndex((w) => w.id === id);
  if (idx === -1) return;
  const target = idx + direction;
  if (target < 0 || target >= worlds.length) return;
  [worlds[idx], worlds[target]] = [worlds[target], worlds[idx]];
  saveWorldsList(worlds);
}

export function touchWorld(id, additionalSeconds) {
  const worlds = loadWorldsList();
  const w = worlds.find((w) => w.id === id);
  if (w) {
    w.lastPlayed = Date.now();
    w.playTime = (w.playTime || 0) + Math.max(0, Math.round(additionalSeconds));
    saveWorldsList(worlds);
  }
}
