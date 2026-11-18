import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import type { CapturedPage, HighlightSensitivity, OcrLanguage } from "../types";

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface SensitivityThresholds {
  pixelChroma: number;
  wordMeanChroma: number;
  wordCoverage: number;
}

interface PassageCandidate {
  tokens: string[];
  confSum: number;
  confCount: number;
  firstBox: Rect;
  lastBox: Rect;
}

const SENSITIVITY_MAP: Record<HighlightSensitivity, SensitivityThresholds> = {
  high: { pixelChroma: 11.0, wordMeanChroma: 14.0, wordCoverage: 0.46 },
  medium: { pixelChroma: 13.2, wordMeanChroma: 16.8, wordCoverage: 0.54 },
  low: { pixelChroma: 16.8, wordMeanChroma: 20.0, wordCoverage: 0.62 },
};

const workerCache = new Map<string, Worker>();

async function getOfflineWorker(
  language: OcrLanguage,
  onStatus?: (progress: number, status: string) => void
): Promise<Worker> {
  const existing = workerCache.get(language);
  if (existing) {
    return existing;
  }

  // Keep memory bounded on mobile devices by keeping at most 2 workers cached
  if (workerCache.size >= 2) {
    const oldestKey = workerCache.keys().next().value;
    if (oldestKey) {
      const oldest = workerCache.get(oldestKey);
      workerCache.delete(oldestKey);
      if (oldest) {
        try {
          await oldest.terminate();
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  const langs = language === "eng+fas" ? ["eng", "fas"] : [language];

  const worker = await createWorker(langs, OEM.LSTM_ONLY, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract",
    langPath: "/tesseract/lang",
    gzip: true,
    workerBlobURL: false,
    logger: (msg) => {
      if (onStatus && typeof msg.progress === "number") {
        if (msg.status === "loading tesseract core" || msg.status === "initializing tesseract") {
          onStatus(Math.round(msg.progress * 20), "در حال راه‌اندازی موتور OCR آفلاین...");
        } else if (msg.status === "loading language traineddata" || msg.status === "initializing api") {
          onStatus(20 + Math.round(msg.progress * 20), "در حال بارگذاری مدل زبانی آفلاین...");
        } else if (msg.status === "recognizing text") {
          onStatus(40 + Math.round(msg.progress * 55), "در حال تشخیص متن و تطبیق هایلایت‌ها...");
        }
      }
    },
  });

  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
  });

  workerCache.set(language, worker);
  return worker;
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("خطا در بارگذاری تصویر برای پردازش آفلاین."));
    img.src = dataUrl;
  });
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Computes a grayscale array at base dimensions and builds an upscaled, white-balanced,
 * shadow-free, contrast-enhanced OCR canvas. Per-channel (R, G, B) local background
 * division removes warm color casts and uneven lighting shadows, while taking max(R, G, B)
 * makes colored highlighter ink nearly transparent so black printed text is razor-sharp.
 */
function buildEnhancedOcrCanvas(
  sourceCanvas: HTMLCanvasElement,
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): { ocrCanvas: HTMLCanvasElement; ocrScale: number; gray: Uint8Array } {
  const pixelCount = width * height;
  const gray = new Uint8Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    gray[i] = Math.round(0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2]);
  }

  // Upscale dense/small pages so LSTM cap-height reaches ~32-42px for accurate character reading
  const maxOcrDim = 3200;
  const desiredWidth = width < 2400 ? Math.min(width * 2, 2900) : width;
  const ocrScale = Math.min(desiredWidth / width, maxOcrDim / Math.max(width, height));
  const ocrW = Math.max(1, Math.round(width * ocrScale));
  const ocrH = Math.max(1, Math.round(height * ocrScale));

  const ocrCanvas = document.createElement("canvas");
  ocrCanvas.width = ocrW;
  ocrCanvas.height = ocrH;
  const ocrCtx = ocrCanvas.getContext("2d", { willReadFrequently: true });
  if (!ocrCtx) return { ocrCanvas, ocrScale: 1, gray };

  ocrCtx.imageSmoothingEnabled = true;
  ocrCtx.imageSmoothingQuality = "high";
  ocrCtx.drawImage(sourceCanvas, 0, 0, ocrW, ocrH);

  const ocrImg = ocrCtx.getImageData(0, 0, ocrW, ocrH);
  const oData = ocrImg.data;

  // Per-channel 24x24 85th-percentile local background -> removes warm cast & localized shadows
  const gridN = 24;
  const bgR = new Float32Array(gridN * gridN);
  const bgG = new Float32Array(gridN * gridN);
  const bgB = new Float32Array(gridN * gridN);

  for (let gy = 0; gy < gridN; gy++) {
    const y0 = Math.floor((gy * ocrH) / gridN);
    const y1 = Math.floor(((gy + 1) * ocrH) / gridN);
    for (let gx = 0; gx < gridN; gx++) {
      const x0 = Math.floor((gx * ocrW) / gridN);
      const x1 = Math.floor(((gx + 1) * ocrW) / gridN);

      const hR = new Uint32Array(256);
      const hG = new Uint32Array(256);
      const hB = new Uint32Array(256);
      let count = 0;

      for (let y = y0; y < y1; y += 2) {
        const ro = y * ocrW * 4;
        for (let x = x0; x < x1; x += 2) {
          const idx = ro + x * 4;
          hR[oData[idx]]++;
          hG[oData[idx + 1]]++;
          hB[oData[idx + 2]]++;
          count++;
        }
      }

      const p85 = (hist: Uint32Array) => {
        const target = count * 0.85;
        let acc = 0;
        for (let v = 0; v < 256; v++) {
          acc += hist[v];
          if (acc >= target) return Math.max(85, v);
        }
        return 220;
      };

      const tid = gy * gridN + gx;
      bgR[tid] = p85(hR);
      bgG[tid] = p85(hG);
      bgB[tid] = p85(hB);
    }
  }

  for (let y = 0; y < ocrH; y++) {
    const fy = ((y + 0.5) / ocrH) * gridN - 0.5;
    const gy0 = Math.max(0, Math.min(gridN - 1, Math.floor(fy)));
    const gy1 = Math.max(0, Math.min(gridN - 1, gy0 + 1));
    const wy = Math.max(0, Math.min(1, fy - gy0));
    const ro = y * ocrW * 4;

    for (let x = 0; x < ocrW; x++) {
      const fx = ((x + 0.5) / ocrW) * gridN - 0.5;
      const gx0 = Math.max(0, Math.min(gridN - 1, Math.floor(fx)));
      const gx1 = Math.max(0, Math.min(gridN - 1, gx0 + 1));
      const wx = Math.max(0, Math.min(1, fx - gx0));

      const i00 = gy0 * gridN + gx0;
      const i10 = gy0 * gridN + gx1;
      const i01 = gy1 * gridN + gx0;
      const i11 = gy1 * gridN + gx1;

      const rBg =
        (bgR[i00] * (1 - wx) + bgR[i10] * wx) * (1 - wy) +
        (bgR[i01] * (1 - wx) + bgR[i11] * wx) * wy;
      const gBg =
        (bgG[i00] * (1 - wx) + bgG[i10] * wx) * (1 - wy) +
        (bgG[i01] * (1 - wx) + bgG[i11] * wx) * wy;
      const bBg =
        (bgB[i00] * (1 - wx) + bgB[i10] * wx) * (1 - wy) +
        (bgB[i01] * (1 - wx) + bgB[i11] * wx) * wy;

      const idx = ro + x * 4;
      const nr = (oData[idx] / rBg) * 245;
      const ng = (oData[idx + 1] / gBg) * 245;
      const nb = (oData[idx + 2] / bBg) * 245;

      // Max channel keeps colored highlighters & blue pen ink near white while black printed text stays near 0;
      // 72..235 stretch keeps the 1-2px gray gap between letters and pen underlines open without haloing
      const luma = Math.min(255, Math.max(nr, ng, nb));
      const stretched = clampByte(((luma - 72) * 255) / 163);
      oData[idx] = stretched;
      oData[idx + 1] = stretched;
      oData[idx + 2] = stretched;
      oData[idx + 3] = 255;
    }
  }

  ocrCtx.putImageData(ocrImg, 0, 0);
  return { ocrCanvas, ocrScale, gray };
}

