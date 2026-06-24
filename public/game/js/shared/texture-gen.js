// Procedural pixel-art atlas generator (canvas 2D)
// Builds a 256x256 atlas: 16 cols x 16 rows of 16x16 px tiles.
import { TILE_SIZE, ATLAS_COLUMNS, ATLAS_ROWS } from "./config.js";
import { TILE } from "./blocks.js";

const S = TILE_SIZE; // 16

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function px(ctx, ox, oy, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(ox + (x % S), oy + (y % S), 1, 1);
}
function fillTile(ctx, ox, oy, color) {
  ctx.fillStyle = color;
  ctx.fillRect(ox, oy, S, S);
}
function speckle(ctx, ox, oy, rng, count, palette) {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * S);
    const y = Math.floor(rng() * S);
    const c = palette[Math.floor(rng() * palette.length)];
    px(ctx, ox, oy, x, y, c);
  }
}

// ── Tile drawers ───────────────────────────────────────────────────────────
function drawGrassTop(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA01);
  fillTile(ctx, ox, oy, "#5fae3a");
  speckle(ctx, ox, oy, rng, 28, ["#6ec246", "#4f9a30", "#7dd255", "#3f8025"]);
}
function drawGrassSide(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA02);
  fillTile(ctx, ox, oy, "#8a5a32");
  speckle(ctx, ox, oy, rng, 24, ["#9b6b3d", "#7a4d28", "#a87a45"]);
  for (let x = 0; x < S; x++) {
    const h = 3 + Math.floor(rng() * 2);
    for (let y = 0; y < h; y++) {
      const tones = ["#5fae3a", "#6ec246", "#4f9a30", "#7dd255"];
      px(ctx, ox, oy, x, y, tones[Math.floor(rng() * tones.length)]);
    }
  }
}
function drawDirt(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA03);
  fillTile(ctx, ox, oy, "#8a5a32");
  speckle(ctx, ox, oy, rng, 36, ["#9b6b3d", "#7a4d28", "#a87a45", "#6e4422"]);
}
function drawStone(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA04);
  fillTile(ctx, ox, oy, "#8c8c8c");
  speckle(ctx, ox, oy, rng, 40, ["#9c9c9c", "#7a7a7a", "#a6a6a6", "#6e6e6e"]);
}
function drawSand(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA05);
  fillTile(ctx, ox, oy, "#e4cf8c");
  speckle(ctx, ox, oy, rng, 30, ["#efdc9b", "#d4be78", "#f5e5a8", "#c9b06a"]);
}
function drawWater(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA06);
  fillTile(ctx, ox, oy, "#3a86d6");
  speckle(ctx, ox, oy, rng, 22, ["#4a96e6", "#2c76c4", "#5aa6f0", "#286ab4"]);
  for (let y = 3; y < S; y += 5) {
    for (let x = 0; x < S; x++) {
      if (rng() < 0.5) px(ctx, ox, oy, x, y, "#6cb0f5");
    }
  }
}
function drawLogSide(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA07);
  fillTile(ctx, ox, oy, "#6e4a26");
  for (let x = 0; x < S; x++) {
    const tone = rng() < 0.3 ? "#5a3c1e" : rng() < 0.6 ? "#7a5430" : "#8a5e36";
    for (let y = 0; y < S; y++) {
      if (rng() < 0.55) px(ctx, ox, oy, x, y, tone);
    }
  }
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(rng() * S);
    const y = Math.floor(rng() * S);
    px(ctx, ox, oy, x, y, "#3e2a14");
  }
}
function drawLogTop(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA08);
  fillTile(ctx, ox, oy, "#c19658");
  const cx = 7.5, cy = 7.5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const ring = Math.floor(d) % 2;
      if (ring === 0) px(ctx, ox, oy, x, y, "#9c764a");
      if (d > 7.2) px(ctx, ox, oy, x, y, "#6e4a26");
    }
  }
  px(ctx, ox, oy, 7, 7, "#5a3c1e");
  px(ctx, ox, oy, 8, 8, "#5a3c1e");
}
function drawLeaves(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA09);
  fillTile(ctx, ox, oy, "#3f8025");
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = rng();
      if (r < 0.35) px(ctx, ox, oy, x, y, "#5fae3a");
      else if (r < 0.55) px(ctx, ox, oy, x, y, "#2f6018");
      else if (r < 0.65) px(ctx, ox, oy, x, y, "#7dd255");
      if (r > 0.95) px(ctx, ox, oy, x, y, "#1f4010");
    }
  }
}
function drawGlass(ctx, ox, oy) {
  ctx.clearRect(ox, oy, S, S);
  ctx.fillStyle = "rgba(200,232,248,0.18)";
  ctx.fillRect(ox, oy, S, S);
  ctx.fillStyle = "#a8c8d8";
  ctx.fillRect(ox, oy, S, 1);
  ctx.fillRect(ox, oy + S - 1, S, 1);
  ctx.fillRect(ox, oy, 1, S);
  ctx.fillRect(ox + S - 1, oy, 1, S);
  ctx.fillStyle = "#e8f4fb";
  ctx.fillRect(ox + 2, oy + 2, 1, 4);
  ctx.fillRect(ox + 3, oy + 2, 1, 1);
}
function drawCobblestone(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA0B);
  fillTile(ctx, ox, oy, "#7a7a7a");
  speckle(ctx, ox, oy, rng, 30, ["#8a8a8a", "#6a6a6a", "#9a9a9a", "#5a5a5a"]);
  ctx.fillStyle = "#3e3e3e";
  const cracks = [
    [0, 5, 8, 1], [8, 5, 8, 1],
    [0, 11, 6, 1], [6, 11, 10, 1],
    [5, 0, 1, 5], [10, 0, 1, 5],
    [4, 6, 1, 5], [11, 6, 1, 5],
    [3, 12, 1, 4], [12, 12, 1, 4],
  ];
  for (const [x, y, w, h] of cracks) ctx.fillRect(ox + x, oy + y, w, h);
}
function drawPlanks(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA0C);
  fillTile(ctx, ox, oy, "#b8884a");
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (rng() < 0.25) px(ctx, ox, oy, x, y, "#a47038");
      else if (rng() < 0.15) px(ctx, ox, oy, x, y, "#c89a5c");
    }
  }
  ctx.fillStyle = "#6e4a24";
  ctx.fillRect(ox, oy + 3, S, 1);
  ctx.fillRect(ox, oy + 7, S, 1);
  ctx.fillRect(ox, oy + 11, S, 1);
  ctx.fillRect(ox, oy + 15, S, 1);
  px(ctx, ox, oy, 4, 1, "#6e4a24");
  px(ctx, ox, oy, 12, 9, "#6e4a24");
}
function drawSnow(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA0D);
  fillTile(ctx, ox, oy, "#f0f5fa");
  speckle(ctx, ox, oy, rng, 20, ["#ffffff", "#dde6ee", "#e8eef4"]);
}
function drawBrick(ctx, ox, oy) {
  fillTile(ctx, ox, oy, "#9b4a3c");
  ctx.fillStyle = "#3e2a26";
  ctx.fillRect(ox, oy + 3, S, 1);
  ctx.fillRect(ox, oy + 7, S, 1);
  ctx.fillRect(ox, oy + 11, S, 1);
  ctx.fillRect(ox, oy + 15, S, 1);
  ctx.fillRect(ox + 7, oy + 0, 1, 3);
  ctx.fillRect(ox + 3, oy + 4, 1, 3);
  ctx.fillRect(ox + 11, oy + 4, 1, 3);
  ctx.fillRect(ox + 7, oy + 8, 1, 3);
  ctx.fillRect(ox + 3, oy + 12, 1, 3);
  ctx.fillRect(ox + 11, oy + 12, 1, 3);
  const rng = mulberry32(0x6177AA0E);
  speckle(ctx, ox, oy, rng, 14, ["#b85a48", "#82382c"]);
}
function drawOreOn(ctx, ox, oy, baseFn, oreColors) {
  baseFn(ctx, ox, oy);
  const rng = mulberry32(0x6177AA20 ^ oreColors[0].charCodeAt(1));
  for (let i = 0; i < 4; i++) {
    const cx = 2 + Math.floor(rng() * (S - 4));
    const cy = 2 + Math.floor(rng() * (S - 4));
    const size = 2 + Math.floor(rng() * 2);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (rng() < 0.7) {
          const c = oreColors[Math.floor(rng() * oreColors.length)];
          px(ctx, ox, oy, cx + dx, cy + dy, c);
        }
      }
    }
  }
}
function drawIronOre(ctx, ox, oy)    { drawOreOn(ctx, ox, oy, drawStone, ["#d8b48a", "#a87850", "#e8c8a0"]); }
function drawGoldOre(ctx, ox, oy)    { drawOreOn(ctx, ox, oy, drawStone, ["#f5d040", "#c89a20", "#ffe680"]); }
function drawDiamondOre(ctx, ox, oy) { drawOreOn(ctx, ox, oy, drawStone, ["#5ce8d6", "#9cf4e8", "#3ab8a8"]); }
function drawCoalOre(ctx, ox, oy)    { drawOreOn(ctx, ox, oy, drawStone, ["#1a1a1a", "#2a2a2a", "#0a0a0a"]); }
function drawBedrock(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA10);
  fillTile(ctx, ox, oy, "#3a3a3a");
  speckle(ctx, ox, oy, rng, 50, ["#1a1a1a", "#5a5a5a", "#2a2a2a", "#4a4a4a"]);
}
function drawGravel(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA11);
  fillTile(ctx, ox, oy, "#8a8078");
  speckle(ctx, ox, oy, rng, 60, ["#9a9088", "#6a6058", "#a8a098", "#5a5048"]);
}
function drawMossyCobble(ctx, ox, oy) {
  drawCobblestone(ctx, ox, oy);
  const rng = mulberry32(0x6177AA12);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (rng() < 0.22) px(ctx, ox, oy, x, y, "#4f8030");
      else if (rng() < 0.08) px(ctx, ox, oy, x, y, "#3a6020");
    }
  }
}
function drawObsidian(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA13);
  fillTile(ctx, ox, oy, "#1a0a2e");
  speckle(ctx, ox, oy, rng, 30, ["#2a1a3e", "#0a001a", "#3a2a5e", "#5a3a8e"]);
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(rng() * S);
    const y = Math.floor(rng() * S);
    px(ctx, ox, oy, x, y, "#7a5aae");
  }
}
function drawSandstoneSide(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA14);
  fillTile(ctx, ox, oy, "#d4c090");
  for (let y = 0; y < S; y++) {
    const tone = (Math.floor(y / 3) % 2 === 0) ? "#dccaa0" : "#c4b080";
    for (let x = 0; x < S; x++) {
      if (rng() < 0.5) px(ctx, ox, oy, x, y, tone);
    }
  }
  speckle(ctx, ox, oy, rng, 16, ["#b89e6a", "#e8d8a8"]);
}
function drawSandstoneTop(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA15);
  fillTile(ctx, ox, oy, "#dccaa0");
  speckle(ctx, ox, oy, rng, 36, ["#c4b080", "#e8d8a8", "#b89e6a"]);
}
function drawClay(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA16);
  fillTile(ctx, ox, oy, "#9eaab4");
  speckle(ctx, ox, oy, rng, 26, ["#aeb8c2", "#8e9aa4", "#bcc6d0"]);
}
function drawLight(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA17);
  fillTile(ctx, ox, oy, "#e8c45a");
  speckle(ctx, ox, oy, rng, 40, ["#fff2b3", "#ffe07a", "#c89a30", "#fffae0"]);
  for (let i = 0; i < 8; i++) {
    const x = Math.floor(rng() * S);
    const y = Math.floor(rng() * S);
    px(ctx, ox, oy, x, y, "#ffffff");
  }
  for (let i = 0; i < S; i++) {
    if (rng() < 0.55) px(ctx, ox, oy, i, 0, "#fff2b3");
    if (rng() < 0.55) px(ctx, ox, oy, i, S - 1, "#fff2b3");
    if (rng() < 0.55) px(ctx, ox, oy, 0, i, "#fff2b3");
    if (rng() < 0.55) px(ctx, ox, oy, S - 1, i, "#fff2b3");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// NEW BLOCK TEXTURES
// ═══════════════════════════════════════════════════════════════════════════
function drawCraftingTableTop(ctx, ox, oy) {
  // planks base with a 3x3 grid
  drawPlanks(ctx, ox, oy);
  ctx.fillStyle = "#5a3a18";
  ctx.fillRect(ox + 1, oy + 1, 14, 1);
  ctx.fillRect(ox + 1, oy + 6, 14, 1);
  ctx.fillRect(ox + 1, oy + 11, 14, 1);
  ctx.fillRect(ox + 1, oy + 1, 1, 14);
  ctx.fillRect(ox + 6, oy + 1, 1, 14);
  ctx.fillRect(ox + 11, oy + 1, 1, 14);
  // tool icon in center
  ctx.fillStyle = "#8a8a8a";
  px(ctx, ox, oy, 7, 4, "#a0a0a0");
  px(ctx, ox, oy, 8, 4, "#a0a0a0");
  px(ctx, ox, oy, 7, 5, "#5a3a18");
  px(ctx, ox, oy, 8, 5, "#5a3a18");
}
function drawCraftingTableSide(ctx, ox, oy) {
  drawPlanks(ctx, ox, oy);
  // saw + tool decoration
  ctx.fillStyle = "#4a2a10";
  ctx.fillRect(ox + 2, oy + 8, 12, 1);
  ctx.fillStyle = "#8a8a8a";
  for (let i = 0; i < 12; i += 2) {
    px(ctx, ox, oy, 2 + i, 9, "#9a9a9a");
  }
  px(ctx, ox, oy, 2, 7, "#6a4a20");
  px(ctx, ox, oy, 3, 7, "#6a4a20");
}
function drawFurnaceTop(ctx, ox, oy) {
  // stone-like with a central hole
  drawStone(ctx, ox, oy);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(ox + 4, oy + 4, 8, 8);
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(ox + 5, oy + 5, 6, 6);
}
function drawFurnaceSide(ctx, ox, oy) {
  drawStone(ctx, ox, oy);
  // furnace body with opening
  ctx.fillStyle = "#2a2a2a";
  ctx.fillRect(ox + 3, oy + 5, 10, 8);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(ox + 4, oy + 6, 8, 6);
  // fire glow at bottom of opening
  ctx.fillStyle = "#ff8c30";
  ctx.fillRect(ox + 5, oy + 10, 6, 2);
  ctx.fillStyle = "#ffb050";
  px(ctx, ox, oy, 6, 10, "#ffe080");
  px(ctx, ox, oy, 9, 11, "#ffe080");
}
function drawFurnaceFront(ctx, ox, oy) {
  drawFurnaceSide(ctx, ox, oy);
}
function drawCoalBlock(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA30);
  fillTile(ctx, ox, oy, "#1a1a1a");
  speckle(ctx, ox, oy, rng, 50, ["#0a0a0a", "#2a2a2a", "#3a3a3a", "#050505"]);
  // shimmer highlights
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(rng() * S);
    const y = Math.floor(rng() * S);
    px(ctx, ox, oy, x, y, "#4a4a4a");
  }
}
function drawIronBlock(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA31);
  fillTile(ctx, ox, oy, "#d8d8e0");
  speckle(ctx, ox, oy, rng, 24, ["#c0c0c8", "#e8e8f0", "#a8a8b0", "#f0f0f8"]);
  // metallic border
  ctx.fillStyle = "#a0a0a8";
  ctx.fillRect(ox, oy, S, 1);
  ctx.fillRect(ox, oy + S - 1, S, 1);
  ctx.fillRect(ox, oy, 1, S);
  ctx.fillRect(ox + S - 1, oy, 1, S);
}
function drawGoldBlock(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA32);
  fillTile(ctx, ox, oy, "#f5d040");
  speckle(ctx, ox, oy, rng, 24, ["#ffe680", "#d4b020", "#ffe050", "#c89a10"]);
  ctx.fillStyle = "#c89a10";
  ctx.fillRect(ox, oy, S, 1);
  ctx.fillRect(ox, oy + S - 1, S, 1);
  ctx.fillRect(ox, oy, 1, S);
  ctx.fillRect(ox + S - 1, oy, 1, S);
}
function drawDiamondBlock(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA33);
  fillTile(ctx, ox, oy, "#5ce8d6");
  speckle(ctx, ox, oy, rng, 24, ["#8cf4e8", "#3ad8c6", "#aef8f0", "#2ab8a8"]);
  ctx.fillStyle = "#2ab8a8";
  ctx.fillRect(ox, oy, S, 1);
  ctx.fillRect(ox, oy + S - 1, S, 1);
  ctx.fillRect(ox, oy, 1, S);
  ctx.fillRect(ox + S - 1, oy, 1, S);
  // sparkle
  px(ctx, ox, oy, 4, 4, "#ffffff");
  px(ctx, ox, oy, 11, 8, "#ffffff");
  px(ctx, ox, oy, 7, 12, "#ffffff");
}
function drawRawIronBlock(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA34);
  fillTile(ctx, ox, oy, "#c8a880");
  speckle(ctx, ox, oy, rng, 30, ["#b89868", "#d8b890", "#a88858", "#e8c8a0"]);
  // ore-like flecks
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(rng() * S);
    const y = Math.floor(rng() * S);
    px(ctx, ox, oy, x, y, "#e8c8a0");
  }
}
function drawSnowLayer(ctx, ox, oy) {
  ctx.clearRect(ox, oy, S, S);
  // thin snow on bottom
  ctx.fillStyle = "#f0f5fa";
  ctx.fillRect(ox, oy + 10, S, 6);
  speckle(ctx, ox, oy, mulberry32(0x6177AA35), 12, ["#ffffff", "#dde6ee"]);
}
function drawPumpkinSide(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA36);
  fillTile(ctx, ox, oy, "#e8702a");
  // vertical ridges
  for (let x = 0; x < S; x++) {
    if (x % 4 === 0) {
      for (let y = 0; y < S; y++) px(ctx, ox, oy, x, y, "#c85a1a");
    } else if (x % 4 === 1) {
      for (let y = 0; y < S; y++) if (rng() < 0.3) px(ctx, ox, oy, x, y, "#f8803a");
    }
  }
  // face
  ctx.fillStyle = "#1a0a00";
  ctx.fillRect(ox + 3, oy + 5, 3, 3);
  ctx.fillRect(ox + 10, oy + 5, 3, 3);
  ctx.fillRect(ox + 5, oy + 10, 6, 2);
  px(ctx, ox, oy, 5, 12, "#1a0a00");
  px(ctx, ox, oy, 10, 12, "#1a0a00");
}
function drawPumpkinTop(ctx, ox, oy) {
  const rng = mulberry32(0x6177AA37);
  fillTile(ctx, ox, oy, "#c85a1a");
  speckle(ctx, ox, oy, rng, 20, ["#d86a2a", "#b84a0a", "#e87a3a"]);
  // stem
  ctx.fillStyle = "#4a8a2a";
  ctx.fillRect(ox + 6, oy + 6, 4, 4);
  px(ctx, ox, oy, 7, 7, "#5a9a3a");
}

