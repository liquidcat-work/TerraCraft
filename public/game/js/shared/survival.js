/* ═══════════════════════════════════════════════════════════════════════════
 * SURVIVAL SYSTEMS — Inventory, Crafting, Furnace, Health, Hunger, Tools
 * 
 * This module manages all Minecraft-style survival gameplay:
 *  - 36-slot inventory (27 main + 9 hotbar) with drag-and-drop
 *  - 2×2 personal crafting + 3×3 crafting table with shaped recipes
 *  - Furnace with smelting + fuel mechanics
 *  - Health (10 hearts = 20 HP) and hunger (10 drumsticks = 20 points)
 *  - Tool-based mining: speed multipliers, harvest tiers, durability
 *  - Block drops (stone→cobblestone, ores→raw materials)
 *  - Food eating to restore hunger
 * ═══════════════════════════════════════════════════════════════════════════ */
import {
  BLOCK, ITEM, TIER, TOOL_INFO, FOOD_INFO, BLOCK_INFO, ITEM_INFO,
  INVENTORY_ORDER, ALL_ITEMS, SHAPED_RECIPES, BLOCK_DROPS, BLOCK_HARVEST_TIER,
  SMELTING_RECIPES, FUEL_INFO,
  getBlockInfo, getBlockName, getAnyName, getAnyColor, getAnyTile,
  isTool, getToolInfo, isFood, getMaxStack, isPlaceable, isItem,
  getHarvestTier, getBlockDrop, matchRecipe,
  getSmeltingResult, getFuelBurnTime
} from "./blocks.js";
import { getSwatchStyle, getSwatch, getAtlasCanvas } from "./atlas.js";

export const HOTBAR_SLOTS = 9;
export const INV_SLOTS = 27; // main inventory (above hotbar)
export const TOTAL_SLOTS = HOTBAR_SLOTS + INV_SLOTS; // 36
export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;

/* ═══════════════════════════════════════════════════════════════════════════
 * INVENTORY MANAGER
 * Slots 0-8 = hotbar, 9-35 = main inventory
 * Each slot: { id: number|null, count: number, durability?: number }
 * ═══════════════════════════════════════════════════════════════════════════ */