/**
 * Detects dark mobile screenshot UI chrome and strictly printed boxed tables/callouts
 * deterministically so non-prose layout artifacts are excluded without touching pen underlines.
 */
function detectExcludedRects(gray: Uint8Array, width: number, height: number): Rect[] {
  const excluded: Rect[] = [];

  // 1. Dark UI bars at top/bottom edges of mobile screenshots
  let topBarBottom = 0;
  for (let y = 0; y < Math.floor(height * 0.14); y++) {
    let sum = 0;
    const ro = y * width;
    for (let x = 0; x < width; x += 4) sum += gray[ro + x];
    const avg = sum / Math.ceil(width / 4);
    if (avg < 95) topBarBottom = y + 6;
    else if (y > topBarBottom + 12) break;
  }
  if (topBarBottom > 12) {
    excluded.push({ x0: 0, y0: 0, x1: width, y1: topBarBottom });
  }

  let bottomBarTop = height;
  for (let y = height - 1; y > Math.floor(height * 0.86); y--) {
    let sum = 0;
    const ro = y * width;
    for (let x = 0; x < width; x += 4) sum += gray[ro + x];
    const avg = sum / Math.ceil(width / 4);
    if (avg < 95) bottomBarTop = y - 6;
    else if (y < bottomBarTop - 12) break;
  }
  if (bottomBarTop < height - 12) {
    excluded.push({ x0: 0, y0: bottomBarTop, x1: width, y1: height });
  }

  // 2. Detect dark shaded callout/box headers (e.g., BOX 76.1) and extend to their bottom border
  const minBannerW = Math.floor(width * 0.22);
  const maxBannerW = Math.floor(width * 0.78);
  const bannerRows: Array<{ y: number; x0: number; x1: number }> = [];

  for (let y = 16; y < height - 40; y += 2) {
    const ro = y * width;
    let runStart = -1;
    let gap = 0;
    for (let x = 0; x < width; x++) {
      const isShaded = gray[ro + x] < 145;
      if (isShaded) {
        if (runStart === -1) runStart = x;
        gap = 0;
      } else if (runStart !== -1) {
        gap++;
        if (gap > 14) {
          const end = x - gap;
          const len = end - runStart;
          if (len >= minBannerW && len <= maxBannerW) {
            bannerRows.push({ y, x0: runStart, x1: end });
          }
          runStart = -1;
          gap = 0;
        }
      }
    }
    if (runStart !== -1) {
      const len = width - runStart;
      if (len >= minBannerW && len <= maxBannerW) {
        bannerRows.push({ y, x0: runStart, x1: width });
      }
    }
  }

  let bIdx = 0;
  while (bIdx < bannerRows.length) {
    const first = bannerRows[bIdx];
    let lastY = first.y;
    let bx0 = first.x0;
    let bx1 = first.x1;
    let rowCount = 1;

    while (
      bIdx + 1 < bannerRows.length &&
      bannerRows[bIdx + 1].y - lastY <= 4 &&
      Math.abs(bannerRows[bIdx + 1].x0 - bx0) < 30 &&
      Math.abs(bannerRows[bIdx + 1].x1 - bx1) < 30
    ) {
      bIdx++;
      lastY = bannerRows[bIdx].y;
      bx0 = Math.min(bx0, bannerRows[bIdx].x0);
      bx1 = Math.max(bx1, bannerRows[bIdx].x1);
      rowCount++;
    }

    if (rowCount >= 10 && lastY - first.y >= 20) {
      let boxBottom = lastY + 10;
      const scanLimit = Math.min(height - 10, lastY + Math.floor(height * 0.45));
      for (let y = lastY + 20; y < scanLimit; y++) {
        const ro = y * width;
        let darkCount = 0;
        const span = Math.max(1, bx1 - bx0);
        for (let x = bx0 + 4; x < bx1 - 4; x += 2) {
          if (gray[ro + x] < 165) darkCount++;
        }
        const ratio = (darkCount * 2) / span;
        if (ratio > 0.72) {
          boxBottom = y + 8;
        }
      }
      excluded.push({ x0: bx0 - 8, y0: first.y - 8, x1: bx1 + 8, y1: boxBottom });
    }
    bIdx++;
  }

  // 3. Detect strict thin-ruled rectangular tables/boxes
  interface HRule {
    y: number;
    x0: number;
    x1: number;
  }
  const hRules: HRule[] = [];
  const minRuleW = Math.floor(width * 0.24);
  const maxRuleW = Math.floor(width * 0.90);

  for (let y = 16; y < height - 16; y += 2) {
    const ro = y * width;
    const roAbove = Math.max(0, y - 4) * width;
    const roBelow = Math.min(height - 1, y + 4) * width;
    let runStart = -1;
    let gap = 0;
    for (let x = 0; x < width; x++) {
      const isThinRulePx =
        gray[ro + x] < 145 && gray[roAbove + x] > 165 && gray[roBelow + x] > 165;
      if (isThinRulePx) {
        if (runStart === -1) runStart = x;
        gap = 0;
      } else if (runStart !== -1) {
        gap++;
        if (gap > 3) {
          const end = x - gap;
          const len = end - runStart;
          if (len >= minRuleW && len <= maxRuleW) {
            hRules.push({ y, x0: runStart, x1: end });
          }
          runStart = -1;
          gap = 0;
        }
      }
    }
  }

  const hasVerticalBorder = (xTarget: number, yStart: number, yEnd: number): boolean => {
    const span = yEnd - yStart;
    if (span < 60) return false;
    let darkRows = 0;
    for (let y = yStart; y <= yEnd; y += 2) {
      let minVal = 255;
      for (let dx = -4; dx <= 4; dx++) {
        const xx = Math.max(0, Math.min(width - 1, xTarget + dx));
        const val = gray[y * width + xx];
        if (val < minVal) minVal = val;
      }
      if (minVal < 160) darkRows++;
    }
    return darkRows / Math.ceil(span / 2) > 0.82;
  };

  for (let i = 0; i < hRules.length; i++) {
    const topRule = hRules[i];
    let bestRect: Rect | null = null;
    for (let j = i + 1; j < hRules.length; j++) {
      const botRule = hRules[j];
      const dy = botRule.y - topRule.y;
      if (dy < 60) continue;
      if (dy > height * 0.55) break;
      if (Math.abs(botRule.x0 - topRule.x0) > 20 || Math.abs(botRule.x1 - topRule.x1) > 20) continue;

      const overlapX0 = Math.max(topRule.x0, botRule.x0);
      const overlapX1 = Math.min(topRule.x1, botRule.x1);
      if (overlapX1 - overlapX0 < minRuleW) continue;

      if (hasVerticalBorder(overlapX0, topRule.y, botRule.y) && hasVerticalBorder(overlapX1, topRule.y, botRule.y)) {
        bestRect = {
          x0: overlapX0 - 6,
          y0: topRule.y - 6,
          x1: overlapX1 + 6,
          y1: botRule.y + 6,
        };
      }
    }
    if (bestRect) {
      excluded.push(bestRect);
      while (i + 1 < hRules.length && hRules[i + 1].y <= bestRect.y1) i++;
    }
  }

  return excluded;
}