// ═══════════════════════════════════════════════════════════════════════════
// ITEM TEXTURES (transparent background, drawn as pixel sprites)
// ═══════════════════════════════════════════════════════════════════════════
function drawStick(ctx, ox, oy) {
  ctx.clearRect(ox, oy, S, S);
  // diagonal stick
  const stickColor = "#8a6a3a";
  const darkColor = "#6a4a20";
  for (let i = 0; i < 10; i++) {
    const x = 3 + i, y = 12 - i;
    px(ctx, ox, oy, x, y, stickColor);
    px(ctx, ox, oy, x + 1, y, darkColor);
  }
}
function drawPickaxe(ctx, ox, oy, headColor, headDark) {
  ctx.clearRect(ox, oy, S, S);
  // handle (diagonal)
  for (let i = 0; i < 8; i++) {
    px(ctx, ox, oy, 6 + i, 8 + i, "#8a6a3a");
    px(ctx, ox, oy, 7 + i, 8 + i, "#6a4a20");
  }
  // head (curved bar at top)
  ctx.fillStyle = headColor;
  ctx.fillRect(ox + 2, oy + 4, 12, 2);
  ctx.fillStyle = headDark;
  ctx.fillRect(ox + 2, oy + 6, 12, 1);
  // pick points
  px(ctx, ox, oy, 2, oy > 0 ? 5 : 5, headDark);
  px(ctx, ox, oy, 13, 5, headDark);
  // center connector
  px(ctx, ox, oy, 7, 5, headColor);
  px(ctx, ox, oy, 8, 5, headColor);
}
function drawAxe(ctx, ox, oy, headColor, headDark) {
  ctx.clearRect(ox, oy, S, S);
  // handle
  for (let i = 0; i < 10; i++) {
    px(ctx, ox, oy, 5 + i, 5 + i, "#8a6a3a");
    px(ctx, ox, oy, 6 + i, 5 + i, "#6a4a20");
  }
  // axe head (L-shape on right side)
  ctx.fillStyle = headColor;
  ctx.fillRect(ox + 8, oy + 2, 5, 6);
  ctx.fillStyle = headDark;
  ctx.fillRect(ox + 8, oy + 7, 5, 1);
  ctx.fillRect(ox + 12, oy + 2, 1, 6);
  // edge highlight
  px(ctx, ox, oy, 8, 2, "#ffffff");
  px(ctx, ox, oy, 9, 2, "#ffffff");
}
function drawShovel(ctx, ox, oy, headColor, headDark) {
  ctx.clearRect(ox, oy, S, S);
  // handle
  for (let i = 0; i < 9; i++) {
    px(ctx, ox, oy, 6 + i, 6 + i, "#8a6a3a");
    px(ctx, ox, oy, 7 + i, 6 + i, "#6a4a20");
  }
  // shovel head (square at bottom-left)
  ctx.fillStyle = headColor;
  ctx.fillRect(ox + 3, oy + 8, 5, 5);
  ctx.fillStyle = headDark;
  ctx.fillRect(ox + 3, oy + 12, 5, 1);
  ctx.fillRect(ox + 2, oy + 8, 1, 5);
}
function drawSword(ctx, ox, oy, bladeColor, bladeDark) {
  ctx.clearRect(ox, oy, S, S);
  // blade (diagonal, top-right to center)
  for (let i = 0; i < 9; i++) {
    const x = 7 + i, y = 2 + i;
    px(ctx, ox, oy, x, y, bladeColor);
    px(ctx, ox, oy, x + 1, y, bladeDark);
  }
  // crossguard
  ctx.fillStyle = "#8a6a3a";
  ctx.fillRect(ox + 5, oy + 10, 5, 1);
  // handle
  for (let i = 0; i < 3; i++) {
    px(ctx, ox, oy, 4 - i, 11 + i, "#6a4a20");
    px(ctx, ox, oy, 5 - i, 11 + i, "#4a2a10");
  }
  // blade tip highlight
  px(ctx, ox, oy, 15, 2, "#ffffff");
}