export class InventoryManager {
  constructor() {
    this.slots = [];
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      this.slots.push({ id: null, count: 0, durability: 0 });
    }
    this.selectedHotbar = 0;
    this.cursor = { id: null, count: 0, durability: 0 }; // dragged stack
    this.listeners = [];
  }

  on(listener) { this.listeners.push(listener); }
  emit(event, data) { for (const l of this.listeners) l(event, data); }

  getSelectedSlot() { return this.slots[this.selectedHotbar]; }
  getSelectedId() {
    const s = this.getSelectedSlot();
    return (s && s.count > 0) ? s.id : null;
  }

  /* Add an item to the inventory. Returns the number actually added. */
  add(id, count = 1, durability = 0) {
    if (id === null || id === undefined || count <= 0) return 0;
    if (id === BLOCK.AIR || id === BLOCK.WATER) return 0;
    const maxStack = getMaxStack(id);
    let remaining = count;

    // First try to stack into existing slots (hotbar first, then main)
    for (let pass = 0; pass < 2 && remaining > 0; pass++) {
      const start = pass === 0 ? 0 : HOTBAR_SLOTS;
      const end = pass === 0 ? HOTBAR_SLOTS : TOTAL_SLOTS;
      for (let i = start; i < end && remaining > 0; i++) {
        const s = this.slots[i];
        if (s.id === id && s.count < maxStack) {
          const add = Math.min(maxStack - s.count, remaining);
          s.count += add;
          remaining -= add;
        }
      }
    }

    // Then fill empty slots
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      const s = this.slots[i];
      if (s.id === null || s.count === 0) {
        const add = Math.min(maxStack, remaining);
        s.id = id;
        s.count = add;
        s.durability = durability;
        remaining -= add;
      }
    }

    this.emit("changed");
    return count - remaining;
  }

  /* Remove items from inventory. Returns number actually removed. */
  remove(id, count = 1) {
    let remaining = count;
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      const s = this.slots[i];
      if (s.id === id && s.count > 0) {
        const take = Math.min(s.count, remaining);
        s.count -= take;
        remaining -= take;
        if (s.count <= 0) { s.id = null; s.count = 0; s.durability = 0; }
      }
    }
    if (remaining < count) this.emit("changed");
    return count - remaining;
  }

  countItem(id) {
    let total = 0;
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      if (this.slots[i].id === id) total += this.slots[i].count;
    }
    return total;
  }

  /* Consume one item from the selected hotbar slot (for placing blocks). */
  consumeSelected() {
    const s = this.getSelectedSlot();
    if (!s || s.id === null || s.count <= 0) return false;
    s.count--;
    if (s.count <= 0) { s.id = null; s.count = 0; s.durability = 0; }
    this.emit("changed");
    return true;
  }

  /* Damage the currently held tool by 1. Returns true if tool broke. */
  damageSelectedTool() {
    const s = this.getSelectedSlot();
    if (!s || s.id === null || !isTool(s.id)) return false;
    const toolInfo = getToolInfo(s.id);
    if (!toolInfo) return false;
    s.durability = (s.durability || 0) + 1;
    if (s.durability >= toolInfo.durability) {
      s.id = null; s.count = 0; s.durability = 0;
      this.emit("changed");
      return true;
    }
    this.emit("changed");
    return false;
  }

  /* Get the mining speed multiplier for the selected tool against a block. */
  getMiningSpeed(blockId) {
    const s = this.getSelectedSlot();
    if (!s || s.id === null) return 1; // bare hands
    const toolInfo = getToolInfo(s.id);
    if (!toolInfo) return 1;
    // Pickaxe bonus: only for actual stone/ore/mineral blocks (not all hard blocks)
    const PICKAXE_BLOCKS = new Set([
      BLOCK.STONE, BLOCK.COBBLESTONE, BLOCK.MOSSY_COBBLESTONE,
      BLOCK.SANDSTONE, BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.COAL_ORE,
      BLOCK.DIAMOND_ORE, BLOCK.OBSIDIAN, BLOCK.FURNACE, BLOCK.BRICK,
      BLOCK.COAL_BLOCK, BLOCK.IRON_BLOCK, BLOCK.GOLD_BLOCK, BLOCK.DIAMOND_BLOCK,
      BLOCK.RAW_IRON_BLOCK, BLOCK.GLASS
    ]);
    if (toolInfo.type === "pickaxe" && PICKAXE_BLOCKS.has(blockId)) return toolInfo.speed;
    // Axe bonus for wood-type blocks
    if (toolInfo.type === "axe" && (blockId === BLOCK.LOG || blockId === BLOCK.PLANKS || blockId === BLOCK.CRAFTING_TABLE)) return toolInfo.speed;
    // Shovel bonus for dirt/sand/gravel
    if (toolInfo.type === "shovel" && (blockId === BLOCK.DIRT || blockId === BLOCK.SAND || blockId === BLOCK.GRAVEL || blockId === BLOCK.CLAY)) return toolInfo.speed;
    // Sword is fast on leaves
    if (toolInfo.type === "sword" && blockId === BLOCK.LEAVES) return 1.5;
    return 1;
  }

  /* Can the selected tool harvest this block? (i.e. get a drop) */
  canHarvest(blockId) {
    const requiredTier = getHarvestTier(blockId);
    if (requiredTier === TIER.NONE) return true;
    const s = this.getSelectedSlot();
    if (!s || s.id === null) return false; // bare hands can't harvest tiered blocks
    const toolInfo = getToolInfo(s.id);
    if (!toolInfo) return false;
    // Any tool type can harvest as long as it meets the required tier
    return toolInfo.tier >= requiredTier;
  }

  /* Get the drop for a block when mined with the current tool. */
  getBlockDropForMining(blockId) {
    if (!this.canHarvest(blockId)) return null; // wrong tier = no drop
    const drop = getBlockDrop(blockId);
    if (drop) return drop;
    return { id: blockId, count: 1 }; // self-drop
  }

  /* Serialize for saving. */
  serialize() {
    return this.slots.map(s => ({ id: s.id, count: s.count, durability: s.durability || 0 }));
  }

  /* Deserialize from save. */
  deserialize(data) {
    if (!data || !Array.isArray(data)) return;
    for (let i = 0; i < Math.min(data.length, TOTAL_SLOTS); i++) {
      const saved = data[i];
      if (saved && saved.id !== null && saved.id !== undefined) {
        this.slots[i].id = saved.id;
        this.slots[i].count = saved.count || 0;
        this.slots[i].durability = saved.durability || 0;
      }
    }
    this.emit("changed");
  }

  /* Swap cursor with a slot (left-click behavior). */
  swapWithSlot(slotIndex) {
    const s = this.slots[slotIndex];
    const tempId = s.id, tempCount = s.count, tempDur = s.durability;
    s.id = this.cursor.id;
    s.count = this.cursor.count;
    s.durability = this.cursor.durability;
    this.cursor.id = tempId;
    this.cursor.count = tempCount;
    this.cursor.durability = tempDur;
    this.emit("changed");
  }

  /* Place one item from cursor into slot (right-click behavior). */
  placeOne(slotIndex) {
    const s = this.slots[slotIndex];
    if (this.cursor.id === null || this.cursor.count <= 0) return;
    if (s.id === null) {
      s.id = this.cursor.id;
      s.count = 1;
      s.durability = this.cursor.durability;
      this.cursor.count--;
      if (this.cursor.count <= 0) { this.cursor.id = null; this.cursor.count = 0; }
    } else if (s.id === this.cursor.id) {
      const max = getMaxStack(s.id);
      if (s.count < max) {
        s.count++;
        this.cursor.count--;
        if (this.cursor.count <= 0) { this.cursor.id = null; this.cursor.count = 0; }
      }
    }
    this.emit("changed");
  }

  /* Pick up half of a slot's stack (right-click with empty cursor). */
  pickHalf(slotIndex) {
    const s = this.slots[slotIndex];
    if (s.id === null || s.count === 0) return;
    if (this.cursor.id === null) {
      const half = Math.ceil(s.count / 2);
      this.cursor.id = s.id;
      this.cursor.count = half;
      this.cursor.durability = s.durability;
      s.count -= half;
      if (s.count <= 0) { s.id = null; s.count = 0; s.durability = 0; }
    }
    this.emit("changed");
  }

  /* Return cursor items to inventory (when closing UI). */
  returnCursor() {
    if (this.cursor.id !== null && this.cursor.count > 0) {
      this.add(this.cursor.id, this.cursor.count, this.cursor.durability);
      this.cursor.id = null;
      this.cursor.count = 0;
      this.cursor.durability = 0;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CRAFTING GRID MANAGER
 * Handles 2×2 (inventory) and 3×3 (crafting table) crafting.
 * ═══════════════════════════════════════════════════════════════════════════ */
export class CraftingGrid {
  constructor(size, inventory) {
    this.size = size; // 2 or 3
    this.inventory = inventory;
    this.grid = []; // array of { id, count } for each grid slot
    for (let i = 0; i < size * size; i++) this.grid.push({ id: null, count: 0 });
    this.output = { id: null, count: 0 };
    this.matchedRecipe = null;
  }

  /* Get the grid as a 2D array for recipe matching. */
  getPattern() {
    const pattern = [];
    for (let y = 0; y < this.size; y++) {
      const row = [];
      for (let x = 0; x < this.size; x++) {
        const slot = this.grid[y * this.size + x];
        row.push(slot.count > 0 ? slot.id : null);
      }
      pattern.push(row);
    }
    return pattern;
  }

  /* Check if the current grid matches a recipe. */
  checkRecipe() {
    const pattern = this.getPattern();
    const recipe = matchRecipe(pattern, this.size);
    if (recipe) {
      this.output = { id: recipe.output.id, count: recipe.output.count };
      this.matchedRecipe = recipe;
    } else {
      this.output = { id: null, count: 0 };
      this.matchedRecipe = null;
    }
    return recipe;
  }

  /* Place an item from cursor into a grid slot. */
  placeItem(slotIndex, cursor) {
    if (cursor.id === null || cursor.count <= 0) return;
    const slot = this.grid[slotIndex];
    if (slot.id === null) {
      slot.id = cursor.id;
      slot.count = 1;
      cursor.count--;
      if (cursor.count <= 0) { cursor.id = null; cursor.count = 0; }
    } else if (slot.id === cursor.id) {
      slot.count++;
      cursor.count--;
      if (cursor.count <= 0) { cursor.id = null; cursor.count = 0; }
    }
    this.checkRecipe();
  }

  /* Pick up items from a grid slot. */
  pickupItem(slotIndex, cursor) {
    const slot = this.grid[slotIndex];
    if (slot.id === null || slot.count === 0) return;
    if (cursor.id === null) {
      cursor.id = slot.id;
      cursor.count = slot.count;
      slot.id = null;
      slot.count = 0;
    } else if (cursor.id === slot.id) {
      cursor.count += slot.count;
      slot.id = null;
      slot.count = 0;
    }
    this.checkRecipe();
  }

  /* Take the output (consume grid items). */
  takeOutput(cursor) {
    if (!this.matchedRecipe || this.output.id === null) return false;
    // Verify we can still craft (items might have been removed)
    const recipe = this.matchedRecipe;
    const pattern = this.getPattern();
    const rematched = matchRecipe(pattern, this.size);
    if (!rematched || rematched !== recipe) return false;

    // Consume one of each non-null slot in the trimmed pattern
    const trimmed = this.trimGrid();
    for (let y = 0; y < trimmed.length; y++) {
      for (let x = 0; x < trimmed[y].length; x++) {
        if (trimmed[y][x] !== null) {
          // Find the actual grid slot and decrement
          const slotIdx = this.findGridSlotForPattern(x, y, trimmed);
          if (slotIdx >= 0) {
            this.grid[slotIdx].count--;
            if (this.grid[slotIdx].count <= 0) {
              this.grid[slotIdx].id = null;
              this.grid[slotIdx].count = 0;
            }
          }
        }
      }
    }

    // Give output to cursor
    if (cursor.id === null) {
      cursor.id = this.output.id;
      cursor.count = this.output.count;
    } else if (cursor.id === this.output.id) {
      cursor.count += this.output.count;
    } else {
      return false; // can't take, cursor has different item
    }

    this.checkRecipe();
    return true;
  }

  trimGrid() {
    const pattern = this.getPattern();
    let minX = this.size, minY = this.size, maxX = -1, maxY = -1;
    for (let y = 0; y < pattern.length; y++) {
      for (let x = 0; x < pattern[y].length; x++) {
        if (pattern[y][x] !== null) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return [];
    const trimmed = [];
    for (let y = minY; y <= maxY; y++) {
      const row = [];
      for (let x = minX; x <= maxX; x++) {
        row.push(pattern[y][x]);
      }
      trimmed.push(row);
    }
    return trimmed;
  }

  findGridSlotForPattern(px, py, trimmed) {
    // Find the offset of the trimmed grid in the full grid
    const pattern = this.getPattern();
    let minX = this.size, minY = this.size, maxX = -1, maxY = -1;
    for (let y = 0; y < pattern.length; y++) {
      for (let x = 0; x < pattern[y].length; x++) {
        if (pattern[y][x] !== null) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return -1;
    const gridX = px + minX;
    const gridY = py + minY;
    return gridY * this.size + gridX;
  }

  /* Return all grid items to inventory (when closing). */
  returnAll() {
    for (const slot of this.grid) {
      if (slot.id !== null && slot.count > 0) {
        this.inventory.add(slot.id, slot.count);
        slot.id = null;
        slot.count = 0;
      }
    }
    this.output = { id: null, count: 0 };
    this.matchedRecipe = null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * FURNACE MANAGER
 * Handles smelting with fuel and input/output slots.
 * ═══════════════════════════════════════════════════════════════════════════ */
export class FurnaceManager {
  constructor(inventory) {
    this.inventory = inventory;
    this.input = { id: null, count: 0 };
    this.fuel = { id: null, count: 0 };
    this.output = { id: null, count: 0 };
    this.burnTime = 0;    // remaining fuel burn time (seconds)
    this.maxBurnTime = 0; // total burn time of current fuel item
    this.smeltProgress = 0; // 0..1
    this.currentRecipe = null;
    this.active = false;
    this.listeners = [];
  }

  on(listener) { this.listeners.push(listener); }
  emit(event, data) { for (const l of this.listeners) l(event, data); }

  /* Update the furnace — call every frame with delta time. */
  update(dt) {
    // Check if we can smelt
    const recipe = this.input.id !== null ? getSmeltingResult(this.input.id) : null;
    this.currentRecipe = recipe;

    // Can we smelt? Need: input item with recipe, fuel or burning, output space
    const canSmelt = recipe &&
      this.input.count > 0 &&
      (this.output.id === null || (this.output.id === recipe.output && this.output.count < getMaxStack(recipe.output)));

    if (this.burnTime > 0) {
      // Bug fix: only consume burn time when we can actually smelt (no wasting fuel on full output)
      if (canSmelt) {
        this.burnTime -= dt;
        if (this.burnTime < 0) this.burnTime = 0;
        this.active = true;
        this.smeltProgress += dt / (recipe.time || 10);
        if (this.smeltProgress >= 1) {
          // Complete one smelt
          this.smeltProgress = 0;
          this.input.count--;
          if (this.input.count <= 0) { this.input.id = null; this.input.count = 0; }
          if (this.output.id === null) {
            this.output.id = recipe.output;
            this.output.count = 1;
          } else {
            this.output.count++;
          }
          this.emit("changed");
        }
      } else {
        // Output full or no input — pause burn time and hold smelt progress (don't reset it)
        this.active = false;
      }
    } else {
      this.active = false;
      // Try to consume fuel — only if we can actually smelt
      if (canSmelt && this.fuel.id !== null && this.fuel.count > 0) {
        const burnTime = getFuelBurnTime(this.fuel.id);
        if (burnTime > 0) {
          this.burnTime = burnTime;
          this.maxBurnTime = burnTime;
          this.fuel.count--;
          if (this.fuel.count <= 0) { this.fuel.id = null; this.fuel.count = 0; }
          this.active = true;
          this.emit("changed");
        }
      }
    }
  }

  /* Place item from cursor into input slot. */
  placeInput(cursor) {
    if (cursor.id === null || cursor.count <= 0) return;
    if (!getSmeltingResult(cursor.id)) return; // only smeltable items
    if (this.input.id === null) {
      this.input.id = cursor.id;
      this.input.count = 1;
      cursor.count--;
      if (cursor.count <= 0) { cursor.id = null; cursor.count = 0; }
    } else if (this.input.id === cursor.id) {
      this.input.count++;
      cursor.count--;
      if (cursor.count <= 0) { cursor.id = null; cursor.count = 0; }
    }
    this.emit("changed");
  }

  /* Place item from cursor into fuel slot. */
  placeFuel(cursor) {
    if (cursor.id === null || cursor.count <= 0) return;
    if (getFuelBurnTime(cursor.id) <= 0) return; // only fuel items
    if (this.fuel.id === null) {
      this.fuel.id = cursor.id;
      this.fuel.count = 1;
      cursor.count--;
      if (cursor.count <= 0) { cursor.id = null; cursor.count = 0; }
    } else if (this.fuel.id === cursor.id) {
      this.fuel.count++;
      cursor.count--;
      if (cursor.count <= 0) { cursor.id = null; cursor.count = 0; }
    }
    this.emit("changed");
  }

  /* Pickup from input slot. */
  pickupInput(cursor) {
    if (this.input.id === null || this.input.count === 0) return;
    if (cursor.id === null) {
      cursor.id = this.input.id;
      cursor.count = this.input.count;
      this.input.id = null;
      this.input.count = 0;
    } else if (cursor.id === this.input.id) {
      cursor.count += this.input.count;
      this.input.id = null;
      this.input.count = 0;
    }
    this.emit("changed");
  }

  /* Pickup from fuel slot. */
  pickupFuel(cursor) {
    if (this.fuel.id === null || this.fuel.count === 0) return;
    if (cursor.id === null) {
      cursor.id = this.fuel.id;
      cursor.count = this.fuel.count;
      this.fuel.id = null;
      this.fuel.count = 0;
    } else if (cursor.id === this.fuel.id) {
      cursor.count += this.fuel.count;
      this.fuel.id = null;
      this.fuel.count = 0;
    }
    this.emit("changed");
  }

  /* Pickup from output slot. */
  pickupOutput(cursor) {
    if (this.output.id === null || this.output.count === 0) return;
    if (cursor.id === null) {
      cursor.id = this.output.id;
      cursor.count = this.output.count;
      this.output.id = null;
      this.output.count = 0;
    } else if (cursor.id === this.output.id) {
      cursor.count += this.output.count;
      this.output.id = null;
      this.output.count = 0;
    }
    this.emit("changed");
  }

  /* Return all items to inventory (when closing). */
  returnAll() {
    if (this.input.id !== null && this.input.count > 0) {
      this.inventory.add(this.input.id, this.input.count);
      this.input.id = null;
      this.input.count = 0;
    }
    if (this.fuel.id !== null && this.fuel.count > 0) {
      this.inventory.add(this.fuel.id, this.fuel.count);
      this.fuel.id = null;
      this.fuel.count = 0;
    }
    if (this.output.id !== null && this.output.count > 0) {
      this.inventory.add(this.output.id, this.output.count);
      this.output.id = null;
      this.output.count = 0;
    }
    this.burnTime = 0;
    this.smeltProgress = 0;
    this.emit("changed");
  }

  /* Serialize for saving furnace state at a location. */
  serialize() {
    return {
      input: { id: this.input.id, count: this.input.count },
      fuel: { id: this.fuel.id, count: this.fuel.count },
      output: { id: this.output.id, count: this.output.count },
      burnTime: this.burnTime,
      smeltProgress: this.smeltProgress
    };
  }

  deserialize(data) {
    if (!data) return;
    this.input = data.input || { id: null, count: 0 };
    this.fuel = data.fuel || { id: null, count: 0 };
    this.output = data.output || { id: null, count: 0 };
    this.burnTime = data.burnTime || 0;
    this.smeltProgress = data.smeltProgress || 0;
    this.emit("changed");
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SURVIVAL STATS MANAGER — Health & Hunger
 * ═══════════════════════════════════════════════════════════════════════════ */
export class SurvivalStats {
  constructor() {
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.saturation = 5; // hidden stat, depletes before hunger
    this.foodTimer = 0;  // accumulates for hunger drain
    this.regenTimer = 0; // accumulates for health regen
    this.listeners = [];
  }

  on(listener) { this.listeners.push(listener); }
  emit(event, data) { for (const l of this.listeners) l(event, data); }

  /* Take damage. Returns true if player died. */
  damage(amount) {
    this.health = Math.max(0, this.health - amount);
    this.emit("changed");
    return this.health <= 0;
  }

  /* Heal. */
  heal(amount) {
    this.health = Math.min(MAX_HEALTH, this.health + amount);
    this.emit("changed");
  }

  /* Eat food to restore hunger. */
  eat(foodId) {
    const foodInfo = FOOD_INFO[foodId];
    if (!foodInfo) return false;
    if (this.hunger >= MAX_HUNGER) return false;
    this.hunger = Math.min(MAX_HUNGER, this.hunger + foodInfo.hunger);
    this.saturation = Math.min(MAX_HUNGER, this.saturation + foodInfo.hunger * 0.5);
    this.emit("changed");
    return true;
  }

  /* Update — call every frame with dt (seconds). */
  update(dt) {
    this.foodTimer += dt;
    this.regenTimer += dt;

    // Hunger drain: every 4 seconds, lose 1 saturation then 1 hunger
    if (this.foodTimer >= 4) {
      this.foodTimer = 0;
      if (this.saturation > 0) {
        this.saturation = Math.max(0, this.saturation - 1);
      } else if (this.hunger > 0) {
        this.hunger = Math.max(0, this.hunger - 1);
        this.emit("changed");
      }
    }

    // Health regen: if hunger >= 18, regen 1 HP every 3 seconds
    if (this.hunger >= 18 && this.health < MAX_HEALTH) {
      if (this.regenTimer >= 3) {
        this.regenTimer = 0;
        this.heal(1);
      }
    } else if (this.hunger <= 0) {
      // Starvation: lose 1 HP every 4 seconds
      if (this.regenTimer >= 4) {
        this.regenTimer = 0;
        this.damage(1);
      }
    } else {
      this.regenTimer = 0;
    }
  }

  serialize() {
    return { health: this.health, hunger: this.hunger, saturation: this.saturation };
  }

  deserialize(data) {
    if (!data) return;
    this.health = data.health ?? MAX_HEALTH;
    this.hunger = data.hunger ?? MAX_HUNGER;
    this.saturation = data.saturation ?? 5;
    this.emit("changed");
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * UI RENDERER — renders inventory, crafting, furnace UI to DOM
 * ═══════════════════════════════════════════════════════════════════════════ */
export class SurvivalUI {
  constructor(inventory, isSurvival, isTouch) {
    this.inventory = inventory;
    this.isSurvival = isSurvival;
    this.isTouch = isTouch;
    this.swatches = null;
    this.atlasCanvas = null;
    this.crafting2x2 = null;
    this.crafting3x3 = null;
    this.furnace = null;
    this.activePanel = null; // "inventory" | "crafting" | "furnace" | "creative"
    this.uiOpen = false;
    this.listeners = [];
  }

  init(swatches) {
    this.swatches = swatches;
    this.atlasCanvas = getAtlasCanvas();
    this.crafting2x2 = new CraftingGrid(2, this.inventory);
    this.furnace = new FurnaceManager(this.inventory);
  }

  on(listener) { this.listeners.push(listener); }
  emit(event, data) { for (const l of this.listeners) l(event, data); }

  /* Create a slot icon element for an item/block id. */
  createSlotIcon(id) {
    const icon = document.createElement("div");
    icon.className = "slot-icon";
    if (id === null || id === undefined) return icon;

    const style = getSwatchStyle(id, this.swatches, this.atlasCanvas);
    if (style.backgroundImage) {
      icon.style.backgroundImage = style.backgroundImage;
      icon.style.backgroundPosition = style.backgroundPosition;
      icon.style.backgroundSize = style.backgroundSize;
      icon.style.backgroundRepeat = style.backgroundRepeat;
      icon.style.imageRendering = "pixelated";
      if (isItem(id)) icon.style.backgroundColor = "transparent";
    } else {
      icon.classList.add("color-only");
      icon.style.backgroundColor = style.backgroundColor;
    }
    return icon;
  }

  /* Render a single inventory slot. */
  renderSlot(slotEl, slotData, slotIndex, isHotbar = false) {
    slotEl.innerHTML = "";
    slotEl.dataset.slot = slotIndex;
    if (slotData.id !== null && slotData.count > 0) {
      const icon = this.createSlotIcon(slotData.id);
      slotEl.appendChild(icon);

      if (slotData.count > 1) {
        const count = document.createElement("span");
        count.className = "slot-count";
        count.textContent = String(slotData.count);
        slotEl.appendChild(count);
      }

      // Durability bar for tools
      if (isTool(slotData.id) && slotData.durability > 0) {
        const toolInfo = getToolInfo(slotData.id);
        if (toolInfo) {
          const ratio = 1 - (slotData.durability / toolInfo.durability);
          const durEl = document.createElement("div");
          durEl.className = "slot-durability";
          const fill = document.createElement("div");
          fill.className = "slot-durability-fill";
          fill.style.width = `${ratio * 100}%`;
          if (ratio < 0.3) fill.style.background = "#ef4444";
          else if (ratio < 0.6) fill.style.background = "#facc15";
          durEl.appendChild(fill);
          slotEl.appendChild(durEl);
        }
      }

      // Tooltip
      const tooltip = document.createElement("div");
      tooltip.className = "slot-tooltip";
      tooltip.textContent = getAnyName(slotData.id);
      if (isTool(slotData.id)) {
        const toolInfo = getToolInfo(slotData.id);
        if (toolInfo) {
          const remaining = toolInfo.durability - (slotData.durability || 0);
          tooltip.textContent += ` (${remaining}/${toolInfo.durability})`;
        }
      }
      slotEl.appendChild(tooltip);
    }
  }

  /* Render the full inventory grid (27 slots) + hotbar. */
  renderInventory(panelEl) {
    const invGrid = panelEl.querySelector("#invGrid");
    if (!invGrid) return;
    invGrid.innerHTML = "";

    // 27 main inventory slots (indices 9-35)
    for (let i = 0; i < INV_SLOTS; i++) {
      const slotIdx = HOTBAR_SLOTS + i;
      const slotEl = document.createElement("div");
      slotEl.className = "inv-slot";
      this.renderSlot(slotEl, this.inventory.slots[slotIdx], slotIdx);
      this.attachSlotEvents(slotEl, slotIdx);
      invGrid.appendChild(slotEl);
    }
  }

  /* Render the crafting grid (2x2 or 3x3). */
  renderCraftingGrid(gridEl, craftingGrid) {
    gridEl.innerHTML = "";
    for (let i = 0; i < craftingGrid.size * craftingGrid.size; i++) {
      const slotEl = document.createElement("div");
      slotEl.className = "craft-slot";
      const data = craftingGrid.grid[i];
      if (data.id !== null && data.count > 0) {
        const icon = this.createSlotIcon(data.id);
        slotEl.appendChild(icon);
        if (data.count > 1) {
          const count = document.createElement("span");
          count.className = "slot-count";
          count.textContent = String(data.count);
          slotEl.appendChild(count);
        }
      }
      this.attachCraftSlotEvents(slotEl, i, craftingGrid);
      gridEl.appendChild(slotEl);
    }
  }

  /* Render the crafting output slot. */
  renderCraftOutput(outputEl, craftingGrid) {
    outputEl.innerHTML = "";
    outputEl.classList.toggle("has-item", craftingGrid.output.id !== null);
    if (craftingGrid.output.id !== null && craftingGrid.output.count > 0) {
      const icon = this.createSlotIcon(craftingGrid.output.id);
      outputEl.appendChild(icon);
      if (craftingGrid.output.count > 1) {
        const count = document.createElement("span");
        count.className = "slot-count";
        count.textContent = String(craftingGrid.output.count);
        outputEl.appendChild(count);
      }
    }
    this.attachCraftOutputEvents(outputEl, craftingGrid);
  }

  /* Render the furnace UI. */
  renderFurnace(panelEl) {
    const inputSlot = panelEl.querySelector("#furnaceInputSlot");
    const fuelSlot = panelEl.querySelector("#furnaceFuelSlot");
    const outputSlot = panelEl.querySelector("#furnaceOutputSlot");
    const flame = panelEl.querySelector("#furnaceFlame");
    const fuelFill = panelEl.querySelector("#furnaceFuelFill");
    const progressFill = panelEl.querySelector("#furnaceProgressFill");

    // Input
    inputSlot.innerHTML = "";
    if (this.furnace.input.id !== null && this.furnace.input.count > 0) {
      inputSlot.appendChild(this.createSlotIcon(this.furnace.input.id));
      if (this.furnace.input.count > 1) {
        const c = document.createElement("span");
        c.className = "slot-count";
        c.textContent = String(this.furnace.input.count);
        inputSlot.appendChild(c);
      }
    }

    // Fuel
    fuelSlot.innerHTML = "";
    if (this.furnace.fuel.id !== null && this.furnace.fuel.count > 0) {
      fuelSlot.appendChild(this.createSlotIcon(this.furnace.fuel.id));
      if (this.furnace.fuel.count > 1) {
        const c = document.createElement("span");
        c.className = "slot-count";
        c.textContent = String(this.furnace.fuel.count);
        fuelSlot.appendChild(c);
      }
    }

    // Output
    outputSlot.innerHTML = "";
    if (this.furnace.output.id !== null && this.furnace.output.count > 0) {
      outputSlot.appendChild(this.createSlotIcon(this.furnace.output.id));
      if (this.furnace.output.count > 1) {
        const c = document.createElement("span");
        c.className = "slot-count";
        c.textContent = String(this.furnace.output.count);
        outputSlot.appendChild(c);
      }
    }

    // Flame and bars
    flame.classList.toggle("burning", this.furnace.active);
    fuelFill.style.width = this.furnace.maxBurnTime > 0
      ? `${(this.furnace.burnTime / this.furnace.maxBurnTime) * 100}%` : "0%";
    progressFill.style.width = `${this.furnace.smeltProgress * 100}%`;
  }

  /* Attach mouse/touch events to an inventory slot. */
  attachSlotEvents(slotEl, slotIndex) {
    const handleLeftClick = (e) => {
      e.preventDefault(); e.stopPropagation();
      this.inventory.swapWithSlot(slotIndex);
      this.emit("updated");
    };
    const handleRightClick = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this.inventory.cursor.id !== null) {
        this.inventory.placeOne(slotIndex);
      } else {
        this.inventory.pickHalf(slotIndex);
      }
      this.emit("updated");
    };
    slotEl.addEventListener("click", handleLeftClick);
    slotEl.addEventListener("contextmenu", handleRightClick);
  }

  /* Attach events to a crafting grid slot. */
  attachCraftSlotEvents(slotEl, gridIndex, craftingGrid) {
    slotEl.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this.inventory.cursor.id !== null) {
        craftingGrid.placeItem(gridIndex, this.inventory.cursor);
      } else {
        craftingGrid.pickupItem(gridIndex, this.inventory.cursor);
      }
      this.emit("updated");
    });
    slotEl.addEventListener("contextmenu", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this.inventory.cursor.id !== null) {
        craftingGrid.placeItem(gridIndex, this.inventory.cursor);
      } else {
        craftingGrid.pickupItem(gridIndex, this.inventory.cursor);
      }
      this.emit("updated");
    });
  }

  /* Attach events to the crafting output slot. */
  attachCraftOutputEvents(outputEl, craftingGrid) {
    outputEl.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      craftingGrid.takeOutput(this.inventory.cursor);
      this.emit("updated");
    });
    outputEl.addEventListener("contextmenu", (e) => {
      e.preventDefault(); e.stopPropagation();
      craftingGrid.takeOutput(this.inventory.cursor);
      this.emit("updated");
    });
  }

  /* Update the floating cursor display. */
  updateCursor(cursorEl, cursorSwatchEl, cursorCountEl) {
    if (this.inventory.cursor.id === null || this.inventory.cursor.count <= 0) {
      cursorEl.classList.add("hidden");
      return;
    }
    cursorEl.classList.remove("hidden");
    const style = getSwatchStyle(this.inventory.cursor.id, this.swatches, this.atlasCanvas);
    if (style.backgroundImage) {
      cursorSwatchEl.style.backgroundImage = style.backgroundImage;
      cursorSwatchEl.style.backgroundPosition = style.backgroundPosition;
      cursorSwatchEl.style.backgroundSize = style.backgroundSize;
      cursorSwatchEl.style.backgroundRepeat = style.backgroundRepeat;
      cursorSwatchEl.style.imageRendering = "pixelated";
      cursorSwatchEl.style.backgroundColor = "transparent";
    } else {
      cursorSwatchEl.style.backgroundColor = style.backgroundColor;
      cursorSwatchEl.style.backgroundImage = "none";
    }
    if (cursorCountEl) {
      cursorCountEl.textContent = this.inventory.cursor.count > 1 ? String(this.inventory.cursor.count) : "";
    }
  }

  /* Render the health/hunger bars. */
  renderSurvivalHud(stats) {
    const healthBar = document.getElementById("healthBar");
    const hungerBar = document.getElementById("hungerBar");
    if (!healthBar || !hungerBar) return;

    healthBar.innerHTML = "";
    hungerBar.innerHTML = "";

    const hearts = 10;
    for (let i = 0; i < hearts; i++) {
      const heart = document.createElement("div");
      heart.className = "heart";
      const heartHp = i * 2;
      if (stats.health >= heartHp + 2) {
        // full heart
      } else if (stats.health >= heartHp + 1) {
        heart.classList.add("half");
      } else {
        heart.classList.add("empty");
      }
      healthBar.appendChild(heart);
    }

    for (let i = 0; i < hearts; i++) {
      const hunger = document.createElement("div");
      hunger.className = "hunger-icon";
      const hungerPoints = i * 2;
      if (stats.hunger >= hungerPoints + 2) {
        // full
      } else if (stats.hunger >= hungerPoints + 1) {
        hunger.style.background = "linear-gradient(90deg, #c88030 50%, #2a1808 50%)";
      } else {
        hunger.classList.add("empty");
      }
      hungerBar.appendChild(hunger);
    }
  }
}