/**
 * Creates a 6x6 spatial white-balanced bare-paper lookup using the lowest-chroma 15%
 * of bright pixels so faint pastel/sage/yellow highlights separate cleanly from paper,
 * and scores strictly within the core letter-body vertical band (15%..76%) so pen underlines
 * sitting below the baseline never trigger false highlight detections.
 */
function createWordHighlightScorer(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  thresholds: SensitivityThresholds
) {
  const globalSamples: Array<{ chroma: number; r: number; g: number; b: number }> = [];
  for (let y = 0; y < height; y += 5) {
    const ro = y * width * 4;
    for (let x = 0; x < width; x += 5) {
      const idx = ro + x * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const avg = (r + g + b) / 3;
      if (avg > 115 && avg < 248) {
        globalSamples.push({ chroma: Math.max(r, g, b) - Math.min(r, g, b), r, g, b });
      }
    }
  }

  let globalPaperR = 225;
  let globalPaperG = 220;
  let globalPaperB = 212;
  let pureChromaThreshold = 20;

  if (globalSamples.length > 0) {
    globalSamples.sort((a, b) => a.chroma - b.chroma);
    const takeCount = Math.max(1, Math.floor(globalSamples.length * 0.15));
    let sR = 0;
    let sG = 0;
    let sB = 0;
    for (let i = 0; i < takeCount; i++) {
      sR += globalSamples[i].r;
      sG += globalSamples[i].g;
      sB += globalSamples[i].b;
    }
    globalPaperR = Math.max(70, sR / takeCount);
    globalPaperG = Math.max(70, sG / takeCount);
    globalPaperB = Math.max(70, sB / takeCount);
    pureChromaThreshold =
      globalSamples[Math.min(globalSamples.length - 1, Math.floor(globalSamples.length * 0.3))].chroma + 8;
  }

  const gridN = 6;
  const tileR = new Float32Array(gridN * gridN);
  const tileG = new Float32Array(gridN * gridN);
  const tileB = new Float32Array(gridN * gridN);

  for (let gy = 0; gy < gridN; gy++) {
    const y0 = Math.floor((gy * height) / gridN);
    const y1 = Math.floor(((gy + 1) * height) / gridN);
    for (let gx = 0; gx < gridN; gx++) {
      const x0 = Math.floor((gx * width) / gridN);
      const x1 = Math.floor(((gx + 1) * width) / gridN);

      const tileSamples: Array<{ chroma: number; r: number; g: number; b: number }> = [];
      for (let y = y0; y < y1; y += 4) {
        const ro = y * width * 4;
        for (let x = x0; x < x1; x += 4) {
          const idx = ro + x * 4;
          const r = rgba[idx];
          const g = rgba[idx + 1];
          const b = rgba[idx + 2];
          const avg = (r + g + b) / 3;
          if (avg > 105 && avg < 248) {
            tileSamples.push({ chroma: Math.max(r, g, b) - Math.min(r, g, b), r, g, b });
          }
        }
      }

      const tid = gy * gridN + gx;
      if (tileSamples.length > 30) {
        tileSamples.sort((a, b) => a.chroma - b.chroma);
        const takeCount = Math.max(8, Math.floor(tileSamples.length * 0.15));
        if (tileSamples[Math.floor(takeCount / 2)].chroma <= pureChromaThreshold) {
          let sR = 0;
          let sG = 0;
          let sB = 0;
          for (let i = 0; i < takeCount; i++) {
            sR += tileSamples[i].r;
            sG += tileSamples[i].g;
            sB += tileSamples[i].b;
          }
          tileR[tid] = Math.max(70, sR / takeCount);
          tileG[tid] = Math.max(70, sG / takeCount);
          tileB[tid] = Math.max(70, sB / takeCount);
          continue;
        }
      }
      tileR[tid] = globalPaperR;
      tileG[tid] = globalPaperG;
      tileB[tid] = globalPaperB;
    }
  }

  return (bbox: Rect) => {
    const boxH = Math.max(4, bbox.y1 - bbox.y0);
    const x0 = Math.max(0, Math.round(bbox.x0));
    const x1 = Math.min(width, Math.round(bbox.x1));
    const y0 = Math.max(0, Math.round(bbox.y0 + boxH * 0.15));
    const y1 = Math.min(height, Math.max(y0 + 2, Math.round(bbox.y0 + boxH * 0.76)));

    let bgPixels = 0;
    let hlPixels = 0;
    let sumChroma = 0;

    for (let y = y0; y < y1; y++) {
      const fy = ((y + 0.5) / height) * gridN - 0.5;
      const gy0 = Math.max(0, Math.min(gridN - 1, Math.floor(fy)));
      const gy1 = Math.max(0, Math.min(gridN - 1, gy0 + 1));
      const wy = Math.max(0, Math.min(1, fy - gy0));
      const ro = y * width * 4;

      for (let x = x0; x < x1; x++) {
        const fx = ((x + 0.5) / width) * gridN - 0.5;
        const gx0 = Math.max(0, Math.min(gridN - 1, Math.floor(fx)));
        const gx1 = Math.max(0, Math.min(gridN - 1, gx0 + 1));
        const wx = Math.max(0, Math.min(1, fx - gx0));

        const i00 = gy0 * gridN + gx0;
        const i10 = gy0 * gridN + gx1;
        const i01 = gy1 * gridN + gx0;
        const i11 = gy1 * gridN + gx1;

        const pR =
          (tileR[i00] * (1 - wx) + tileR[i10] * wx) * (1 - wy) +
          (tileR[i01] * (1 - wx) + tileR[i11] * wx) * wy;
        const pG =
          (tileG[i00] * (1 - wx) + tileG[i10] * wx) * (1 - wy) +
          (tileG[i01] * (1 - wx) + tileG[i11] * wx) * wy;
        const pB =
          (tileB[i00] * (1 - wx) + tileB[i10] * wx) * (1 - wy) +
          (tileB[i01] * (1 - wx) + tileB[i11] * wx) * wy;

        const idx = ro + x * 4;
        const nr = (rgba[idx] / pR) * 200;
        const ng = (rgba[idx + 1] / pG) * 200;
        const nb = (rgba[idx + 2] / pB) * 200;
        const navg = (nr + ng + nb) / 3;

        if (navg > 110) {
          const ch = Math.max(nr, ng, nb) - Math.min(nr, ng, nb);
          bgPixels++;
          sumChroma += ch;
          if (ch >= thresholds.pixelChroma) {
            hlPixels++;
          }
        }
      }
    }

    if (bgPixels < 8) {
      return { meanChroma: 0, coverage: 0 };
    }
    return {
      meanChroma: sumChroma / bgPixels,
      coverage: hlPixels / bgPixels,
    };
  };
}