function drawWoodenPickaxe(ctx, ox, oy)  { drawPickaxe(ctx, ox, oy, "#c49a4a", "#8a6a2a"); }
function drawStonePickaxe(ctx, ox, oy)   { drawPickaxe(ctx, ox, oy, "#8a8a8a", "#5a5a5a"); }
function drawIronPickaxe(ctx, ox, oy)    { drawPickaxe(ctx, ox, oy, "#d8d8e0", "#a0a0a8"); }
function drawDiamondPickaxe(ctx, ox, oy) { drawPickaxe(ctx, ox, oy, "#5ce8d6", "#3ab8a8"); }
function drawWoodenAxe(ctx, ox, oy)  { drawAxe(ctx, ox, oy, "#c49a4a", "#8a6a2a"); }
function drawStoneAxe(ctx, ox, oy)   { drawAxe(ctx, ox, oy, "#8a8a8a", "#5a5a5a"); }
function drawIronAxe(ctx, ox, oy)    { drawAxe(ctx, ox, oy, "#d8d8e0", "#a0a0a8"); }
function drawDiamondAxe(ctx, ox, oy) { drawAxe(ctx, ox, oy, "#5ce8d6", "#3ab8a8"); }
function drawWoodenShovel(ctx, ox, oy)  { drawShovel(ctx, ox, oy, "#c49a4a", "#8a6a2a"); }
function drawStoneShovel(ctx, ox, oy)   { drawShovel(ctx, ox, oy, "#8a8a8a", "#5a5a5a"); }
function drawIronShovel(ctx, ox, oy)    { drawShovel(ctx, ox, oy, "#d8d8e0", "#a0a0a8"); }
function drawDiamondShovel(ctx, ox, oy) { drawShovel(ctx, ox, oy, "#5ce8d6", "#3ab8a8"); }
function drawWoodenSword(ctx, ox, oy)  { drawSword(ctx, ox, oy, "#c49a4a", "#8a6a2a"); }
function drawStoneSword(ctx, ox, oy)   { drawSword(ctx, ox, oy, "#8a8a8a", "#5a5a5a"); }
function drawIronSword(ctx, ox, oy)    { drawSword(ctx, ox, oy, "#d8d8e0", "#a0a0a8"); }
function drawDiamondSword(ctx, ox, oy) { drawSword(ctx, ox, oy, "#5ce8d6", "#3ab8a8"); }

