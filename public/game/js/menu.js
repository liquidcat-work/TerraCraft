import { loadWorldMeta, loadWorldEdits } from "./shared/storage.js";
import { getWorlds, createWorld, renameWorld, deleteWorld, moveWorld } from "./shared/worlds.js";
import { exportAtlasPNG, importAtlasPNG, resetAtlas, hasCustomAtlas } from "./shared/atlas.js";

// ─── DOM refs ────────────────────────────────────────────────────────────────
const mainMenu = document.getElementById("mainMenu");
const gameShell = document.getElementById("gameShell");
const loadingScreen = document.getElementById("loadingScreen");
const worldsList = document.getElementById("worldsList");
const noWorldsMsg = document.getElementById("noWorldsMsg");
const newWorldBtn = document.getElementById("newWorldBtn");
const dialogOverlay = document.getElementById("dialogOverlay");

const createDialog = document.getElementById("createDialog");
const newWorldNameInput = document.getElementById("newWorldName");
const newWorldSeedInput = document.getElementById("newWorldSeed");
const newWorldGamemodeSelect = document.getElementById("newWorldGamemode");
const randomSeedBtn = document.getElementById("randomSeedBtn");
const cancelCreateBtn = document.getElementById("cancelCreateBtn");
const confirmCreateBtn = document.getElementById("confirmCreateBtn");

const renameDialog = document.getElementById("renameDialog");
const renameNameInput = document.getElementById("renameWorldName");
const cancelRenameBtn = document.getElementById("cancelRenameBtn");
const confirmRenameBtn = document.getElementById("confirmRenameBtn");

const deleteDialog = document.getElementById("deleteDialog");
const deleteWorldMsg = document.getElementById("deleteWorldMsg");
const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");

const loadingMsg = document.getElementById("loadingMsg");

// ─── State ───────────────────────────────────────────────────────────────────
let pendingRenameId = null;
let pendingDeleteId = null;
let cleanupGame = null;

// ─── Formatting helpers ───────────────────────────────────────────────────────
function formatRelativeTime(ts) {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatPlayTime(seconds) {
  if (!seconds || seconds < 60) return seconds > 0 ? `${seconds}s` : "—";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function randomSeed() {
  return Math.floor(Math.random() * 0x7fffffff);
}

// ─── World list rendering ─────────────────────────────────────────────────────
function renderWorldsList() {
  const worlds = getWorlds();
  worldsList.innerHTML = "";

  if (worlds.length === 0) {
    noWorldsMsg.classList.remove("hidden");
    return;
  }
  noWorldsMsg.classList.add("hidden");

  worlds.forEach((world, idx) => {
    const gm = world.gamemode || "creative";
    const card = document.createElement("div");
    card.className = "world-card";
    card.dataset.id = world.id;
    card.innerHTML = `
      <div class="world-card-main">
        <div class="world-card-info">
          <strong class="world-name">${escapeHtml(world.name)}</strong>
          <div class="world-meta">
            <span class="meta-chip">${gm.charAt(0).toUpperCase() + gm.slice(1)}</span>
            <span class="meta-chip">Seed: ${world.seed}</span>
            <span class="meta-chip">Played: ${formatPlayTime(world.playTime)}</span>
            <span class="meta-chip">${formatRelativeTime(world.lastPlayed)}</span>
          </div>
        </div>
        <button class="btn-play" data-action="play" data-id="${world.id}">▶ Play</button>
      </div>
      <div class="world-card-actions">
        <button class="btn-icon" data-action="up" data-id="${world.id}" ${idx === 0 ? "disabled" : ""} title="Move up">↑</button>
        <button class="btn-icon" data-action="down" data-id="${world.id}" ${idx === worlds.length - 1 ? "disabled" : ""} title="Move down">↓</button>
        <span class="actions-sep"></span>
        <button class="btn-card-text" data-action="rename" data-id="${world.id}">Rename</button>
        <button class="btn-card-text btn-card-danger" data-action="delete" data-id="${world.id}">Delete</button>
      </div>
    `;
    worldsList.appendChild(card);
  });
}

// ─── Dialogs ─────────────────────────────────────────────────────────────────
function showDialog(dialog) {
  dialogOverlay.classList.remove("hidden");
  [createDialog, renameDialog, deleteDialog].forEach((d) => d.classList.add("hidden"));
  dialog.classList.remove("hidden");
}

function hideDialog() {
  dialogOverlay.classList.add("hidden");
}

function showCreateDialog() {
  newWorldNameInput.value = "";
  newWorldSeedInput.value = String(randomSeed());
  if (newWorldGamemodeSelect) newWorldGamemodeSelect.value = "creative";
  showDialog(createDialog);
  setTimeout(() => newWorldNameInput.focus(), 50);
}

function showRenameDialog(id) {
  const world = getWorlds().find((w) => w.id === id);
  if (!world) return;
  pendingRenameId = id;
  renameNameInput.value = world.name;
  showDialog(renameDialog);
  setTimeout(() => renameNameInput.focus(), 50);
}

function showDeleteDialog(id) {
  const world = getWorlds().find((w) => w.id === id);
  if (!world) return;
  pendingDeleteId = id;
  deleteWorldMsg.textContent = `Delete "${world.name}"? This cannot be undone.`;
  showDialog(deleteDialog);
}

// ─── Enter world ─────────────────────────────────────────────────────────────
async function enterWorld(worldId) {
  const world = getWorlds().find((w) => w.id === worldId);
  if (!world) return;

  loadingScreen.classList.remove("hidden");
  mainMenu.classList.add("hidden");
  if (loadingMsg) loadingMsg.textContent = "Loading world…";

  try {
    const [meta, edits, { startGame }] = await Promise.all([
      Promise.resolve(loadWorldMeta(worldId)),
      loadWorldEdits(worldId),
      import("./main.js")
    ]);

    gameShell.classList.remove("hidden");
    loadingScreen.classList.add("hidden");

    let cleanupFn = null;

    const config = {
      worldId: world.id,
      name: world.name,
      seed: world.seed,
      gamemode: world.gamemode || "creative",
      renderDistance: meta?.renderDistance ?? 1,
      verticalRenderDistance: meta?.verticalRenderDistance ?? 2,
      selectedBlock: meta?.selectedBlock ?? null,
      selectedSlot: meta?.selectedSlot ?? 0,
      inventory: meta?.inventory ?? null,
      playerPos: meta?.playerPos ?? null,
      playerQuat: meta?.playerQuat ?? null,
      edits,
      rendererPref: getRendererPref(),
      aaPref: getAaPref(),
      onQuit() {
        if (cleanupFn) cleanupFn();
        gameShell.classList.add("hidden");
        mainMenu.classList.remove("hidden");
        renderWorldsList();
      }
    };

    cleanupFn = await startGame(config);
    cleanupGame = cleanupFn;
  } catch (err) {
    console.error("Failed to start world:", err);
    loadingScreen.classList.add("hidden");
    mainMenu.classList.remove("hidden");
    alert("Failed to load world. Check the browser console for details.");
  }
}

// ─── Event delegation on world list ──────────────────────────────────────────
worldsList.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, id } = btn.dataset;
  switch (action) {
    case "play":    enterWorld(id); break;
    case "up":      moveWorld(id, -1); renderWorldsList(); break;
    case "down":    moveWorld(id, 1);  renderWorldsList(); break;
    case "rename":  showRenameDialog(id); break;
    case "delete":  showDeleteDialog(id); break;
  }
});