function scaleRect(rect: Rect, invScale: number): Rect {
  return {
    x0: rect.x0 * invScale,
    y0: rect.y0 * invScale,
    x1: rect.x1 * invScale,
    y1: rect.y1 * invScale,
  };
}

function isInsideAnyRect(bbox: Rect, rects: Rect[]): boolean {
  const cx = (bbox.x0 + bbox.x1) / 2;
  const cy = (bbox.y0 + bbox.y1) / 2;
  return rects.some((r) => cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1);
}

/**
 * Cleans individual OCR tokens, strips isolated cross-script artifacts,
 * and rejoins hyphenated words cleanly across line wraps.
 */
function joinTokensCleanly(tokens: string[]): string {
  const cleanTokens = tokens
    .map((t) => {
      const trimmed = t.trim();
      if (trimmed === "|") return "|";
      return trimmed
        .replace(/^[«»|_~=`^*•]+/, "")
        .replace(/[«»|_~=`^*•]+$/, "");
    })
    .filter((t) => t.length > 0);

  let latinTokens = 0;
  let persianTokens = 0;
  for (const t of cleanTokens) {
    if (/[A-Za-z]{2,}/.test(t)) latinTokens++;
    if (/[\u0600-\u06FF]{2,}/.test(t)) persianTokens++;
  }
  const mostlyEnglish = latinTokens >= 3 && persianTokens <= 1;
  const mostlyPersian = persianTokens >= 3 && latinTokens <= 1;

  let result = "";
  for (let i = 0; i < cleanTokens.length; i++) {
    let token = cleanTokens[i];

    // Drop isolated OCR cross-script hallucinations caused by pen underlines
    if (mostlyEnglish && /^[\u0600-\u06FF\u200C]{1,5}$/.test(token)) continue;
    if (mostlyPersian && /^[A-Za-z]{1,2}$/.test(token)) continue;

    // Fix Roman numeral '|' OCR confusion near Type/Grade/Stage/IV
    if (token === "|" || token === "l") {
      const prev = cleanTokens[i - 1]?.toLowerCase() ?? "";
      const next = cleanTokens[i + 1]?.toLowerCase() ?? "";
      if (
        prev === "type" ||
        prev === "grade" ||
        prev === "stage" ||
        prev === "class" ||
        prev === "graded," ||
        next === "to" ||
        next === "hrs"
      ) {
        token = "I";
      } else if (token === "|") {
        continue;
      }
    }

    // Strip leading stray hyphen or 3+ identical lowercase noise prefixes (e.g. "rrrrHepatorenal")
    token = token.replace(/^([a-z])\1{2,}(?=[A-Z])/, "");
    if (/^-[A-Za-z\u0600-\u06FF]{3,}/.test(token)) {
      token = token.slice(1);
    }

    if (!result) {
      result = token;
    } else if (result.endsWith("-") && !result.endsWith("--") && /^[A-Za-z]/.test(token)) {
      result = result.slice(0, -1) + token;
    } else {
      result += " " + token;
    }
  }
  return result;
}

