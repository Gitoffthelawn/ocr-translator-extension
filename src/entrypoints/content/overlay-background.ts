// Estimates background colors inside horizontal OCR boxes using morphology.
// Returns masks and text colors only when all lines have a consistent, uniform
// background. Uncertain regions keep the default translation panels.

import type { Rect } from "@/shared/types";
import type { OverlayLine } from "./overlay-layout";

type Rgb = [number, number, number];

export interface OverlayBackground {
  masks: Rect[];
  background: string;
  foreground: string;
}

// JPEG color fringes can vary more than brightness on an otherwise flat background.
const COLOR_TOLERANCE = 20;
const BRIGHTNESS_TOLERANCE = 10;

export function detectOverlayBackground(
  image: Pick<ImageData, "width" | "height" | "data">,
  capture: Rect,
  lines: OverlayLine[],
): OverlayBackground | undefined {
  if (!lines.length || capture.width <= 0 || capture.height <= 0) {
    return undefined;
  }
  const sx = image.width / capture.width;
  const sy = image.height / capture.height;
  const masks: Rect[] = [];
  const colors: Rgb[] = [];
  for (const line of lines) {
    if (line.vertical || Math.abs(line.oriented?.angle ?? 0) > Math.PI / 60) {
      return undefined;
    }
    const left = Math.max(
      0, Math.floor((line.rect.x - capture.x) * sx),
    );
    const top = Math.max(
      0, Math.floor((line.rect.y - capture.y) * sy),
    );
    const right = Math.min(
      image.width,
      Math.ceil((line.rect.x + line.rect.width - capture.x) * sx),
    );
    const bottom = Math.min(
      image.height,
      Math.ceil((line.rect.y + line.rect.height - capture.y) * sy),
    );
    if (right <= left || bottom <= top) {
      return undefined;
    }
    const rect = { x: left, y: top, width: right - left, height: bottom - top };
    const color = sampleBackground(image, rect);
    if (!color || (colors[0] && !similar(color, colors[0]))) {
      return undefined;
    }
    colors.push(color);
    masks.push({
      x: capture.x + left / sx,
      y: capture.y + top / sy,
      width: rect.width / sx,
      height: rect.height / sy,
    });
  }
  const color = medianColor(colors);
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  return {
    masks,
    background: `rgb(${color.join(", ")})`,
    foreground: luminance > 0.22 ? "#152034" : "#ffffff",
  };
}

function sampleBackground(
  image: Pick<ImageData, "width" | "height" | "data">,
  rect: Rect,
): Rgb | undefined {
  // Bound the work even for large captures.
  const width = Math.min(160, rect.width);
  const height = Math.min(48, rect.height);
  if (width < 3 || height < 3) {
    return undefined;
  }
  const pixels: Rgb[] = [];
  const edges: Rgb[][] = [[], [], [], []];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceX = rect.x + Math.round(x * (rect.width - 1) / (width - 1));
      const sourceY = rect.y + Math.round(y * (rect.height - 1) / (height - 1));
      const index = (sourceY * image.width + sourceX) * 4;
      if (image.data[index + 3] !== 255) {
        return undefined;
      }
      const color: Rgb = [image.data[index], image.data[index + 1], image.data[index + 2]];
      pixels.push(color);
      if (y === 0) edges[0].push(color);
      if (y === height - 1) edges[1].push(color);
      if (x === 0) edges[2].push(color);
      if (x === width - 1) edges[3].push(color);
    }
  }
  const radiusX = Math.max(1, Math.ceil(rect.height * width / rect.width / 2));
  const radiusY = Math.ceil(height / 2);
  const levels = pixels.map(brightness);
  // Extrema filters spread isolated JPEG artifacts across otherwise flat areas.
  const denoised = medianFilter(levels, width, height);
  const candidates: Rgb[] = [];
  // Closing removes dark strokes; opening removes light strokes.
  for (const maximum of [true, false]) {
    const firstPass = morph(denoised, width, height, radiusX, radiusY, maximum);
    const background = morph(firstPass, width, height, radiusX, radiusY, !maximum);
    const unchangedMask = levels.map((level, index) =>
      Number(Math.abs(level - background[index]) <= BRIGHTNESS_TOLERANCE));
    const interior = morph(unchangedMask, width, height, 1, 1, false);
    const unchanged = pixels.filter((_, index) => interior[index]);
    if (!unchanged.length) {
      continue;
    }
    // Read RGB from original pixels, excluding glyphs and their antialiased edges.
    const color = medianColor(unchanged);
    const uniform = background.filter((level) =>
      Math.abs(level - brightness(color)) <= BRIGHTNESS_TOLERANCE).length / background.length;
    const fraction = (samples: Rgb[]): number =>
      samples.filter((pixel) => similar(pixel, color)).length / samples.length;
    // Morphology can flatten textures too. Require support along the original
    // inner perimeter, including every side, before painting the whole rectangle.
    if (
      uniform >= 0.9 && fraction(unchanged) >= 0.9 &&
      fraction(edges.flat()) >= 0.8 && edges.every((edge) => fraction(edge) >= 0.5) &&
      hasInteriorBackground(pixels, width, height, color)
    ) {
      candidates.push(color);
    }
  }
  return candidates.length && candidates.every((color) => similar(color, candidates[0]))
    ? candidates[0]
    : undefined;
}

