function fade(t) {
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hash32(seed, x, y = 0, z = 0) {
  let value = seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(z, 0xc2b2ae35);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

export function hash2D(seed, x, y) {
  return hash32(seed, x, y) / 0xffffffff;
}

export class NoiseGenerator {
  constructor(seed) {
    this.seed = seed >>> 0;
  }

  value2D(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const tx = fade(x - x0);
    const ty = fade(y - y0);

    const v00 = hash2D(this.seed, x0, y0) * 2 - 1;
    const v10 = hash2D(this.seed, x1, y0) * 2 - 1;
    const v01 = hash2D(this.seed, x0, y1) * 2 - 1;
    const v11 = hash2D(this.seed, x1, y1) * 2 - 1;

    const a = lerp(v00, v10, tx);
    const b = lerp(v01, v11, tx);
    return lerp(a, b, ty);
  }

  value3D(x, y, z) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const z1 = z0 + 1;
    const tx = fade(x - x0);
    const ty = fade(y - y0);
    const tz = fade(z - z0);

    const c000 = hash32(this.seed, x0, y0, z0) / 0xffffffff * 2 - 1;
    const c100 = hash32(this.seed, x1, y0, z0) / 0xffffffff * 2 - 1;
    const c010 = hash32(this.seed, x0, y1, z0) / 0xffffffff * 2 - 1;
    const c110 = hash32(this.seed, x1, y1, z0) / 0xffffffff * 2 - 1;
    const c001 = hash32(this.seed, x0, y0, z1) / 0xffffffff * 2 - 1;
    const c101 = hash32(this.seed, x1, y0, z1) / 0xffffffff * 2 - 1;
    const c011 = hash32(this.seed, x0, y1, z1) / 0xffffffff * 2 - 1;
    const c111 = hash32(this.seed, x1, y1, z1) / 0xffffffff * 2 - 1;

    const x00 = lerp(c000, c100, tx);
    const x10 = lerp(c010, c110, tx);
    const x01 = lerp(c001, c101, tx);
    const x11 = lerp(c011, c111, tx);
    const y0v = lerp(x00, x10, ty);
    const y1v = lerp(x01, x11, ty);
    return lerp(y0v, y1v, tz);
  }

  fbm2D(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amplitude = 0.5;
    let frequency = 1;
    let sum = 0;
    let normalizer = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      sum += this.value2D(x * frequency, y * frequency) * amplitude;
      normalizer += amplitude;
      frequency *= lacunarity;
      amplitude *= gain;
    }
    return normalizer === 0 ? 0 : sum / normalizer;
  }

  fbm3D(x, y, z, octaves = 3, lacunarity = 2, gain = 0.5) {
    let amplitude = 0.5;
    let frequency = 1;
    let sum = 0;
    let normalizer = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      sum += this.value3D(x * frequency, y * frequency, z * frequency) * amplitude;
      normalizer += amplitude;
      frequency *= lacunarity;
      amplitude *= gain;
    }
    return normalizer === 0 ? 0 : sum / normalizer;
  }
}
