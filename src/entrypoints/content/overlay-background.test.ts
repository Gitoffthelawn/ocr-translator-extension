import { describe, expect, it } from "vitest";
import { detectOverlayBackground, morph } from "./overlay-background";
import type { OverlayLine } from "./overlay-layout";

function image(
  pixel: (x: number, y: number) => number[] = () => [248, 246, 240, 255],
) {
  const width = 240;
  const height = 120;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const capture = { x: 100, y: 200, width: 240, height: 120 };
const line: OverlayLine = {
  rect: { x: 120, y: 220, width: 160, height: 20 },
  text: "Sample text",
  vertical: false,
};

describe("detectOverlayBackground", () => {
  it("estimates the background behind dark glyphs and masks each line separately", () => {
    const pixels = image((x, y) => x > 25 && x < 175 && y > 22 && y < 38 && x % 12 < 8
      ? [20, 20, 20, 255]
      : [248, 246, 240, 255]);
    const second = { ...line, rect: { ...line.rect, y: 260, width: 80 } };
    const result = detectOverlayBackground(pixels, capture, [line, second]);
    expect(result?.background).toBe("rgb(248, 246, 240)");
    expect(result?.foreground).toBe("#152034");
    expect(result?.masks).toEqual([
      { x: 120, y: 220, width: 160, height: 20 },
      { x: 120, y: 260, width: 80, height: 20 },
    ]);
  });

  it("uses light translation text on a dark background", () => {
    const result = detectOverlayBackground(image(() => [24, 32, 40, 255]), capture, [line]);
    expect(result?.background).toBe("rgb(24, 32, 40)");
    expect(result?.foreground).toBe("#ffffff");
  });

  it("maps high-resolution captures back to page coordinates", () => {
    const scaled = { ...capture, width: 120, height: 60 };
    const result = detectOverlayBackground(image(), scaled, [{
      ...line,
      rect: { x: 110, y: 210, width: 80, height: 10 },
    }]);
    expect(result?.masks).toEqual([{ x: 110, y: 210, width: 80, height: 10 }]);
  });

  it("clips masks at the capture edge", () => {
    const result = detectOverlayBackground(image(), capture, [{
      ...line, rect: { ...line.rect, x: capture.x - 5 },
    }]);
    expect(result?.masks[0].x).toBe(capture.x);
  });

  it("rejects textures and gradients", () => {
    for (const pixels of [
      image((x, y) => (x + y) % 3 === 0 ? [80, 100, 120, 255] : [240, 240, 240, 255]),
      image((x) => x % 8 < 4 ? [200, 80, 80, 255] : [10, 136, 80, 255]),
      image((x) => [x, x, x, 255]),
    ]) {
      expect(detectOverlayBackground(pixels, capture, [line])).toBeUndefined();
    }
  });

  it.each(["panel", "texture", "light panel", "central inset"])(
    "rejects a flat border surrounding a %s", (kind) => {
      const pixels = image((x, y) => {
        const inset = kind === "central inset"
          ? x >= 75 && x < 125 && y >= 27 && y < 34
          : x >= 24 && x < 176 && y >= 22 && y < 38;
        if (!inset) return kind === "light panel" ? [24, 32, 40, 255] : [240, 240, 240, 255];
        if (kind === "light panel") return [240, 240, 240, 255];
        if (kind === "texture" && (Math.floor(x / 4) + Math.floor(y / 4)) % 2) {
          return [100, 40, 80, 255];
        }
        return [30, 70, 110, 255];
      });
      expect(detectOverlayBackground(pixels, capture, [line])).toBeUndefined();
    },
  );

  it("ignores a neighboring panel outside the OCR rectangle", () => {
    const pixels = image((x) => x >= 181 ? [40, 60, 80, 255] : [248, 246, 240, 255]);
    const result = detectOverlayBackground(pixels, capture, [line]);
    expect(result?.background).toBe("rgb(248, 246, 240)");
    expect(result?.masks).toEqual([line.rect]);
  });

  it("rejects a panel boundary inside the OCR rectangle", () => {
    const pixels = image((x) => x >= 170 ? [40, 60, 80, 255] : [248, 246, 240, 255]);
    expect(detectOverlayBackground(pixels, capture, [line])).toBeUndefined();
  });

  it("still rejects a small brightness change at a panel boundary", () => {
    const pixels = image((x) => x >= 170 ? [233, 231, 225, 255] : [248, 246, 240, 255]);
    expect(detectOverlayBackground(pixels, capture, [line])).toBeUndefined();
  });

  it("accepts mild color noise without brightness variation around colored strokes", () => {
    const pixels = image((x, y) => {
      if (x > 25 && x < 175 && y > 22 && y < 38 && x % 12 < 5) {
        return [200, 90, 30, 255];
      }
      return y % 5 < 2 ? [176, 177, 184, 255] : [160, 180, 200, 255];
    });
    expect(detectOverlayBackground(pixels, capture, [line])?.background)
      .toBe("rgb(160, 180, 200)");
  });

  it.each([
    { background: [20, 220, 220], ink: [10, 10, 10], foreground: "#152034" },
    { background: [24, 32, 40], ink: [245, 245, 245], foreground: "#ffffff" },
  ])("finds $background behind bold text occupying most of the rectangle", ({ background, ink, foreground }) => {
    const pixels = image((x, y) => {
      if (x < 20 || x >= 180 || y < 20 || y >= 40) return [180, 100, 140, 255];
      const stroke = x > 21 && x < 178 && y > 20 && y < 39 && x % 12 < 10;
      return [...(stroke ? ink : background), 255];
    });
    const result = detectOverlayBackground(pixels, capture, [line]);
    expect(result?.background).toBe(`rgb(${background.join(", ")})`);
    expect(result?.foreground).toBe(foreground);
    expect(result?.masks).toEqual([line.rect]);
  });

  it("excludes colored fringes beside dark strokes from the background estimate", () => {
    const pixels = image((x, y) => {
      if (x > 21 && x < 178 && y > 21 && y < 38) {
        if (x % 12 < 7) return [20, 20, 20, 255];
        if (x % 12 === 7) return [60, 240, 240, 255];
      }
      return [0, 255, 255, 255];
    });
    expect(detectOverlayBackground(pixels, capture, [line])?.background)
      .toBe("rgb(0, 255, 255)");
  });

  it.each([
    { background: [230, 100, 150], ink: [20, 20, 20], noise: [255, 150, 190] },
    { background: [24, 32, 40], ink: [245, 245, 245], noise: [0, 0, 0] },
  ])("ignores isolated compression noise on $background", ({ background, ink, noise }) => {
    const pixels = image((x, y) => {
      const stroke = x > 25 && x < 175 && y > 22 && y < 38 && x % 12 < 8;
      const color = stroke ? ink : x % 17 === 0 && y % 7 === 0 ? noise : background;
      return [...color, 255];
    });
    expect(detectOverlayBackground(pixels, capture, [line])?.background)
      .toBe(`rgb(${background.join(", ")})`);
  });

  it("rejects paragraphs whose lines have different backgrounds", () => {
    const pixels = image((_x, y) => y > 50 ? [24, 32, 40, 255] : [248, 246, 240, 255]);
    const second = { ...line, rect: { ...line.rect, y: 270 } };
    expect(detectOverlayBackground(pixels, capture, [line, second])).toBeUndefined();
  });

  it("can sample a rectangle filling the capture", () => {
    expect(detectOverlayBackground(image(), capture, [{ ...line, rect: capture }])?.background)
      .toBe("rgb(248, 246, 240)");
  });

  it("leaves vertical, tilted, transparent, and unsampleable regions alone", () => {
    expect(detectOverlayBackground(image(), capture, [{ ...line, vertical: true }])).toBeUndefined();
    expect(detectOverlayBackground(image(), capture, [{
      ...line, oriented: { rect: line.rect, angle: 0.2 },
    }])).toBeUndefined();
    expect(detectOverlayBackground(image(() => [0, 0, 0, 0]), capture, [line])).toBeUndefined();
    expect(detectOverlayBackground(image(), capture, [{
      ...line, rect: { ...line.rect, width: 1 },
    }])).toBeUndefined();
    expect(detectOverlayBackground(image(), capture, [])).toBeUndefined();
  });
});

function reference(
  pixels: number[], width: number, height: number,
  radiusX: number, radiusY: number, maximum: boolean,
): number[] {
  return pixels.map((pixel, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    for (let row = Math.max(0, y - radiusY); row <= Math.min(height - 1, y + radiusY); row++) {
      for (let col = Math.max(0, x - radiusX); col <= Math.min(width - 1, x + radiusX); col++) {
        const value = pixels[row * width + col];
        pixel = maximum ? Math.max(pixel, value) : Math.min(pixel, value);
      }
    }
    return pixel;
  });
}

describe("morph", () => {
  it.each([true, false])("matches clipped reference windows (maximum: %s)", (maximum) => {
    let seed = 12345;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (const [width, height] of [[1, 1], [1, 12], [15, 1], [7, 9], [32, 17], [160, 48]]) {
      const size = width * height;
      const patterns = [
        Array(size).fill(42),
        Array.from({ length: size }, (_, i) => i / 3),
        Array.from({ length: size }, (_, i) => (size - i) / 3),
        Array.from({ length: size }, (_, i) => i % 2),
        Array.from({ length: size }, () => Math.floor(random() * 8)),
        Array.from({ length: size }, () => random() * 255),
      ];
      const radii = [[0, 0], [1, 1], [3, 0], [0, 4]];
      if (size <= 32 * 17) {
        radii.push([5, 24], [width + 1, height + 1]);
      }
      for (const pixels of patterns) {
        const original = [...pixels];
        for (const [rx, ry] of radii) {
          expect(morph(pixels, width, height, rx, ry, maximum))
            .toEqual(reference(pixels, width, height, rx, ry, maximum));
          expect(pixels).toEqual(original);
        }
      }
    }
  });
});
