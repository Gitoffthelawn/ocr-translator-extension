import { describe, expect, it } from "vitest";
import type { Rect } from "@/shared/types";
import {
  anchorPanel,
  clampPanelBox,
  growRect,
  PANEL_GAP,
  PANEL_HEIGHT,
  PANEL_MARGIN,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  PANEL_WIDTH,
  placeAnchoredPanel,
  placeLivePanel,
  rectsOverlap,
  resizePanelBox,
  type PanelBox,
} from "./live-layout";

const viewport = { width: 1280, height: 720 };

const rectOf = (box: PanelBox): Rect => ({
  x: box.left,
  y: box.top,
  width: box.width,
  height: box.height,
});

describe("placeLivePanel", () => {
  it("puts a panel of the default size below a region with room under it", () => {
    const region = { x: 200, y: 100, width: 600, height: 80 };
    const placement = placeLivePanel(region, viewport);

    expect(placement.top).toBe(100 + 80 + PANEL_GAP);
    expect(placement.width).toBe(PANEL_WIDTH);
    expect(placement.height).toBe(PANEL_HEIGHT);
    expect(rectsOverlap(rectOf(placement), growRect(region, 4))).toBe(false);
  });

  it("puts the panel above a region near the bottom edge", () => {
    const region = { x: 200, y: 600, width: 880, height: 80 };
    const placement = placeLivePanel(region, viewport);

    expect(placement.top + placement.height).toBe(600 - PANEL_GAP);
    expect(rectsOverlap(rectOf(placement), growRect(region, 4))).toBe(false);
  });

  it("limits the height to the room that is left", () => {
    const region = { x: 200, y: 100, width: 600, height: 440 };
    const placement = placeLivePanel(region, viewport);

    expect(placement.top).toBe(540 + PANEL_GAP);
    expect(placement.height).toBe(
      viewport.height - (540 + PANEL_GAP) - PANEL_MARGIN,
    );
  });

  it("centers the panel on the region", () => {
    const region = { x: 400, y: 100, width: 400, height: 60 };
    const placement = placeLivePanel(region, viewport);

    expect(placement.left).toBe(600 - PANEL_WIDTH / 2);
  });

  it("keeps the default width under a wide region", () => {
    const region = { x: 0, y: 100, width: 1280, height: 60 };
    const placement = placeLivePanel(region, viewport);

    expect(placement.width).toBe(PANEL_WIDTH);
    expect(placement.left).toBe((1280 - PANEL_WIDTH) / 2);
  });

  it("keeps the panel inside the viewport at the left edge", () => {
    const region = { x: 10, y: 100, width: 80, height: 40 };
    const placement = placeLivePanel(region, viewport);

    expect(placement.left).toBe(PANEL_MARGIN);
  });

  it("slides back inside the viewport at the right edge", () => {
    const region = { x: 1200, y: 100, width: 70, height: 40 };
    const placement = placeLivePanel(region, viewport);

    expect(placement.left).toBe(viewport.width - placement.width - PANEL_MARGIN);
  });

  it("goes to the top edge of a region that spans the viewport's height, whatever the room beside it", () => {
    const region = { x: 20, y: 20, width: 500, height: 680 };
    const placement = placeLivePanel(region, viewport);

    expect(placement).toEqual({
      left: (viewport.width - PANEL_WIDTH) / 2,
      top: PANEL_MARGIN,
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
    });
  });

  it("falls back to the top edge, away from subtitles, when nothing fits", () => {
    const region = { x: 0, y: 0, width: 1280, height: 720 };
    const placement = placeLivePanel(region, viewport);

    expect(rectsOverlap(rectOf(placement), region)).toBe(true);
    expect(placement.top).toBe(PANEL_MARGIN);
  });

  it("never returns a negative size in a tiny viewport", () => {
    const placement = placeLivePanel(
      { x: 0, y: 0, width: 50, height: 50 },
      { width: 10, height: 10 },
    );

    expect(placement.width).toBeGreaterThanOrEqual(0);
    expect(placement.height).toBeGreaterThanOrEqual(0);
  });
});

describe("clampPanelBox", () => {
  const box = { left: 100, top: 200, width: 300, height: 120 };

  it("leaves a box inside the viewport alone", () => {
    expect(clampPanelBox(box, viewport)).toEqual(box);
  });

  it("pulls a box back from every edge", () => {
    expect(clampPanelBox({ ...box, left: -50, top: -50 }, viewport)).toEqual({
      ...box,
      left: PANEL_MARGIN,
      top: PANEL_MARGIN,
    });
    expect(clampPanelBox({ ...box, left: 5000, top: 5000 }, viewport)).toEqual({
      ...box,
      left: viewport.width - box.width - PANEL_MARGIN,
      top: viewport.height - box.height - PANEL_MARGIN,
    });
  });

  it("shrinks a box larger than the viewport", () => {
    expect(
      clampPanelBox({ left: 0, top: 0, width: 5000, height: 5000 }, viewport),
    ).toEqual({
      left: PANEL_MARGIN,
      top: PANEL_MARGIN,
      width: viewport.width - PANEL_MARGIN * 2,
      height: viewport.height - PANEL_MARGIN * 2,
    });
  });
});