/**
 * Editorial & structural normalization pass for the final plain-text document:
 * fixes OCR punctuation quirks, hyphenated breaks, unmatched quotes, spacing, and Persian forms.
 */
function polishExtractedPassage(raw: string): string {
  let text = raw
    // Normalize Arabic presentation letters to standard Persian
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ة/g, "ه")
    // Normalize smart quotes and remove stray guillemets/underline artifacts
    .replace(/[«»|_~]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // Remove unmatched leading/trailing/isolated quotes around words
    .replace(/(^|\s)["'](?=\s|$)/g, "$1")
    .replace(/(^|\s)["']+(?=[A-Za-z\u0600-\u06FF])/g, "$1")
    .replace(/([A-Za-z\u0600-\u06FF])["']+(?=[.,;:?!\s]|$)/g, "$1")
    // Replace accidental apostrophe stuck between two full words (e.g. "trap'ammonia")
    .replace(/([A-Za-z]{3,})'([A-Za-z]{3,})/g, (m, a: string, b: string) => {
      if (/^(re|ve|ll|d|m|s|t)$/i.test(b)) return m;
      return `${a} ${b}`;
    })
    // Common medical/scientific & Roman numeral OCR repairs
    .replace(/\bf-lactams\b/gi, "β-lactams")
    .replace(/\b(Type|type|Grade|grade|Stage|stage|Class|class)\s+(?:\||l)\b/g, "$1 I")
    .replace(/\b(Type|type|Grade|grade|Stage|stage|Class|class)\s+11\b/g, "$1 II")
    .replace(/([,\s])(?:\||l)\s+to\s+(II|III|IV|1V)\b/g, "$1I to $2")
    .replace(/\b1V\b/g, "IV")
    // Strip leading repeated-letter margin noise (e.g. "rrrrHepatorenal")
    .replace(/\b([a-z])\1{2,}([A-Z][a-z]+)/g, "$2")
    // Rejoin any remaining broken English word hyphenations and dropped-hyphen suffixes
    .replace(/([A-Za-z]{3,})\s*-\s+([a-z]{2,})/g, "$1$2")
    .replace(
      /\b([A-Za-z]{4,})\s+(tion|tions|sion|sions|ments?|ness|able|ible|ology|graphy|pathy|itis|emia|osis|scopy|ectomy)\b/g,
      "$1$2"
    )
    // Fix OCR comma misread before capitalized new-sentence starters
    .replace(/,\s+(The|This|These|There|However|Finally|Moreover|Additionally)\b/g, ". $1")
    // Normalize spacing around punctuation
    .replace(/\s+([.,;:?!،؛؟])/g, "$1")
    .replace(/([.,;:?!،؛؟])([A-Za-z\u0600-\u06FF])/g, "$1 $2")
    // Keep standard Latin abbreviations like e.g., i.e., U.S. together
    .replace(/\b([ei])\.\s+([ge])\./gi, "$1.$2.")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Remove orphaned leading/trailing punctuation fragments
  text = text.replace(/^[,;:.\-–—]+\s*/, "").replace(/\s*[:;=\-–—]+$/, "").trim();

  return text;
}

/**
 * Stitches consecutive passage candidates if the first ended mid-sentence (no terminal
 * punctuation) and the second continues seamlessly on the next line of the same column.
 */
function stitchPassages(candidates: PassageCandidate[], pageWidth: number): string[] {
  const merged: PassageCandidate[] = [];

  for (const cand of candidates) {
    if (cand.tokens.length === 0) continue;
    const prev = merged[merged.length - 1];

    if (prev) {
      const prevJoined = joinTokensCleanly(prev.tokens);
      const currJoined = joinTokensCleanly(cand.tokens);
      const lineH = Math.max(10, prev.lastBox.y1 - prev.lastBox.y0);
      const verticalGap = cand.firstBox.y0 - prev.lastBox.y1;
      const sameColumn = Math.abs(cand.firstBox.x0 - prev.lastBox.x0) < pageWidth * 0.25;
      const endsWithHyphen = /-$/.test(prevJoined);
      const endsSentence = /[.!?؟:؛]$/.test(prevJoined);
      const endsWithPause = /[,;]$/.test(prevJoined);
      const startsLowerOrCont = /^[a-z,;.)\]]/.test(currJoined);
      const flushNextLineCont =
        !endsWithPause &&
        Math.abs(cand.firstBox.x0 - prev.lastBox.x0) < lineH * 2.6 &&
        verticalGap <= lineH * 1.15;

      if (
        sameColumn &&
        verticalGap >= -lineH * 0.5 &&
        verticalGap <= lineH * 1.8 &&
        !endsSentence &&
        (endsWithHyphen || startsLowerOrCont || flushNextLineCont)
      ) {
        prev.tokens.push(...cand.tokens);
        prev.confSum += cand.confSum;
        prev.confCount += cand.confCount;
        prev.lastBox = cand.lastBox;
        continue;
      }
    }

    merged.push({
      tokens: [...cand.tokens],
      confSum: cand.confSum,
      confCount: cand.confCount,
      firstBox: cand.firstBox,
      lastBox: cand.lastBox,
    });
  }

  return merged
    .map((m) => ({
      text: polishExtractedPassage(joinTokensCleanly(m.tokens)),
      avgConf: m.confCount > 0 ? m.confSum / m.confCount : 0,
    }))
    .filter(({ text, avgConf }) => {
      const alphaCount = (text.match(/[A-Za-z0-9\u0600-\u06FF]/g) ?? []).length;
      if (alphaCount < 4) return false;
      // Reject very short (< 10 chars) low-confidence edge/smudge fragments
      if (alphaCount < 10 && avgConf < 65) return false;
      return true;
    })
    .map(({ text }) => text);
}

function detectDominantScript(blocks: any[]): OcrLanguage | null {
  let latinWords = 0;
  let persianWords = 0;

  for (const block of blocks) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const w of line.words ?? []) {
          if ((w.confidence ?? 0) < 55) continue;
          const txt = (w.text ?? "").trim();
          if (/^[A-Za-z]{3,}$/.test(txt)) latinWords++;
          else if (/^[\u0600-\u06FF]{3,}$/.test(txt)) persianWords++;
        }
      }
    }
  }

  if (latinWords >= 10 && persianWords <= 2) return "eng";
  if (persianWords >= 10 && latinWords <= 2) return "fas";
  return null;
}