function drawCoal(ctx, ox, oy) {
  ctx.clearRect(ox, oy, S, S);
  const rng = mulberry32(0x6177AA40);
  // lump shape
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(ox + 3, oy + 5, 10, 8);
  ctx.fillRect(ox + 4, oy + 4, 8, 1);
  ctx.fillRect(ox + 4, oy + 13, 8, 1);
  speckle(ctx, ox, oy, rng, 12, ["#0a0a0a", "#2a2a2a", "#3a3a3a"]);
  // highlight
  px(ctx, ox, oy, 5, 5, "#4a4a4a");
  px(ctx, ox, oy, 6, 5, "#4a4a4a");
}
function drawCharcoal(ctx, ox, oy) {
  ctx.clearRect(ox, oy, S, S);
  const rng = mulberry32(0x6177AA41);
  ctx.fillStyle = "#3a2a1a";
  ctx.fillRect(ox + 3, oy + 5, 10, 8);
  ctx.fillRect(ox + 4, oy + 4, 8, 1);
  ctx.fillRect(ox + 4, oy + 13, 8, 1);
  speckle(ctx, ox, oy, rng, 10, ["#2a1a0a", "#4a3a2a", "#5a4a3a"]);
  px(ctx, ox, oy, 5, 5, "#6a5a4a");
}
function drawRawIron(ctx, ox, oy) {
  ctx.clearRect(ox, oy, S, S);
  const rng = mulberry32(0x6177AA42);
  ctx.fillStyle = "#c8a880";
  ctx.fillRect(ox + 3, oy + 4, 10, 9);
  ctx.fillRect(ox + 4, oy + 3, 8, 1);
  ctx.fillRect(ox + 4, oy + 13, 8, 1);
  speckle(ctx, ox, oy, rng, 14, ["#b89868", "#d8b890", "#a88858"]);
  // metallic specks
  px(ctx, ox, oy, 6, 6, "#e8d0a8");
  px(ctx, ox, oy, 10, 9, "#e8d0a8");
}
function drawIngot(ctx, ox, oy, color, darkColor) {
  ctx.clearRect(ox, oy, S, S);
  // trapezoidal ingot shape
  ctx.fillStyle = color;
  ctx.fillRect(ox + 3, oy + 6, 10, 5);
  ctx.fillRect(ox + 4, oy + 5, 8, 1);
  ctx.fillRect(ox + 4, oy + 11, 8, 1);
  // top highlight
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(ox + 4, oy + 5, 8, 1);
  // bottom shadow
  ctx.fillStyle = darkColor;
  ctx.fillRect(ox + 3, oy + 11, 10, 1);
  // side shading
  ctx.fillStyle = darkColor;
  px(ctx, ox, oy, 3, 6, darkColor);
  px(ctx, ox, oy, 3, 10, darkColor);
}
function drawIronIngot(ctx, ox, oy)   { drawIngot(ctx, ox, oy, "#d8d8e0", "#a0a0a8"); }
function drawGoldIngot(ctx, ox, oy)   { drawIngot(ctx, ox, oy, "#f5d040", "#c89a10"); }
function drawDiamond(ctx, ox, oy) {
  ctx.clearRect(ox, oy, S, S);
  // diamond shape
  ctx.fillStyle = "#5ce8d6";
  ctx.fillRect(ox + 6, oy + 3, 4, 1);
  ctx.fillRect(ox + 5, oy + 4, 6, 1);
  ctx.fillRect(ox + 4, oy + 5, 8, 1);
  ctx.fillRect(ox + 3, oy + 6, 10, 2);
  ctx.fillRect(ox + 4, oy + 8, 8, 1);
  ctx.fillRect(ox + 5, oy + 9, 6, 1);
  ctx.fillRect(ox + 6, oy + 10, 4, 1);
  ctx.fillRect(ox + 7, oy + 11, 2, 1);
  // highlights
  ctx.fillStyle = "#9cf4e8";
  px(ctx, ox, oy, 6, 4, "#9cf4e8");
  px(ctx, ox, oy, 7, 4, "#9cf4e8");
  px(ctx, ox, oy, 5, 5, "#9cf4e8");
  px(ctx, ox, oy, 4, 6, "#9cf4e8");
  ctx.fillStyle = "#ffffff";
  px(ctx, ox, oy, 6, 5, "#ffffff");
}
function drawFlint(ctx, ox, oy) {
  ctx.clearRect(ox, oy, S, S);
  ctx.fillStyle = "#2a2a2a";
  ctx.fillRect(ox + 5, oy + 4, 6, 8);
  ctx.fillRect(ox + 6, oy + 3, 4, 1);
  ctx.fillRect(ox + 6, oy + 12, 4, 1);
  // sharp edge highlight
  ctx.fillStyle = "#5a5a5a";
  px(ctx, ox, oy, 5, 4, "#5a5a5a");
  px(ctx, ox, oy, 6, 4, "#5a5a5a");
  px(ctx, ox, oy, 5, 5, "#4a4a4a");
}
function drawApple(ctx, ox, oy) {
  ctx.clearRect(ox, oy, S, S);
  // apple body
  ctx.fillStyle = "#e0303a";
  ctx.fillRect(ox + 4, oy + 5, 8, 8);
  ctx.fillRect(ox + 5, oy + 4, 6, 1);
  ctx.fillRect(ox + 5, oy + 13, 6, 1);
  // highlight
  ctx.fillStyle = "#f0606a";
  ctx.fillRect(ox + 5, oy + 6, 2, 2);
  // stem
  ctx.fillStyle = "#4a2a10";
  px(ctx, ox, oy, 8, 3, "#4a2a10");
  px(ctx, ox, oy, 8, 4, "#4a2a10");
  // leaf
  ctx.fillStyle = "#4f9a30";
  px(ctx, ox, oy, 9, 3, "#4f9a30");
  px(ctx, ox, oy, 10, 3, "#4f9a30");
}
function drawBread(ctx, ox, oy) {
  ctx.clearRect(ox, oy, S, S);
  ctx.fillStyle = "#d4a850";
  ctx.fillRect(ox + 3, oy + 6, 10, 5);
  ctx.fillRect(ox + 4, oy + 5, 8, 1);
  ctx.fillRect(ox + 4, oy + 11, 8, 1);
  // crust shading
  ctx.fillStyle = "#b48830";
  ctx.fillRect(ox + 3, oy + 10, 10, 1);
  // scores on top
  ctx.fillStyle = "#a07820";
  px(ctx, ox, oy, 6, 6, "#a07820");
  px(ctx, ox, oy, 9, 6, "#a07820");
  px(ctx, ox, oy, 7, 7, "#b08838");
  px(ctx, ox, oy, 8, 7, "#b08838");
}
function drawWheat(ctx, ox, oy) {
  ctx.clearRect(ox, oy, S, S);
  ctx.fillStyle = "#d4b850";
  // stalk
  ctx.fillRect(ox + 7, oy + 6, 1, 8);
  // grain heads
  for (let y = 3; y <= 8; y += 2) {
    px(ctx, ox, oy, 5, y, "#c4a830");
    px(ctx, ox, oy, 6, y + 1, "#c4a830");
    px(ctx, ox, oy, 9, y, "#c4a830");
    px(ctx, ox, oy, 10, y + 1, "#c4a830");
  }
  px(ctx, ox, oy, 7, 4, "#e4c860");
  px(ctx, ox, oy, 8, 4, "#e4c860");
}
function drawBowl(ctx, ox, oy) {
  ctx.clearRect(ox, oy, S, S);
  ctx.fillStyle = "#8a6a3a";
  ctx.fillRect(ox + 4, oy + 8, 8, 3);
  ctx.fillRect(ox + 3, oy + 9, 10, 1);
  ctx.fillRect(ox + 5, oy + 7, 6, 1);
  ctx.fillStyle = "#6a4a20";
  ctx.fillRect(ox + 4, oy + 10, 8, 1);
}

