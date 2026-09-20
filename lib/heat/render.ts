import { HEAT_GRID } from "./grid";
import type { HeatField } from "./field";
import { getLandFeatures } from "@/lib/globe/land-geo";
import { heatColor } from "./scale";

// Browser-side rasterization of the shared intensity field. The same field is
// painted two ways — an equirectangular texture for the globe and a Web-Mercator
// image for the flat map — through the same sampler and the same color scale, so
// the two surfaces are the same picture on different projections.
//
// Smoothness: the 0.5-degree field is resampled with a Catmull-Rom bicubic
// kernel (C1-continuous, so no visible cell edges or creases), painted at half
// resolution, upscaled with the canvas's own smoothing, and finally clipped to
// the vector land polygons (oceans stay transparent, coasts stay crisp).

export type HeatProjection = "equirect" | "mercator";

export const MERCATOR_MAX_LAT = 85.0511287798;

const LUT_SIZE = 1024;
let lut: { r: Float32Array; g: Float32Array; b: Float32Array; luma: Float32Array; a: Float32Array } | null = null;
function getLut() {
  if (lut) return lut;
  const r = new Float32Array(LUT_SIZE);
  const g = new Float32Array(LUT_SIZE);
  const b = new Float32Array(LUT_SIZE);
  const luma = new Float32Array(LUT_SIZE);
  const a = new Float32Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const c = heatColor((i / (LUT_SIZE - 1)) * 100, 1);
    r[i] = c.r;
    g[i] = c.g;
    b[i] = c.b;
    luma[i] = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    a[i] = c.a;
  }
  lut = { r, g, b, luma, a };
  return lut;
}

function catmullRom(t: number, w: Float32Array | number[], o: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  w[o] = -0.5 * t3 + t2 - 0.5 * t;
  w[o + 1] = 1.5 * t3 - 2.5 * t2 + 1;
  w[o + 2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  w[o + 3] = 0.5 * t3 - 0.5 * t2;
}

function latOfRow(projection: HeatProjection, y: number, h: number): number {
  if (projection === "equirect") return 90 - ((y + 0.5) / h) * 180;
  const n = Math.PI * (1 - (2 * (y + 0.5)) / h);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/** Colors the field into an RGBA ImageData of size w x h (bicubic intensity, nearest confidence). */
export function sampleFieldToImageData(field: HeatField, projection: HeatProjection, w: number, h: number): ImageData {
  const { cols, rows, cell } = HEAT_GRID;
  const { intensity, confidence } = field;
  const L = getLut();
  const img = new ImageData(w, h);
  const out = img.data;

  // Per-column x taps (wrapping) and weights.
  const xIdx = new Int32Array(w * 4);
  const xW = new Float32Array(w * 4);
  const xNear = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    const fx = ((x + 0.5) / w) * 360 / cell - 0.5;
    const x0 = Math.floor(fx);
    catmullRom(fx - x0, xW, x * 4);
    for (let k = 0; k < 4; k++) xIdx[x * 4 + k] = (((x0 - 1 + k) % cols) + cols) % cols;
    xNear[x] = (((Math.round(fx)) % cols) + cols) % cols;
  }
  const yW = new Float32Array(4);
  const yIdx = new Int32Array(4);
  for (let y = 0; y < h; y++) {
    const lat = latOfRow(projection, y, h);
    const fy = (90 - lat) / cell - 0.5;
    const y0 = Math.floor(fy);
    catmullRom(fy - y0, yW, 0);
    for (let k = 0; k < 4; k++) yIdx[k] = Math.min(rows - 1, Math.max(0, y0 - 1 + k)) * cols;
    const nearRow = Math.min(rows - 1, Math.max(0, Math.round(fy))) * cols;
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let j = 0; j < 4; j++) {
        const row = yIdx[j]!;
        const wy = yW[j]!;
        const o = x * 4;
        v += wy * (xW[o]! * intensity[row + xIdx[o]!]! + xW[o + 1]! * intensity[row + xIdx[o + 1]!]! + xW[o + 2]! * intensity[row + xIdx[o + 2]!]! + xW[o + 3]! * intensity[row + xIdx[o + 3]!]!);
      }
      v = v < 0 ? 0 : v > 100 ? 100 : v;
      const li = Math.round((v / 100) * (LUT_SIZE - 1));
      const c = confidence[nearRow + xNear[x]!]!;
      // Subtle confidence effect: <= 18% desaturation, <= 14% opacity (see scale.ts).
      const desat = (1 - c) * 0.18;
      const luma = L.luma[li]!;
      const p = (y * w + x) * 4;
      out[p] = L.r[li]! + (luma - L.r[li]!) * desat;
      out[p + 1] = L.g[li]! + (luma - L.g[li]!) * desat;
      out[p + 2] = L.b[li]! + (luma - L.b[li]!) * desat;
      out[p + 3] = Math.round(L.a[li]! * (0.86 + 0.14 * c) * 255);
    }
  }
  return img;
}

function projectX(lng: number, w: number): number {
  return ((lng + 180) / 360) * w;
}
function projectY(projection: HeatProjection, lat: number, h: number): number {
  if (projection === "equirect") return ((90 - lat) / 180) * h;
  const l = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
  const s = Math.sin((l * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * h;
}

function landPath(projection: HeatProjection, w: number, h: number): Path2D {
  const path = new Path2D();
  for (const f of getLandFeatures()) {
    const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        ring.forEach((pt, i) => {
          const x = projectX(pt[0]!, w);
          const y = projectY(projection, pt[1]!, h);
          if (i === 0) path.moveTo(x, y);
          else path.lineTo(x, y);
        });
        path.closePath();
      }
    }
  }
  return path;
}

const pathCache = new Map<string, Path2D>();

export interface HeatCanvasOptions {
  projection: HeatProjection;
  /** Output width in px; height is width/2 (equirect) or width (mercator). */
  width: number;
}

/** Paints the field for a projection onto a canvas (reused when passed). */
export function renderHeatCanvas(field: HeatField, { projection, width }: HeatCanvasOptions, reuse?: HTMLCanvasElement): HTMLCanvasElement {
  const height = projection === "equirect" ? width / 2 : width;
  const sw = width / 2;
  const sh = height / 2;
  const small = document.createElement("canvas");
  small.width = sw;
  small.height = sh;
  small.getContext("2d")!.putImageData(sampleFieldToImageData(field, projection, sw, sh), 0, 0);

  const canvas = reuse ?? document.createElement("canvas");
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, width, height);
  // Clip to land: oceans stay transparent.
  const key = `${projection}:${width}`;
  let path = pathCache.get(key);
  if (!path) {
    path = landPath(projection, width, height);
    pathCache.set(key, path);
  }
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = "#000";
  ctx.fill(path, "evenodd");
  ctx.globalCompositeOperation = "source-over";
  return canvas;
}
