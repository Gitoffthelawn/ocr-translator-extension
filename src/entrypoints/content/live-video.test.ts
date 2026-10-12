import { describe, expect, it, vi } from "vitest";
import { createFrameSignature } from "@/shared/frame-signature";
import {
  clampShare,
  createVideoReader,
  scaledCropSize,
  videoCropRect,
  type VideoGrab,
  type VideoLook,
  type VideoReaderDeps,
} from "./live-video";

function grabOf(brightness: number, width = 400, height = 100): VideoGrab {
  const data = new Uint8ClampedArray(width * height * 4).fill(brightness);
  return {
    height,
    signature: createFrameSignature({ width, height, data }),
    encode: () => ({ data: `image-${brightness}`, mediaType: "image/jpeg" }),
  };
}

/** `looks` are returned in turn, and the last one from then on. */
function setup(looks: VideoLook[] = [grabOf(10)]) {
  const look = vi.fn(() => (looks.length > 1 ? looks.shift()! : looks[0]));
  const recognize = vi.fn<VideoReaderDeps["recognize"]>(async () => ({
    text: "Hello there",
  }));
  const read = createVideoReader({ look, recognize });
  return { read, look, recognize };
}

describe("createVideoReader", () => {
  it("sends the region to recognition and reports what it found", async () => {
    const { read, recognize } = setup([grabOf(10, 400, 100)]);
    recognize.mockResolvedValueOnce({ text: "Hello there", lineThickness: 20 });

    await expect(read("request-1", undefined)).resolves.toEqual({
      status: "ok",
      text: "Hello there",
      unchanged: false,
      lineThickness: 0.2,
    });
    expect(recognize).toHaveBeenCalledWith(
      "request-1",
      { data: "image-10", mediaType: "image/jpeg" },
      undefined,
    );
  });

  it("asks for the share of the region's height in pixels of the video", async () => {
    const { read, recognize } = setup([grabOf(10, 400, 100)]);

    await read("request-1", 0.5);

    expect(recognize).toHaveBeenLastCalledWith(
      "request-1",
      expect.anything(),
      50,
    );
  });

  it("repeats the last text when the region looks the same", async () => {
    const { read, recognize } = setup();
    await read("request-1", undefined);

    await expect(read("request-2", undefined)).resolves.toEqual({
      status: "ok",
      text: "Hello there",
      unchanged: true,
    });
    expect(recognize).toHaveBeenCalledOnce();
  });

  it("recognizes again when the region changed", async () => {
    const { read, recognize } = setup([grabOf(10), grabOf(200)]);
    await read("request-1", undefined);

    await expect(read("request-2", undefined)).resolves.toMatchObject({
      unchanged: false,
    });
    expect(recognize).toHaveBeenCalledTimes(2);
  });

  it("recognizes the same frame again when the session asks for thicker lines", async () => {
    const { read, recognize } = setup();
    await read("request-1", undefined);

    await read("request-2", 0.3);

    expect(recognize).toHaveBeenCalledTimes(2);
  });

  it("compares with the last frame it read while the region drifts", async () => {
    const { read, recognize } = setup([
      grabOf(10),
      grabOf(20),
      grabOf(30),
    ]);
    for (let index = 1; index <= 3; index += 1) {
      await read(`request-${index}`, undefined);
    }

    // Every step is small, but 10 and 30 differ by more than the tolerance.
    expect(recognize).toHaveBeenCalledTimes(2);
  });

  it("reports a region it cannot see yet", async () => {
    const { read, recognize } = setup(["waiting"]);

    await expect(read("request-1", undefined)).resolves.toEqual({
      status: "hidden",
    });
    expect(recognize).not.toHaveBeenCalled();
  });

  it("leaves a video it cannot read to the screen", async () => {
    const { read, recognize } = setup([grabOf(10), "unreadable"]);
    await read("request-1", undefined);

    await expect(read("request-2", undefined)).resolves.toBeUndefined();
    expect(recognize).toHaveBeenCalledOnce();
  });

  it("recognizes the region again after a failed read", async () => {
    const { read, recognize } = setup();
    recognize.mockRejectedValueOnce(new Error("worker crashed"));

    await expect(read("request-1", undefined)).rejects.toThrow("worker crashed");
    await expect(read("request-2", undefined)).resolves.toMatchObject({
      unchanged: false,
    });
    expect(recognize).toHaveBeenCalledTimes(2);
  });
});

describe("clampShare", () => {
  it("keeps a region that is on the picture", () => {
    const share = { x: 0.125, y: 0.75, width: 0.75, height: 0.125 };

    expect(clampShare(share)).toEqual(share);
  });

  it("drops the part of the region past the picture", () => {
    expect(clampShare({ x: -0.25, y: 0.75, width: 0.5, height: 0.5 })).toEqual({
      x: 0,
      y: 0.75,
      width: 0.25,
      height: 0.25,
    });
  });

  it("finds nothing when the region is off the picture", () => {
    expect(clampShare({ x: 0.2, y: 1.1, width: 0.5, height: 0.2 })).toBeUndefined();
    expect(
      clampShare({ x: Number.NaN, y: 0.5, width: Number.NaN, height: 0.2 }),
    ).toBeUndefined();
  });
});

describe("scaledCropSize", () => {
  const strip = { width: 576, height: 72 };

  it("reads a video up to 720p at its own size", () => {
    expect(scaledCropSize(strip, { width: 640, height: 360 })).toEqual(strip);
    expect(scaledCropSize(strip, { width: 1280, height: 720 })).toEqual(strip);
  });

  it("reads a larger video as if it were 720p", () => {
    expect(
      scaledCropSize({ width: 1728, height: 216 }, { width: 1920, height: 1080 }),
    ).toEqual({ width: 1152, height: 144 });
    expect(
      scaledCropSize({ width: 3456, height: 432 }, { width: 3840, height: 2160 }),
    ).toEqual({ width: 1152, height: 144 });
    // A wide film fits its width.
    expect(
      scaledCropSize({ width: 3456, height: 432 }, { width: 3840, height: 1608 }),
    ).toEqual({ width: 1152, height: 144 });
  });

  it("treats a portrait video like a landscape one of the same size", () => {
    expect(
      scaledCropSize({ width: 960, height: 300 }, { width: 1080, height: 1920 }),
    ).toEqual({ width: 640, height: 200 });
    expect(
      scaledCropSize({ width: 1920, height: 600 }, { width: 2160, height: 3840 }),
    ).toEqual({ width: 640, height: 200 });
  });

  it("is never empty", () => {
    expect(
      scaledCropSize({ width: 1, height: 1 }, { width: 7680, height: 4320 }),
    ).toEqual({ width: 1, height: 1 });
  });
});

describe("videoCropRect", () => {
  it("maps shares of the picture to the video's own pixels", () => {
    expect(
      videoCropRect(
        { x: 0.1, y: 0.7, width: 0.8, height: 0.2 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ x: 192, y: 756, width: 1536, height: 216 });
  });

  it("rounds out to whole pixels so no edge of the region is lost", () => {
    expect(
      videoCropRect(
        { x: 0.101, y: 0.501, width: 0.5, height: 0.2 },
        { width: 100, height: 100 },
      ),
    ).toEqual({ x: 10, y: 50, width: 51, height: 21 });
  });

  it("is never empty, even for a sliver", () => {
    expect(
      videoCropRect(
        { x: 0.999, y: 0.999, width: 0.0001, height: 0.0001 },
        { width: 100, height: 50 },
      ),
    ).toEqual({ x: 99, y: 49, width: 1, height: 1 });
  });
});