// ── Tile registry ──────────────────────────────────────────────────────────
const TILE_DRAWERS = {
  [TILE.GRASS_TOP]:         drawGrassTop,
  [TILE.GRASS_SIDE]:        drawGrassSide,
  [TILE.DIRT]:              drawDirt,
  [TILE.STONE]:             drawStone,
  [TILE.SAND]:              drawSand,
  [TILE.WATER]:             drawWater,
  [TILE.LOG_SIDE]:          drawLogSide,
  [TILE.LOG_TOP]:           drawLogTop,
  [TILE.LEAVES]:            drawLeaves,
  [TILE.GLASS]:             drawGlass,
  [TILE.COBBLESTONE]:       drawCobblestone,
  [TILE.PLANKS]:            drawPlanks,
  [TILE.SNOW]:              drawSnow,
  [TILE.BRICK]:             drawBrick,
  [TILE.IRON_ORE]:          drawIronOre,
  [TILE.GOLD_ORE]:          drawGoldOre,
  [TILE.DIAMOND_ORE]:       drawDiamondOre,
  [TILE.BEDROCK]:           drawBedrock,
  [TILE.GRAVEL]:            drawGravel,
  [TILE.MOSSY_COBBLESTONE]: drawMossyCobble,
  [TILE.OBSIDIAN]:          drawObsidian,
  [TILE.SANDSTONE_SIDE]:    drawSandstoneSide,
  [TILE.SANDSTONE_TOP]:     drawSandstoneTop,
  [TILE.CLAY]:              drawClay,
  [TILE.LIGHT]:             drawLight,
  // New block textures
  [TILE.COAL_ORE]:          drawCoalOre,
  [TILE.CRAFTING_TABLE_TOP]:drawCraftingTableTop,
  [TILE.CRAFTING_TABLE_SIDE]:drawCraftingTableSide,
  [TILE.FURNACE_FRONT]:     drawFurnaceFront,
  [TILE.FURNACE_SIDE]:      drawFurnaceSide,
  [TILE.FURNACE_TOP]:       drawFurnaceTop,
  [TILE.COAL_BLOCK]:        drawCoalBlock,
  [TILE.IRON_BLOCK]:        drawIronBlock,
  [TILE.GOLD_BLOCK]:        drawGoldBlock,
  [TILE.DIAMOND_BLOCK]:     drawDiamondBlock,
  [TILE.RAW_IRON_BLOCK]:    drawRawIronBlock,
  [TILE.SNOW_LAYER]:        drawSnowLayer,
  [TILE.PUMPKIN_SIDE]:      drawPumpkinSide,
  [TILE.PUMPKIN_TOP]:       drawPumpkinTop,
  // Item textures
  [TILE.STICK]:             drawStick,
  [TILE.WOODEN_PICKAXE]:    drawWoodenPickaxe,
  [TILE.STONE_PICKAXE]:     drawStonePickaxe,
  [TILE.IRON_PICKAXE]:      drawIronPickaxe,
  [TILE.DIAMOND_PICKAXE]:   drawDiamondPickaxe,
  [TILE.WOODEN_AXE]:        drawWoodenAxe,
  [TILE.STONE_AXE]:         drawStoneAxe,
  [TILE.IRON_AXE]:          drawIronAxe,
  [TILE.DIAMOND_AXE]:       drawDiamondAxe,
  [TILE.WOODEN_SWORD]:      drawWoodenSword,
  [TILE.STONE_SWORD]:       drawStoneSword,
  [TILE.IRON_SWORD]:        drawIronSword,
  [TILE.DIAMOND_SWORD]:     drawDiamondSword,
  [TILE.RAW_IRON]:          drawRawIron,
  [TILE.IRON_INGOT]:        drawIronIngot,
  [TILE.COAL]:              drawCoal,
  [TILE.CHARCOAL]:          drawCharcoal,
  [TILE.WHEAT]:             drawWheat,
  [TILE.BREAD]:             drawBread,
  [TILE.APPLE]:             drawApple,
  [TILE.FLINT]:             drawFlint,
  [TILE.BOWL]:              drawBowl,
  [TILE.GOLD_INGOT]:        drawGoldIngot,
  [TILE.DIAMOND_GEM]:       drawDiamond,
};

export function buildProceduralAtlas() {
  const w = ATLAS_COLUMNS * S;
  const h = ATLAS_ROWS * S;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = "#7f8790";
  ctx.fillRect(0, 0, w, h);

  for (const [tileIdStr, drawer] of Object.entries(TILE_DRAWERS)) {
    const tileId = +tileIdStr;
    const col = tileId % ATLAS_COLUMNS;
    const row = Math.floor(tileId / ATLAS_COLUMNS);
    drawer(ctx, col * S, row * S);
  }

  return canvas;
}
