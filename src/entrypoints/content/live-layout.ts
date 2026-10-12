import type { Rect } from "@/shared/types";

export interface ViewportSize {
  width: number;
  height: number;
}

/** The panel's box, in viewport coordinates. */
export interface PanelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The region's frame is drawn this far outside it; the panel clears that.
export const PANEL_GAP = 12;
export const PANEL_MARGIN = 8;
export const PANEL_WIDTH = 480;
export const PANEL_HEIGHT = 180;
// The smallest the panel gets above or below a region, or when resized: room
// for the title bar's buttons and languages, and one line of text.
export const PANEL_MIN_WIDTH = 250;
export const PANEL_MIN_HEIGHT = 96;

/**
 * Put the panel below the region without covering it, or above when there is
 * no room below. The panel must stay off the region because the screen is what
 * gets read, and it would otherwise read its own text back.
 *
 * With no room above or below (a region about as tall as the viewport) the
 * panel goes to the top of the viewport, away from where subtitles usually
 * are, and the caller masks the overlap.
 */
export function placeLivePanel(
  region: Rect,
  viewport: ViewportSize,
): PanelBox {
  const width = Math.max(
    0,
    Math.min(PANEL_WIDTH, viewport.width - PANEL_MARGIN * 2),
  );
  const height = Math.max(
    0,
    Math.min(PANEL_HEIGHT, viewport.height - PANEL_MARGIN * 2),
  );
  const centered = clamp(
    region.x + region.width / 2 - width / 2,
    PANEL_MARGIN,
    viewport.width - width - PANEL_MARGIN,
  );

  const regionBottom = region.y + region.height;

  const roomBelow = viewport.height - (regionBottom + PANEL_GAP) - PANEL_MARGIN;
  if (roomBelow >= PANEL_MIN_HEIGHT) {
    return {
      left: centered,
      top: regionBottom + PANEL_GAP,
      width,
      height: Math.min(height, roomBelow),
    };
  }

  const roomAbove = region.y - PANEL_GAP - PANEL_MARGIN;
  if (roomAbove >= PANEL_MIN_HEIGHT) {
    const aboveHeight = Math.min(height, roomAbove);
    return {
      left: centered,
      top: region.y - PANEL_GAP - aboveHeight,
      width,
      height: aboveHeight,
    };
  }

  return {
    left: clamp(
      (viewport.width - width) / 2,
      PANEL_MARGIN,
      viewport.width - width - PANEL_MARGIN,
    ),
    top: PANEL_MARGIN,
    width,
    height,
  };
}

/** `box` moved, and shrunk if it must be, to fit inside the viewport. */
export function clampPanelBox(box: PanelBox, viewport: ViewportSize): PanelBox {
  const width = Math.min(
    box.width,
    Math.max(0, viewport.width - PANEL_MARGIN * 2),
  );
  const height = Math.min(
    box.height,
    Math.max(0, viewport.height - PANEL_MARGIN * 2),
  );
  return {
    left: clamp(box.left, PANEL_MARGIN, viewport.width - width - PANEL_MARGIN),
    top: clamp(box.top, PANEL_MARGIN, viewport.height - height - PANEL_MARGIN),
    width,
    height,
  };
}

/**
 * Where the user put the panel, kept by the region. The page moves and resizes
 * the region as it scrolls, zooms and goes full screen, and the panel stays in
 * the same place by it, at the size the user gave it.
 */
export interface PanelAnchor {
  x: AxisAnchor;
  y: AxisAnchor;
  width: number;
  height: number;
}

/** The middle of the panel along one axis. Over the region it is a share of
 * the region, so a panel over the subtitles stays over them as the region
 * grows. Past an edge it keeps its distance from that edge. */
interface AxisAnchor {
  /** Of the region's size, from its start. Between 0 and 1. */
  share: number;
  /** In pixels, past the point that `share` marks. */
  offset: number;
}

export function anchorPanel(box: PanelBox, region: Rect): PanelAnchor {
  return {
    x: anchorAxis(box.left + box.width / 2, region.x, region.width),
    y: anchorAxis(box.top + box.height / 2, region.y, region.height),
    width: box.width,
    height: box.height,
  };
}

export function placeAnchoredPanel(anchor: PanelAnchor, region: Rect): PanelBox {
  return {
    left: placeAxis(anchor.x, region.x, region.width) - anchor.width / 2,
    top: placeAxis(anchor.y, region.y, region.height) - anchor.height / 2,
    width: anchor.width,
    height: anchor.height,
  };
}

function anchorAxis(middle: number, start: number, size: number): AxisAnchor {
  const share = clamp((middle - start) / size, 0, 1);
  return { share, offset: middle - (start + share * size) };
}

function placeAxis({ share, offset }: AxisAnchor, start: number, size: number): number {
  return start + share * size + offset;
}

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** `box` with the `edge` dragged by `dx` and `dy`. The opposite edges stay
 * put. The box is no smaller than the minimum and stays inside the viewport. */
export function resizePanelBox(
  box: PanelBox,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  viewport: ViewportSize,
): PanelBox {
  let { left, top, width, height } = box;
  if (edge.includes("e")) {
    width = clamp(
      box.width + dx,
      PANEL_MIN_WIDTH,
      viewport.width - box.left - PANEL_MARGIN,
    );
  }
  if (edge.includes("s")) {
    height = clamp(
      box.height + dy,
      PANEL_MIN_HEIGHT,
      viewport.height - box.top - PANEL_MARGIN,
    );
  }
  if (edge.includes("w")) {
    const right = box.left + box.width;
    width = clamp(box.width - dx, PANEL_MIN_WIDTH, right - PANEL_MARGIN);
    left = right - width;
  }
  if (edge.includes("n")) {
    const bottom = box.top + box.height;
    height = clamp(box.height - dy, PANEL_MIN_HEIGHT, bottom - PANEL_MARGIN);
    top = bottom - height;
  }
  return { left, top, width, height };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** `rect` grown by `amount` on every side. */
export function growRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, value), Math.max(min, max));
}