export async function extractHighlightsOffline(
  pages: CapturedPage[],
  options: {
    language: OcrLanguage;
    sensitivity: HighlightSensitivity;
  },
  onProgress?: (percent: number, status: string) => void
): Promise<string[]> {
  const thresholds = SENSITIVITY_MAP[options.sensitivity];
  const worker = await getOfflineWorker(options.language, (pct, msg) => {
    onProgress?.(pct, msg);
  });

  const allExtractedPassages: string[] = [];

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    onProgress?.(
      Math.round(((pageIdx + 0.1) / pages.length) * 100),
      pages.length > 1
        ? `در حال بهبود نور و تحلیل آفلاین صفحه ${pageIdx + 1} از ${pages.length}...`
        : "در حال تنظیم نور، کنتراست و تشخیص آفلاین متن..."
    );

    const img = await loadImageElement(page.dataUrl);
    const maxDim = 2200;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = width;
    colorCanvas.height = height;
    const colorCtx = colorCanvas.getContext("2d", { willReadFrequently: true });
    if (!colorCtx) continue;

    colorCtx.drawImage(img, 0, 0, width, height);
    const rgba = colorCtx.getImageData(0, 0, width, height).data;

    const { ocrCanvas, ocrScale, gray } = buildEnhancedOcrCanvas(colorCanvas, rgba, width, height);
    const invScale = 1 / ocrScale;
    const excludedRects = detectExcludedRects(gray, width, height);
    const scoreWord = createWordHighlightScorer(rgba, width, height, thresholds);

    let result = await worker.recognize(ocrCanvas, {}, { blocks: true });
    let blocks = result.data.blocks ?? [];

    // If bilingual mode is active on a single-script page, refine with dedicated model to avoid cross-script noise
    if (options.language === "eng+fas") {
      const dominant = detectDominantScript(blocks);
      if (dominant) {
        onProgress?.(
          Math.round(((pageIdx + 0.65) / pages.length) * 100),
          dominant === "eng"
            ? "تشخیص صفحه انگلیسی — در حال خوانش دقیق متن..."
            : "تشخیص صفحه فارسی — در حال خوانش دقیق متن..."
        );
        const dedicatedWorker = await getOfflineWorker(dominant);
        result = await dedicatedWorker.recognize(ocrCanvas, {}, { blocks: true });
        blocks = result.data.blocks ?? [];
      }
    }

    const findCalloutBoxBottom = (bx0: number, bx1: number, startY: number): number => {
      const xLeft = Math.max(0, Math.round(bx0));
      const xRight = Math.min(width - 1, Math.max(xLeft + 20, Math.round(bx1)));
      const scanEnd = Math.min(height - 10, Math.round(startY + height * 0.45));
      let blankRun = 0;

      for (let y = Math.max(0, Math.round(startY) + 12); y < scanEnd; y++) {
        const ro = y * width;
        let darkRulePx = 0;
        let inkPx = 0;
        const span = xRight - xLeft;
        for (let x = xLeft; x < xRight; x += 2) {
          const g = gray[ro + x];
          if (g < 170) darkRulePx++;
          if (g < 155) inkPx++;
        }
        const sampleCount = Math.max(1, Math.ceil(span / 2));
        if (darkRulePx / sampleCount > 0.65 && y > startY + 40) {
          return y + 12;
        }
        if (inkPx / sampleCount < 0.015) {
          blankRun++;
          if (blankRun >= 36 && y > startY + 60) {
            return y - 4;
          }
        } else {
          blankRun = 0;
        }
      }
      return Math.min(height, Math.round(startY + height * 0.25));
    };

    interface NormalizedLine {
      text: string;
      confidence: number;
      bbox: Rect;
      words: Array<{ text: string; confidence: number; bbox: Rect }>;
    }

    interface ColumnGroup {
      x0: number;
      x1: number;
      lines: NormalizedLine[];
    }

    const validBlocks: Array<{ box: Rect; lines: NormalizedLine[] }> = [];

    for (const block of blocks) {
      const blockBox = scaleRect(block.bbox, invScale);
      const blockFirstLine = block.paragraphs?.[0]?.lines?.[0]?.text?.trim() ?? "";

      if (/^(BOX|TABLE|FIG\.?|FIGURE|ALGORITHM)\s*\d+/i.test(blockFirstLine)) {
        const boxRight = Math.max(blockBox.x1 + 80, blockBox.x0 + Math.round(width * 0.36));
        const boxBottom = findCalloutBoxBottom(blockBox.x0, boxRight, blockBox.y1);
        excludedRects.push({
          x0: Math.max(0, blockBox.x0 - 36),
          y0: Math.max(0, blockBox.y0 - 20),
          x1: Math.min(width, boxRight),
          y1: boxBottom,
        });
        continue;
      }

      if (isInsideAnyRect(blockBox, excludedRects)) {
        continue;
      }

      const blockLines: NormalizedLine[] = [];
      for (const paragraph of block.paragraphs ?? []) {
        for (const l of paragraph.lines ?? []) {
          if ((l.words?.length ?? 0) === 0 || !l.text.trim()) continue;
          blockLines.push({
            text: l.text.trim(),
            confidence: l.confidence,
            bbox: scaleRect(l.bbox, invScale),
            words: (l.words ?? []).map((w) => ({
              text: w.text,
              confidence: w.confidence ?? 100,
              bbox: scaleRect(w.bbox, invScale),
            })),
          });
        }
      }

      if (blockLines.length > 0) {
        validBlocks.push({ box: blockBox, lines: blockLines });
      }
    }

    // Group horizontally overlapping blocks into page columns (wide-first so narrow split fragments join their column)
    validBlocks.sort((a, b) => (b.box.x1 - b.box.x0) - (a.box.x1 - a.box.x0));
    const columns: ColumnGroup[] = [];
    for (const vb of validBlocks) {
      let targetCol: ColumnGroup | undefined;
      let bestOverlap = 0;
      for (const col of columns) {
        const overlap = Math.min(col.x1, vb.box.x1) - Math.max(col.x0, vb.box.x0);
        if (overlap > 10 && overlap > bestOverlap) {
          bestOverlap = overlap;
          targetCol = col;
        }
      }
      if (targetCol) {
        targetCol.x0 = Math.min(targetCol.x0, vb.box.x0);
        targetCol.x1 = Math.max(targetCol.x1, vb.box.x1);
        targetCol.lines.push(...vb.lines);
      } else {
        columns.push({ x0: vb.box.x0, x1: vb.box.x1, lines: [...vb.lines] });
      }
    }
    columns.sort((a, b) => a.x0 - b.x0);

    const pageCandidates: PassageCandidate[] = [];
    const lineQuality = (l: NormalizedLine) => {
      const alnum = (l.text.match(/[A-Za-z0-9\u0600-\u06FF]/g) ?? []).length;
      return l.confidence * Math.max(1, alnum);
    };

    for (const col of columns) {
      col.lines.sort((a, b) => {
        const cyA = (a.bbox.y0 + a.bbox.y1) / 2;
        const cyB = (b.bbox.y0 + b.bbox.y1) / 2;
        return cyA - cyB;
      });

      const mergedLines: NormalizedLine[] = [];
      for (const nl of col.lines) {
        const prev = mergedLines[mergedLines.length - 1];
        if (prev) {
          const cyPrev = (prev.bbox.y0 + prev.bbox.y1) / 2;
          const cyCurr = (nl.bbox.y0 + nl.bbox.y1) / 2;
          const minH = Math.max(8, Math.min(prev.bbox.y1 - prev.bbox.y0, nl.bbox.y1 - nl.bbox.y0));

          if (Math.abs(cyCurr - cyPrev) <= minH * 0.45) {
            const xOverlap = Math.max(
              0,
              Math.min(prev.bbox.x1, nl.bbox.x1) - Math.max(prev.bbox.x0, nl.bbox.x0)
            );
            const minW = Math.max(1, Math.min(prev.bbox.x1 - prev.bbox.x0, nl.bbox.x1 - nl.bbox.x0));

            if (xOverlap > minW * 0.35) {
              if (lineQuality(nl) > lineQuality(prev)) {
                mergedLines[mergedLines.length - 1] = nl;
              }
              continue;
            }

            const maxXGap = Math.max(
              prev.bbox.x0 - nl.bbox.x1,
              nl.bbox.x0 - prev.bbox.x1,
              0
            );

            if (maxXGap <= minH * 5) {
              const combinedText = `${prev.text} ${nl.text}`;
              const persianChars = (combinedText.match(/[\u0600-\u06FF]/g) ?? []).length;
              const latinChars = (combinedText.match(/[A-Za-z]/g) ?? []).length;
              const isRtlRow = persianChars > latinChars;

              const mergedWords = [...prev.words, ...nl.words].sort((wa, wb) =>
                isRtlRow ? wb.bbox.x0 - wa.bbox.x0 : wa.bbox.x0 - wb.bbox.x0
              );

              prev.words = mergedWords;
              prev.text = mergedWords.map((w) => w.text).join(" ");
              prev.confidence = Math.max(prev.confidence, nl.confidence);
              prev.bbox = {
                x0: Math.min(prev.bbox.x0, nl.bbox.x0),
                y0: Math.min(prev.bbox.y0, nl.bbox.y0),
                x1: Math.max(prev.bbox.x1, nl.bbox.x1),
                y1: Math.max(prev.bbox.y1, nl.bbox.y1),
              };
              continue;
            }
          }
        }
        mergedLines.push(nl);
      }

      let currentPassageTokens: string[] = [];
      let currentConfSum = 0;
      let currentConfCount = 0;
      let firstLineBox: Rect | null = null;
      let lastLineBox: Rect | null = null;

      const flushPassage = () => {
        if (currentPassageTokens.length > 0 && firstLineBox && lastLineBox) {
          pageCandidates.push({
            tokens: currentPassageTokens,
            confSum: currentConfSum,
            confCount: currentConfCount,
            firstBox: firstLineBox,
            lastBox: lastLineBox,
          });
        }
        currentPassageTokens = [];
        currentConfSum = 0;
        currentConfCount = 0;
        firstLineBox = null;
        lastLineBox = null;
      };

      for (const line of mergedLines) {
        const lineText = line.text;
        const lineBox = line.bbox;

        if (!lineText || line.confidence < 28) {
          flushPassage();
          continue;
        }

        if (isInsideAnyRect(lineBox, excludedRects)) {
          flushPassage();
          continue;
        }

        const words = line.words;
        if (words.length === 0) {
          flushPassage();
          continue;
        }

        // Skip running page headers/numbers & mobile UI chrome lines
        const isTopMargin = lineBox.y0 < height * 0.065;
        const isBottomMargin = lineBox.y1 > height * 0.95;
        if (
          (isTopMargin && (/^(PART|CHAPTER|SECTION|\d{1,4}\b)/i.test(lineText) || words.length <= 5)) ||
          (isBottomMargin && /^\d{1,4}$/.test(lineText)) ||
          /^\d{1,2}:\d{2}\b/.test(lineText)
        ) {
          flushPassage();
          continue;
        }

        // Median word vertical bounds prevent stray ink smudges from shifting the highlight scoring window
        const sortedY0 = words.map((w) => w.bbox.y0).sort((a, b) => a - b);
        const sortedY1 = words.map((w) => w.bbox.y1).sort((a, b) => a - b);
        const midIdx = Math.floor(words.length / 2);
        const medY0 = sortedY0[midIdx];
        const medY1 = Math.max(medY0 + 6, sortedY1[midIdx]);
        const medH = medY1 - medY0;

        const scored = words.map((w) => {
          const wH = w.bbox.y1 - w.bbox.y0;
          const useWordY = wH >= medH * 0.55 && Math.abs(w.bbox.y0 - medY0) < medH * 0.8;
          const wordBox: Rect = {
            x0: w.bbox.x0,
            y0: useWordY ? Math.min(w.bbox.y0, medY0) : medY0,
            x1: w.bbox.x1,
            y1: useWordY ? Math.max(w.bbox.y1, medY1) : medY1,
          };
          const { meanChroma, coverage } = scoreWord(wordBox);
          const strong = meanChroma >= thresholds.wordMeanChroma && coverage >= thresholds.wordCoverage;
          const soft = meanChroma >= thresholds.wordMeanChroma * 0.84 && coverage >= thresholds.wordCoverage * 0.76;
          return { word: w, meanChroma, coverage, strong, soft, keep: strong };
        });

        // Suppress isolated 1-2 char JPEG-ringing false positives when neighbors aren't highlighted
        for (let i = 0; i < scored.length; i++) {
          const cleanTxt = scored[i].word.text.replace(/[^A-Za-z0-9\u0600-\u06FF]/g, "");
          if (scored[i].keep && cleanTxt.length <= 2) {
            const prevStrongOrSoft = i > 0 && (scored[i - 1].strong || scored[i - 1].soft);
            const nextStrongOrSoft = i < scored.length - 1 && (scored[i + 1].strong || scored[i + 1].soft);
            if (!prevStrongOrSoft && !nextStrongOrSoft && scored[i].meanChroma < thresholds.wordMeanChroma + 5) {
              scored[i].keep = false;
            }
          }
        }

        // Iterative neighbor bridging (forward + backward) so consecutive soft words adjacent to highlights connect cleanly
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 0; i < scored.length; i++) {
            if (scored[i].keep) continue;
            const prevKeep = i > 0 && scored[i - 1].keep;
            const nextKeep = i < scored.length - 1 && scored[i + 1].keep;
            if ((prevKeep && nextKeep) || ((prevKeep || nextKeep) && scored[i].soft)) {
              scored[i].keep = true;
            }
          }
          for (let i = scored.length - 1; i >= 0; i--) {
            if (scored[i].keep) continue;
            const prevKeep = i > 0 && scored[i - 1].keep;
            const nextKeep = i < scored.length - 1 && scored[i + 1].keep;
            if ((prevKeep && nextKeep) || ((prevKeep || nextKeep) && scored[i].soft)) {
              scored[i].keep = true;
            }
          }
        }

        // Find meaningful last real word index (ignoring trailing punctuation/noise smudges)
        let effectiveLastIdx = scored.length - 1;
        while (
          effectiveLastIdx > 0 &&
          !/[A-Za-z0-9\u0600-\u06FF]/.test(scored[effectiveLastIdx].word.text)
        ) {
          effectiveLastIdx--;
        }

        const keptIndices: number[] = [];
        for (let i = 0; i < scored.length; i++) {
          if (scored[i].keep) keptIndices.push(i);
        }

        if (keptIndices.length === 0) {
          flushPassage();
          continue;
        }

        const firstKeptIdx = keptIndices[0];
        const startsAtLineStart = firstKeptIdx === 0;

        let runStart = keptIndices[0];
        for (let k = 0; k < keptIndices.length; k++) {
          const curr = keptIndices[k];
          const next = keptIndices[k + 1];
          const isEndOfRun = next === undefined || next - curr > 1;

          if (isEndOfRun) {
            const keptSlice = scored.slice(runStart, curr + 1).filter((s) => {
              const t = s.word.text.trim();
              if (!t || (/^[|_~]+$/.test(t) && t !== "|")) return false;
              const conf = s.word.confidence ?? 100;
              if (
                conf < 42 &&
                (/([a-z][A-Z]|[A-Z]{3,}[a-z])/.test(t) ||
                  /([a-zA-Z])\1{3,}/.test(t) ||
                  /^[A-Z]{4,}$/.test(t))
              ) {
                return false;
              }
              if (
                conf < 30 &&
                /^[A-Za-z]{1,2}$/.test(t) &&
                !/^(a|I|in|on|at|to|of|or|as|by|is|be|we|he|it|if|no|so|do|go|up|an|am|g|L|mg|dL|pH|GI|PT|IV|II)$/i.test(t)
              ) {
                return false;
              }
              return true;
            });

            const runTokens = keptSlice.map((s) => s.word.text);
            const runConfSum = keptSlice.reduce((acc, s) => acc + (s.word.confidence ?? 100), 0);
            const runConfCount = keptSlice.length;
            const runAlpha = (runTokens.join("").match(/[A-Za-z0-9\u0600-\u06FF]/g) ?? []).length;

            if (runTokens.length >= 2 || runAlpha >= 4) {
              const isFirstRunOnLine = runStart === firstKeptIdx;
              const normalizedLineBox: Rect = {
                x0: keptSlice[0].word.bbox.x0,
                y0: medY0,
                x1: keptSlice[keptSlice.length - 1].word.bbox.x1,
                y1: medY1,
              };
              const lineGapOk =
                lastLineBox !== null &&
                normalizedLineBox.y0 - lastLineBox.y1 <= (lastLineBox.y1 - lastLineBox.y0) * 1.5;

              if (isFirstRunOnLine && startsAtLineStart && lineGapOk && currentPassageTokens.length > 0) {
                currentPassageTokens.push(...runTokens);
                currentConfSum += runConfSum;
                currentConfCount += runConfCount;
                lastLineBox = normalizedLineBox;
              } else {
                flushPassage();
                currentPassageTokens.push(...runTokens);
                currentConfSum = runConfSum;
                currentConfCount = runConfCount;
                firstLineBox = normalizedLineBox;
                lastLineBox = normalizedLineBox;
              }

              // Flush immediately only if a real unhighlighted tail remains on this line
              if (curr < effectiveLastIdx) {
                flushPassage();
              }
            } else {
              flushPassage();
            }

            if (next !== undefined) {
              runStart = next;
            }
          }
        }
      }

      flushPassage();
    }

    allExtractedPassages.push(...stitchPassages(pageCandidates, width));
  }

  onProgress?.(100, "تکمیل شد");
  return allExtractedPassages;
}