// ─── Button handlers ──────────────────────────────────────────────────────────
newWorldBtn.addEventListener("click", showCreateDialog);

randomSeedBtn.addEventListener("click", () => {
  newWorldSeedInput.value = String(randomSeed());
});

cancelCreateBtn.addEventListener("click", hideDialog);
cancelRenameBtn.addEventListener("click", hideDialog);
cancelDeleteBtn.addEventListener("click", hideDialog);

dialogOverlay.addEventListener("click", (e) => {
  if (e.target === dialogOverlay) hideDialog();
});

confirmCreateBtn.addEventListener("click", () => {
  const name = newWorldNameInput.value.trim() || "New World";
  const seedStr = newWorldSeedInput.value.trim();
  const seed = seedStr ? (parseInt(seedStr, 10) || randomSeed()) : randomSeed();
  const gamemode = newWorldGamemodeSelect ? newWorldGamemodeSelect.value : "creative";
  const world = createWorld({ name, seed, gamemode });
  hideDialog();
  renderWorldsList();
  enterWorld(world.id);
});

confirmRenameBtn.addEventListener("click", () => {
  if (pendingRenameId) {
    renameWorld(pendingRenameId, renameNameInput.value);
    pendingRenameId = null;
  }
  hideDialog();
  renderWorldsList();
});

confirmDeleteBtn.addEventListener("click", () => {
  if (pendingDeleteId) {
    deleteWorld(pendingDeleteId);
    pendingDeleteId = null;
  }
  hideDialog();
  renderWorldsList();
});

// Enter key shortcuts in dialogs
newWorldNameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") confirmCreateBtn.click(); });
newWorldSeedInput.addEventListener("keydown", (e) => { if (e.key === "Enter") confirmCreateBtn.click(); });
renameNameInput.addEventListener("keydown",   (e) => { if (e.key === "Enter") confirmRenameBtn.click(); });

// ─── Atlas import/export ──────────────────────────────────────────────────
const exportAtlasBtn = document.getElementById("exportAtlasBtn");
const importAtlasBtn = document.getElementById("importAtlasBtn");
const resetAtlasBtn = document.getElementById("resetAtlasBtn");
const atlasFileInput = document.getElementById("atlasFileInput");

function refreshAtlasButtons() {
  if (!resetAtlasBtn) return;
  resetAtlasBtn.classList.toggle("hidden", !hasCustomAtlas());
}