function hasInteriorBackground(pixels: Rgb[], width: number, height: number, color: Rgb): boolean {
  const insetX = Math.max(1, Math.floor(width * 0.15));
  const insetY = Math.max(1, Math.floor(height * 0.15));
  const innerWidth = width - 2 * insetX;
  const innerHeight = height - 2 * insetY;
  if (innerWidth < 3 || innerHeight < 3) {
    return false;
  }
  const totals = new Array<number>(9).fill(0);
  const matches = new Array<number>(9).fill(0);
  for (let y = 0; y < innerHeight; y++) {
    for (let x = 0; x < innerWidth; x++) {
      const cell = Math.floor(y * 3 / innerHeight) * 3 + Math.floor(x * 3 / innerWidth);
      totals[cell]++;
      if (similar(pixels[(y + insetY) * width + x + insetX], color)) matches[cell]++;
    }
  }
  // A flat border alone cannot justify erasing the interior. Allow sparse
  // background between bold strokes, but require it across the interior.
  const supported = matches.map((count, cell) => count / totals[cell] >= 0.1);
  return supported[4] && supported.filter(Boolean).length >= 5;
}

function medianFilter(pixels: number[], width: number, height: number): number[] {
  return pixels.map((_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors: number[] = [];
    for (let row = Math.max(0, y - 1); row <= Math.min(height - 1, y + 1); row++) {
      for (let col = Math.max(0, x - 1); col <= Math.min(width - 1, x + 1); col++) {
        neighbors.push(pixels[row * width + col]);
      }
    }
    neighbors.sort((a, b) => a - b);
    return neighbors[Math.floor(neighbors.length / 2)];
  });
}

export function morph(
  pixels: number[],
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
  maximum: boolean,
): number[] {
  let result = pixels;
  const queue = new Int32Array(Math.max(width, height));
  for (const horizontal of [true, false]) {
    const source = result;
    const radius = horizontal ? radiusX : radiusY;
    const length = horizontal ? width : height;
    const count = horizontal ? height : width;
    const stride = horizontal ? 1 : width;
    result = new Array(source.length);
    for (let line = 0; line < count; line++) {
      const start = horizontal ? line * width : line;
      let head = 0;
      let tail = 0;
      let next = 0;
      for (let position = 0; position < length; position++) {
        const left = Math.max(0, position - radius);
        const right = Math.min(length - 1, position + radius);
        while (head < tail && queue[head] < left) head++;
        // Each position enters and leaves the monotonic queue at most once.
        for (; next <= right; next++) {
          const value = source[start + next * stride];
          while (head < tail) {
            const last = source[start + queue[tail - 1] * stride];
            if (maximum ? last > value : last < value) break;
            tail--;
          }
          queue[tail++] = next;
        }
        result[start + position * stride] = source[start + queue[head] * stride];
      }
    }
  }
  return result;
}

function similar(a: Rgb, b: Rgb): boolean {
  return Math.abs(brightness(a) - brightness(b)) <= BRIGHTNESS_TOLERANCE &&
    a.every((channel, index) => Math.abs(channel - b[index]) <= COLOR_TOLERANCE);
}

function brightness([r, g, b]: Rgb): number {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function medianColor(colors: Rgb[]): Rgb {
  return [0, 1, 2].map((channel) => {
    const values = colors.map((color) => color[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  }) as Rgb;
}
