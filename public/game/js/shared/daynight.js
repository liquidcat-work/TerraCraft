import * as THREE from "three";

/*
  createDayNight({ renderer, scene, sun, ambientLight, hemiLight, lightTarget })
  - Creates a procedural sky dome (gradient + sun glow), boxy sun & moon meshes,
    a procedural cloud layer, and a star dome.
  - Returns a state object with .update(delta, playerPos) you should call every frame.
  - Also exposes setRenderDistance(rd), setTimeOfDay(t), setFullbright(bool).
  Adapted from a reference implementation; tuned for this voxel engine.
*/
export function createDayNight(opts = {}) {
  const {
    renderer,
    scene,
    sun,
    ambientLight,
    hemiLight,
    lightTarget,
    sunMesh: providedSunMesh,
    moonMesh: providedMoonMesh,
    skyDome: providedSkyDome,
    cloudGroup: providedCloudGroup,
    cycleScale = 1.0, // multiply all phase durations (1 = realistic ~20min cycle, lower = faster)
    lightingUniforms = null, // { uDaylight, uMinLight, uTorchTint } from main.js
  } = opts;

  // ── Sky dome (gradient + sun glow) ─────────────────────────────────────
  let skyDome = providedSkyDome;
  if (!skyDome) {
    const skyGeo = new THREE.SphereGeometry(20000, 32, 16);
    const skyTex = makeSkyGradientTexture(new THREE.Color(0x1e4877), new THREE.Color(0xaee7ff));
    const skyMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: skyTex,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    skyDome = new THREE.Mesh(skyGeo, skyMat);
    skyDome.frustumCulled = false;
    skyDome.renderOrder = -1000;
    skyDome.userData = {
      topColor: new THREE.Color(0x1e4877),
      bottomColor: new THREE.Color(0xaee7ff),
      skyTexture: skyTex,
      skyCanvas: skyTex.image,
      skyContext: skyTex.image.getContext("2d"),
    };
    scene.add(skyDome);
  }

  // ── Sun & moon (boxy, voxel style) ─────────────────────────────────────
  let sunMesh = providedSunMesh;
  if (!sunMesh) {
    const g = new THREE.BoxGeometry(48, 48, 48);
    const m = new THREE.MeshBasicMaterial({ color: 0xfff1d6, fog: false });
    m.toneMapped = false;
    m.depthTest = false;
    m.depthWrite = false;
    sunMesh = new THREE.Mesh(g, m);
    sunMesh.frustumCulled = false;
    sunMesh.renderOrder = -990;
    scene.add(sunMesh);
  }

  let moonMesh = providedMoonMesh;
  if (!moonMesh) {
    const g = new THREE.BoxGeometry(36, 36, 36);
    const m = new THREE.MeshBasicMaterial({ color: 0xdde6ff, fog: false });
    m.toneMapped = false;
    m.depthTest = false;
    m.depthWrite = false;
    moonMesh = new THREE.Mesh(g, m);
    moonMesh.frustumCulled = false;
    moonMesh.renderOrder = -990;
    scene.add(moonMesh);
  }

  // ── Procedural cloud layer (no external texture) ───────────────────────
  let cloudGroup = providedCloudGroup;
  if (!cloudGroup) {
    cloudGroup = new THREE.Group();
    cloudGroup.name = "proceduralClouds";

    // Generate a soft puffy cloud canvas → texture
    const tex = makeCloudTexture(256);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;

    const planeGeo = new THREE.PlaneGeometry(6000, 6000);
    const cloudMat = new THREE.MeshBasicMaterial({
      alphaMap: tex,
      transparent: true,
      opacity: 0.42,
      alphaTest: 0.08,
      depthWrite: false,
      side: THREE.DoubleSide,
      color: 0xffffff,
      fog: false,
    });
    const mesh = new THREE.Mesh(planeGeo, cloudMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 176;
    mesh.renderOrder = -800;
    mesh.frustumCulled = false;
    cloudGroup.add(mesh);
    cloudGroup.userData = { driftSpeed: 1.1 };
    scene.add(cloudGroup);
  }

  // ── Star dome (shader points, twinkling) ───────────────────────────────
  const starCount = 240;
  const starRadius = 980;
  const starPositions = new Float32Array(starCount * 3);
  const starSizes = new Float32Array(starCount);
  const starBrightness = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.cos(phi);
    const z = Math.sin(phi) * Math.sin(theta);
    const r = starRadius * (0.97 + Math.random() * 0.05);
    starPositions[i * 3 + 0] = x * r;
    starPositions[i * 3 + 1] = y * r;
    starPositions[i * 3 + 2] = z * r;
    starSizes[i] = 1.0 + Math.random() * 2.5;
    starBrightness[i] = 0.6 + Math.random() * 0.9;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  starGeo.setAttribute("size", new THREE.BufferAttribute(starSizes, 1));
  starGeo.setAttribute("brightness", new THREE.BufferAttribute(starBrightness, 1));

  // Use plain PointsMaterial so the star dome is compatible with both WebGL
  // and the WebGPU NodeMaterial pipeline (which rejects ShaderMaterial).
  const starMat = new THREE.PointsMaterial({
    size: 2.5,
    sizeAttenuation: true,
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  const starDome = new THREE.Points(starGeo, starMat);
  starDome.frustumCulled = false;
  starDome.renderOrder = -950;
  scene.add(starDome);

  // ── State ──────────────────────────────────────────────────────────────
  const state = {
    time: 0.25, // start mid-morning
    // Start partway through the "day" phase so a fresh world spawn isn't
    // greeted with pre-sunrise pitch black. Roughly noon.
    _phaseTime: 90 * cycleScale + 180 * cycleScale,
    _starSpin: 0,
    _durations: {
      sunrise: 90 * cycleScale,
      day: 360 * cycleScale,
      sunset: 90 * cycleScale,
      night: 240 * cycleScale,
    },
    _baseFogDensity: 0.004,
    renderDistance: 16,
    fullbright: false,
    lightingUniforms,
    sun, ambientLight, hemiLight, sunMesh, moonMesh, skyDome, cloudGroup, stars: starDome,

    setRenderDistance(rd) {
      this.renderDistance = Math.max(1, Math.floor(rd) || 1);
    },
    setTimeOfDay(t) {
      const d = this._durations;
      const total = d.sunrise + d.day + d.sunset + d.night;
      this._phaseTime = ((t % 1) + 1) % 1 * total;
    },
    setFullbright(v) { this.fullbright = !!v; },

    update(delta, playerPos) {
      const d = this._durations;
      const total = d.sunrise + d.day + d.sunset + d.night;
      this._phaseTime = (this._phaseTime + delta) % total;

      // Map phase time → angle so sunrise covers ~90°→0° (sunAlt 0→1 quickly),
      // day covers 0°…180° peak, sunset 180°→270°, night 270°→360°.
      // Easiest: use a piecewise mapping into normalized cycle [0,1).
      let t = this._phaseTime;
      let cycle;
      if (t < d.sunrise) {
        cycle = (t / d.sunrise) * 0.125; // 0 .. 0.125 (sun rising)
      } else if (t < d.sunrise + d.day) {
        cycle = 0.125 + ((t - d.sunrise) / d.day) * 0.375; // 0.125 .. 0.5
      } else if (t < d.sunrise + d.day + d.sunset) {
        cycle = 0.5 + ((t - d.sunrise - d.day) / d.sunset) * 0.125; // 0.5 .. 0.625
      } else {
        cycle = 0.625 + ((t - d.sunrise - d.day - d.sunset) / d.night) * 0.375; // 0.625 .. 1
      }
      this.time = cycle;
      const angle = cycle * Math.PI * 2;
      const sunAlt = Math.sin(angle);

      const dist = 450;
      const ox = playerPos.x, oy = playerPos.y, oz = playerPos.z;

      // Sun & moon orbit overhead
      if (this.sunMesh) {
        this.sunMesh.position.set(
          ox + Math.cos(angle) * dist,
          oy + Math.sin(angle) * dist,
          oz + Math.sin(angle * 0.5) * 60
        );
      }
      if (this.moonMesh) {
        this.moonMesh.position.set(
          ox + Math.cos(angle + Math.PI) * dist,
          oy + Math.sin(angle + Math.PI) * dist,
          oz + Math.sin((angle + Math.PI) * 0.5) * 60
        );
      }

      if (this.skyDome) {
        this.skyDome.position.copy(playerPos);
      }

      // Star dome follows player + spins
      if (this.stars) {
        this.stars.position.copy(playerPos);
        this._starSpin += delta * 0.05;
        this.stars.rotation.y = angle + this._starSpin;
      }

      // Clouds drift slowly
      if (this.cloudGroup) {
        const speed = (this.cloudGroup.userData && this.cloudGroup.userData.driftSpeed) || 2;
        this.cloudGroup.position.x = ox;
        this.cloudGroup.position.z = oz;
        this.cloudGroup.children.forEach((c) => {
          const tex = c.material?.alphaMap || c.material?.map;
          if (tex) {
            tex.offset.x += delta * speed * 0.00035;
            tex.offset.y += delta * speed * 0.00018;
          }
        });
      }

      if (this.fullbright) {
        if (this.sun) this.sun.intensity = 1.4;
        if (this.ambientLight) this.ambientLight.intensity = 1.2;
        if (this.hemiLight) this.hemiLight.intensity = 0.9;
        if (this.skyDome) {
          this.skyDome.userData.topColor.set(0x7fcfff);
          this.skyDome.userData.bottomColor.set(0xcff7ff);
          paintSkyDome(this.skyDome);
        }
        if (this.stars) this.stars.material.opacity = 0;
        try { if (renderer) renderer.toneMappingExposure = 1.15; } catch {}
        if (scene.fog) scene.fog.color.set(0xaee7ff);
        // Fullbright: chunks fully lit ignoring sky/block channels.
        if (this.lightingUniforms) {
          this.lightingUniforms.uDaylight.value = 1.0;
          this.lightingUniforms.uMinLight.value = 1.0;
        }
        return;
      }

      const sunFactor = Math.max(0, sunAlt);
      const moonFactor = Math.max(0, Math.sin(angle + Math.PI));

      // ── Drive chunk shader light uniforms ────────────────────────────────
      // Daylight goes from ~0.04 deep night (only moon) up to 1.0 at noon.
      // Smooth ramp via sunFactor; moonlight contributes a tiny bluish base.
      if (this.lightingUniforms) {
        // Very aggressive curve: snaps to full brightness shortly after sunrise
        // and only drops in the last sliver of sunset. Day stays vivid.
        const eased = Math.pow(sunFactor, 0.18);
        const day = THREE.MathUtils.clamp(eased * 1.5 + moonFactor * 0.28, 0.0, 1.0);
        this.lightingUniforms.uDaylight.value = day;
        // Brighter night floor — moonlit world is readable, caves still dark
        // because skylight doesn't reach them.
        this.lightingUniforms.uMinLight.value = 0.18 + moonFactor * 0.14 + sunFactor * 0.05;
      }

      // Directional sun light — kept low so chunk light-map dominates.
      if (this.sun) {
        this.sun.intensity = sunFactor * 0.9 + moonFactor * 0.28;
        const warm = new THREE.Color(0xfff2c4);
        const cool = new THREE.Color(0x99aaff);
        this.sun.color.copy(sunAlt > 0 ? warm : cool);
        if (this.sunMesh) this.sun.position.copy(this.sunMesh.position);
        if (lightTarget) lightTarget.position.set(playerPos.x, 0, playerPos.z);
      }

      // Ambient + hemisphere — also kept low; the worker-baked light supplies
      // the per-voxel brightness, these only affect non-chunk meshes (mobs,
      // arm, particles).
      if (this.ambientLight) {
        this.ambientLight.intensity = 0.16 + sunFactor * 0.42 + moonFactor * 0.16;
      }
      if (this.hemiLight) {
        const hemiSkyDay = new THREE.Color(0xdff3ff);
        const hemiSkyNight = new THREE.Color(0x22334a);
        const hemiGroundDay = new THREE.Color(0x4e6a52);
        const hemiGroundNight = new THREE.Color(0x1b1b2a);
        this.hemiLight.intensity = 0.22 + sunFactor * 0.5 + moonFactor * 0.16;
        this.hemiLight.color.copy(hemiSkyNight.clone().lerp(hemiSkyDay, sunFactor));
        this.hemiLight.groundColor.copy(hemiGroundNight.clone().lerp(hemiGroundDay, sunFactor));
      }

      // Sky colors + fog
      const dayTop = new THREE.Color(0x1e4877);
      const dayBottom = new THREE.Color(0xaee7ff);
      const nightTop = new THREE.Color(0x01030a);
      const nightBottom = new THREE.Color(0x040a1c);
      const sunsetBottom = new THREE.Color(0xffa07a);
      const sunsetTop = new THREE.Color(0x6a2a4a);

      let fogColor;
      let topC, botC;
      if (sunAlt > 0.2) {
        topC = dayTop; botC = dayBottom; fogColor = dayBottom.clone();
      } else if (sunAlt < -0.1) {
        topC = nightTop; botC = nightBottom; fogColor = nightBottom.clone();
      } else {
        const k = (sunAlt + 0.1) / 0.3;
        topC = nightTop.clone().lerp(dayTop, k);
        botC = nightBottom.clone().lerp(dayBottom, k);
        const sunsetMix = 1.0 - Math.min(1, Math.abs(sunAlt) / 0.15);
        topC.lerp(sunsetTop, sunsetMix * 0.6);
        botC.lerp(sunsetBottom, sunsetMix);
        fogColor = botC.clone();
      }
      if (this.skyDome) {
        this.skyDome.userData.topColor.copy(topC);
        this.skyDome.userData.bottomColor.copy(botC);
        paintSkyDome(this.skyDome);
      }
      if (scene.fog) scene.fog.color.copy(fogColor);
      if (scene.background && scene.background.isColor) scene.background.copy(fogColor);

      // Renderer exposure
      try {
        if (renderer) {
          // Brighter overall — day pops, night isn't crushed.
          const exposureDay = 1.3, exposureNight = 1.05;
          const tExp = THREE.MathUtils.lerp(exposureNight, exposureDay, Math.pow(sunFactor, 0.4));
          renderer.toneMappingExposure = THREE.MathUtils.clamp(tExp, 0.95, 1.5);
        }
      } catch {}

      // Stars: fade in at night
      if (this.stars) {
        const tNight = THREE.MathUtils.smoothstep(-0.15, 0.25, -sunAlt);
        this.stars.material.opacity = THREE.MathUtils.clamp(tNight, 0, 1);
      }

      // Cloud tint follows sky
      if (this.cloudGroup) {
        const cloudDay = new THREE.Color(0xffffff);
        const cloudNight = new THREE.Color(0x223044);
        const tint = cloudNight.clone().lerp(cloudDay, THREE.MathUtils.clamp(sunFactor + 0.2, 0, 1));
        this.cloudGroup.children.forEach((c) => {
          if (c.material && c.material.color) c.material.color.copy(tint);
        });
      }
    },

    dispose() {
      if (this.skyDome) { scene.remove(this.skyDome); this.skyDome.geometry.dispose(); this.skyDome.material.dispose(); }
      if (this.sunMesh) { scene.remove(this.sunMesh); this.sunMesh.geometry.dispose(); this.sunMesh.material.dispose(); }
      if (this.moonMesh) { scene.remove(this.moonMesh); this.moonMesh.geometry.dispose(); this.moonMesh.material.dispose(); }
      if (this.stars) { scene.remove(this.stars); this.stars.geometry.dispose(); this.stars.material.dispose(); }
      if (this.cloudGroup) {
        scene.remove(this.cloudGroup);
        this.cloudGroup.children.forEach((c) => {
          c.geometry.dispose();
          if (c.material.map) c.material.map.dispose();
          c.material.dispose();
        });
      }
    },
  };

  return state;
}

// Tint the sky dome by averaging the top + bottom colors. Vertex-color
// gradients don't propagate reliably through WebGPURenderer conversion, so the
// sky uses a tiny unlit CanvasTexture gradient. It never receives/casts light,
// never writes depth, and stays compatible with WebGL + WebGPU fallback.
function paintSkyDome(dome) {
  const top = dome.userData.topColor;
  const bot = dome.userData.bottomColor;
  const tex = dome.userData.skyTexture;
  const ctx = dome.userData.skyContext;
  const canvas = dome.userData.skyCanvas;
  if (!tex || !ctx || !canvas) {
    dome.material.color.copy(bot).lerp(top, 0.3);
    return;
  }
  // Repaint the canvas gradient only when the colors changed enough to be
  // visible. Redrawing every frame uploads a fresh GPU texture, which is by
  // far the most expensive part of the day/night update.
  const last = dome.userData._lastPaint || (dome.userData._lastPaint = { tr:-1, tg:-1, tb:-1, br:-1, bg:-1, bb:-1 });
  const dt = Math.abs(top.r - last.tr) + Math.abs(top.g - last.tg) + Math.abs(top.b - last.tb);
  const db = Math.abs(bot.r - last.br) + Math.abs(bot.g - last.bg) + Math.abs(bot.b - last.bb);
  if (dt + db < 0.012) return;
  last.tr = top.r; last.tg = top.g; last.tb = top.b;
  last.br = bot.r; last.bg = bot.g; last.bb = bot.b;
  drawSkyGradient(ctx, canvas.width, canvas.height, top, bot);
  tex.needsUpdate = true;
}

function makeSkyGradientTexture(top, bot) {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  drawSkyGradient(ctx, canvas.width, canvas.height, top, bot);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function drawSkyGradient(ctx, w, h, top, bot) {
  ctx.imageSmoothingEnabled = true;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.00, colorToCss(top.clone().multiplyScalar(1.22)));
  g.addColorStop(0.42, colorToCss(top.clone().lerp(bot, 0.52)));
  g.addColorStop(0.78, colorToCss(bot));
  g.addColorStop(1.00, colorToCss(bot.clone().multiplyScalar(1.08)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function colorToCss(c) {
  return `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
}

// Procedurally generate a soft puffy cloud texture using layered noise circles.
function makeCloudTexture(size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Transparent background
  ctx.clearRect(0, 0, size, size);

  // Many soft white blobs
  const blobCount = 80;
  for (let i = 0; i < blobCount; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 12 + Math.random() * 36;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.6, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Wrap-edge blobs so the texture tiles seamlessly
  for (let i = 0; i < 24; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 14 + Math.random() * 28;
    [-size, 0, size].forEach((dx) => {
      [-size, 0, size].forEach((dy) => {
        if (dx === 0 && dy === 0) return;
        const grad = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grad.addColorStop(0, "rgba(255,255,255,0.9)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      });
    });
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