if (exportAtlasBtn) {
  exportAtlasBtn.addEventListener("click", async () => {
    try {
      const dataUrl = await exportAtlasPNG();
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "voxel-atlas.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error(err);
      alert("Failed to export atlas: " + err.message);
    }
  });
}

if (importAtlasBtn && atlasFileInput) {
  importAtlasBtn.addEventListener("click", () => atlasFileInput.click());
  atlasFileInput.addEventListener("change", async () => {
    const file = atlasFileInput.files?.[0];
    atlasFileInput.value = "";
    if (!file) return;
    try {
      await importAtlasPNG(file);
      refreshAtlasButtons();
      alert("Atlas imported! It will apply on the next world load.");
    } catch (err) {
      alert("Import failed: " + err.message);
    }
  });
}

if (resetAtlasBtn) {
  resetAtlasBtn.addEventListener("click", () => {
    if (!confirm("Reset to default procedural textures?")) return;
    resetAtlas();
    refreshAtlasButtons();
  });
}

refreshAtlasButtons();

// ─── Renderer backend selector ────────────────────────────────────────────
const RENDERER_KEY = "voxel.rendererPref";
const rendererSelect = document.getElementById("rendererSelect");
function getRendererPref() {
  try { return localStorage.getItem(RENDERER_KEY) || "auto"; } catch { return "auto"; }
}
function setRendererPref(v) {
  try { localStorage.setItem(RENDERER_KEY, v); } catch {}
}
if (rendererSelect) {
  rendererSelect.value = getRendererPref();
  rendererSelect.addEventListener("change", () => setRendererPref(rendererSelect.value));
}

// ─── Anti-aliasing selector ───────────────────────────────────────────────
const AA_KEY = "voxel.aaPref";
const aaSelect = document.getElementById("aaSelect");
function getAaPref() {
  try { return localStorage.getItem(AA_KEY) || "none"; } catch { return "none"; }
}
function setAaPref(v) {
  try { localStorage.setItem(AA_KEY, v); } catch {}
}
if (aaSelect) {
  aaSelect.value = getAaPref();
  aaSelect.addEventListener("change", () => setAaPref(aaSelect.value));
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
renderWorldsList();

// ─── Splash text (Minecraft-style random tagline) ─────────────────────────
const SPLASHES = [
  "100% Stone Free!",
  "Now with extra chunks!",
  "Greedy meshed!",
  "Voxels go brrr",
  "Made by you!",
  "Press F to mine",
  "Sunlight included!",
  "More blocks than friends!",
  "Try the dirt!",
  "Caves, but cooler",
  "Powered by JavaScript!",
  "Yes, that block!",
  "Lit chunks!",
  "It's free real estate",
  "Bring a pickaxe",
  "Procedurally awesome",
  "Mine your business",
  "Three.js inside",
  "Now with multiplayer*",
  "*coming soon",
  "Terra-fic!",
  "Craft your own world!",
  "Blockbuster hit!",
  "Cubular!",
  "Pixels per parsec!",
  "Don't dig straight down!",
  "Squared away.",
  "Made in your browser!",
  "Now WebGPU-curious!",
  "Render distance: yes",
  "Faster than your last save",
  "Try torches at night!",
  "100% organic voxels",
  "Mob-free since 2026",
  "Featuring: dirt",
  "Lag-free*",
  "Now with grass!",
  "It's a-me, terrain!",
  "Bedrock, but better",
  "Survive. Or don't.",
  "Daylight savings on!",
  "Plays well with others*",
];
const splashEl = document.getElementById("mcSplash");
if (splashEl) {
  splashEl.textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
  splashEl.addEventListener("click", () => {
    splashEl.textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
  });
}

// ─── Minecraft-style screen routing ──────────────────────────────────────
const screens = {
  home:          document.querySelector('[data-screen="home"] > .mc-content')?.parentElement || mainMenu,
  singleplayer:  document.getElementById("screenSingleplayer"),
  multiplayer:   document.getElementById("screenMultiplayer"),
  settings:      document.getElementById("screenSettings"),
  help:          document.getElementById("screenHelp"),
};

// The home screen IS mainMenu; sub-screens are siblings inside it.
function showScreen(name) {
  // hide all sub-screens
  ["singleplayer", "multiplayer", "settings", "help"].forEach((k) => {
    if (screens[k]) screens[k].classList.add("hidden");
  });
  if (name === "home") return;
  if (screens[name]) screens[name].classList.remove("hidden");
}

mainMenu.addEventListener("click", (e) => {
  const goBtn = e.target.closest("[data-go]");
  if (goBtn) {
    showScreen(goBtn.dataset.go);
    return;
  }
  const backBtn = e.target.closest("[data-back]");
  if (backBtn) {
    showScreen("home");
  }
});

// Hide the boot loading screen now that the menu is wired up
const _bootLoader = document.getElementById("loadingScreen");
if (_bootLoader) {
  setTimeout(() => _bootLoader.classList.add("hidden"), 350);
}