describe("resizePanelBox", () => {
  const box = { left: 100, top: 200, width: 300, height: 120 };

  it("moves the bottom right corner and keeps the top left one", () => {
    expect(resizePanelBox(box, "se", 400, 280, viewport)).toEqual({
      ...box,
      width: 700,
      height: 400,
    });
  });

  it("moves only one side from an edge", () => {
    expect(resizePanelBox(box, "e", 50, 50, viewport)).toEqual({
      ...box,
      width: 350,
    });
    expect(resizePanelBox(box, "s", 50, 50, viewport)).toEqual({
      ...box,
      height: 170,
    });
  });

  it("keeps the right and bottom edges when dragging left and top", () => {
    expect(resizePanelBox(box, "nw", -40, -30, viewport)).toEqual({
      left: 60,
      top: 170,
      width: 340,
      height: 150,
    });
  });

  it("does not shrink below the minimum", () => {
    expect(resizePanelBox(box, "se", -290, -110, viewport)).toEqual({
      ...box,
      width: PANEL_MIN_WIDTH,
      height: PANEL_MIN_HEIGHT,
    });
  });

  it("keeps the far edge in place when the minimum stops a left or top drag", () => {
    const result = resizePanelBox(box, "nw", 290, 110, viewport);

    expect(result.left + result.width).toBe(400);
    expect(result.top + result.height).toBe(320);
    expect(result.width).toBe(PANEL_MIN_WIDTH);
    expect(result.height).toBe(PANEL_MIN_HEIGHT);
  });

  it("stops at the viewport's edges", () => {
    expect(resizePanelBox(box, "se", 5000, 5000, viewport)).toEqual({
      ...box,
      width: viewport.width - 100 - PANEL_MARGIN,
      height: viewport.height - 200 - PANEL_MARGIN,
    });
    expect(resizePanelBox(box, "nw", -5000, -5000, viewport)).toEqual({
      left: PANEL_MARGIN,
      top: PANEL_MARGIN,
      width: 400 - PANEL_MARGIN,
      height: 320 - PANEL_MARGIN,
    });
  });
});

describe("anchorPanel", () => {
  const region = { x: 200, y: 400, width: 800, height: 120 };
  // The same region in full screen: larger, and lower down.
  const fullScreen = { x: 100, y: 800, width: 1600, height: 240 };
  const follow = (box: PanelBox, to: Rect) =>
    placeAnchoredPanel(anchorPanel(box, region), to);

  it("puts the panel back where it was while the region stays", () => {
    const box = { left: 340, top: 250, width: 480, height: 180 };

    expect(follow(box, region)).toEqual(box);
  });

  it("keeps a panel over the same part of a region that grows", () => {
    // Over the subtitles, a little left of the middle.
    const box = { left: 300, top: 380, width: 480, height: 180 };

    expect(follow(box, fullScreen)).toEqual({
      left: 100 + 1600 * (340 / 800) - 240,
      top: 800 + 240 * (70 / 120) - 90,
      width: 480,
      height: 180,
    });
  });

  it("keeps its distance from the edge it is past", () => {
    // Above the region, with a 20 px gap, and centred on it.
    const above = { left: 360, top: 200, width: 480, height: 180 };
    expect(follow(above, fullScreen)).toEqual({
      left: 100 + 800 - 240,
      top: 800 - 20 - 180,
      width: 480,
      height: 180,
    });

    // Right of the region, level with its top. Its middle is level with the
    // region, so up and down it keeps its share.
    const right = { left: 1012, top: 400, width: 300, height: 180 };
    expect(follow(right, fullScreen)).toEqual({
      left: 100 + 1600 + 12,
      top: 800 + 240 * (90 / 120) - 90,
      width: 300,
      height: 180,
    });
  });
});

describe("rect helpers", () => {
  it("tells overlapping rects from touching ones", () => {
    const base = { x: 0, y: 0, width: 100, height: 50 };

    expect(rectsOverlap(base, { x: 99, y: 49, width: 10, height: 10 })).toBe(true);
    expect(rectsOverlap(base, { x: 100, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectsOverlap(base, { x: 0, y: 50, width: 10, height: 10 })).toBe(false);
  });

  it("grows a rect on every side", () => {
    expect(growRect({ x: 10, y: 20, width: 100, height: 50 }, 4)).toEqual({
      x: 6,
      y: 16,
      width: 108,
      height: 58,
    });
  });
});
