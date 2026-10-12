import {
  createFrameSignature,
  framesMatch,
  type FrameSignature,
} from "@/shared/frame-signature";
import type { LiveFrameResponse, LiveImageResponse } from "@/shared/messages";
import type { EncodedImage, Rect } from "@/shared/types";

/** What the region holds in one frame of the video. */
export interface VideoGrab {
  /** In pixels of the image that is read. */
  height: number;
  signature: FrameSignature;
  encode(): EncodedImage;
}

/**
 * What one look at the video found: the region in its current frame,
 * "waiting" while there is no frame to take it from or the region is out of
 * view, or "unreadable" while the page keeps the pixels from the extension.
 */
export type VideoLook = VideoGrab | "waiting" | "unreadable";

export interface VideoReaderDeps {
  look(): VideoLook;
  /** `minLineThickness` is in pixels of `image`. */
  recognize(
    requestId: string,
    image: EncodedImage,
    minLineThickness: number | undefined,
  ): Promise<LiveImageResponse>;
}

/** Reads the region like a screen read does. Resolves to nothing when the
 * video cannot be read, so the caller reads the screen instead. */
export type VideoReader = (
  requestId: string,
  minLineThickness: number | undefined,
) => Promise<LiveFrameResponse | undefined>;

export interface LiveVideoSource {
  read: VideoReader;
  dispose(): void;
}

/** The last region that was actually read, and what it said. The next look is
 * compared with it. */
interface Reading {
  signature: FrameSignature;
  text: string;
  /** The session's floor at the time. A look at the same frame with a higher
   * one would give different text. */
  minLineThickness: number | undefined;
}

// Events after which the video shows new frames: it plays again, or jumped.
const WAKE_EVENTS = ["playing", "seeked", "loadeddata"] as const;
// Scale the crop as if the whole video fit these limits, including portrait video.
const MAX_FRAME_LONG_SIDE = 1280;
const MAX_FRAME_SHORT_SIDE = 720;
const FRAME_QUALITY = 0.92;

/**
 * Reads the region from the frames of `video` instead of from the screen. The
 * extension's panel is never in them, so it can cover the subtitles. The region
 * is also read at the video's own resolution, however small the player is, up
 * to 720p.
 *
 * `share` is the region as shares of where the video draws its picture. Returns
 * nothing when none of the region is over the picture.
 */
export function readFromVideo(
  video: HTMLVideoElement,
  share: Rect,
  deps: {
    isInView(): boolean;
    recognize: VideoReaderDeps["recognize"];
    /** The video shows new frames again after a pause or a jump. */
    onWake(): void;
  },
): LiveVideoSource | undefined {
  const inside = clampShare(share);
  if (!inside) {
    return undefined;
  }

  for (const type of WAKE_EVENTS) {
    video.addEventListener(type, deps.onWake);
  }
  return {
    read: createVideoReader({
      look: createVideoGrabber(video, inside, deps.isInView),
      recognize: deps.recognize,
    }),
    dispose() {
      for (const type of WAKE_EVENTS) {
        video.removeEventListener(type, deps.onWake);
      }
    },
  };
}

/** Skips recognition when the region looks the same as at the last read,
 * such as in a paused video. */
export function createVideoReader(deps: VideoReaderDeps): VideoReader {
  let previous: Reading | undefined;

  return async (requestId, minLineThickness) => {
    const look = deps.look();
    if (look === "unreadable") {
      return undefined;
    }
    if (look === "waiting") {
      return { status: "hidden" };
    }
    if (
      previous &&
      previous.minLineThickness === minLineThickness &&
      framesMatch(previous.signature, look.signature)
    ) {
      return { status: "ok", text: previous.text, unchanged: true };
    }

    // The session asks for a share of the region's height.
    const found = await deps.recognize(
      requestId,
      look.encode(),
      minLineThickness === undefined
        ? undefined
        : minLineThickness * look.height,
    );
    previous = {
      signature: look.signature,
      text: found.text,
      minLineThickness,
    };
    return {
      status: "ok",
      text: found.text,
      unchanged: false,
      lineThickness: found.lineThickness && found.lineThickness / look.height,
    };
  };
}

/** Takes the region out of the video's current frame, at the video's own
 * resolution or 720p, whichever is smaller. */
function createVideoGrabber(
  video: HTMLVideoElement,
  share: Rect,
  isInView: () => boolean,
): () => VideoLook {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  // A canvas that once held pixels from another site can never be read again.
  let tainted = false;

  return () => {
    // A protected video draws as black, and a video without a source draws
    // nothing. The screen can still show what is there.
    if (
      tainted ||
      !context ||
      video.mediaKeys ||
      video.networkState === video.NETWORK_EMPTY
    ) {
      return "unreadable";
    }
    const { videoWidth, videoHeight } = video;
    if (
      !isInView() ||
      video.readyState < video.HAVE_CURRENT_DATA ||
      videoWidth === 0 ||
      videoHeight === 0
    ) {
      return "waiting";
    }

    const size = { width: videoWidth, height: videoHeight };
    const crop = videoCropRect(share, size);
    const { width, height } = scaledCropSize(crop, size);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    // Resizing the canvas resets this. The default blurs thin strokes when it
    // scales down.
    context.imageSmoothingQuality = "high";
    context.drawImage(
      video,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      width,
      height,
    );

    let pixels: ImageData;
    try {
      pixels = context.getImageData(0, 0, width, height);
    } catch (error) {
      // A video from another site that does not allow reading it.
      if (error instanceof DOMException && error.name === "SecurityError") {
        tainted = true;
        return "unreadable";
      }
      throw error;
    }

    return {
      height,
      signature: createFrameSignature(pixels),
      encode: () => ({
        data: canvas.toDataURL("image/jpeg", FRAME_QUALITY).split(",", 2)[1],
        mediaType: "image/jpeg",
      }),
    };
  };
}

/** The part of `share` that is on the picture, or nothing when none of it is.
 * The region can reach past the picture, onto the bars around it or the page
 * beside it. */
export function clampShare(share: Rect): Rect | undefined {
  const left = clamp(share.x, 0, 1);
  const top = clamp(share.y, 0, 1);
  const width = clamp(share.x + share.width, 0, 1) - left;
  const height = clamp(share.y + share.height, 0, 1) - top;
  // Also false for NaN, from a picture that had no size yet.
  return width > 0 && height > 0 ? { x: left, y: top, width, height } : undefined;
}

/**
 * The part of the video's own pixels that a region covers, rounded out to
 * whole pixels. `share` is the region as shares of the picture.
 */
export function videoCropRect(
  share: Rect,
  size: { width: number; height: number },
): Rect {
  const left = clamp(Math.floor(share.x * size.width), 0, size.width - 1);
  const top = clamp(Math.floor(share.y * size.height), 0, size.height - 1);
  const right = clamp(
    Math.ceil((share.x + share.width) * size.width),
    left + 1,
    size.width,
  );
  const bottom = clamp(
    Math.ceil((share.y + share.height) * size.height),
    top + 1,
    size.height,
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The size `crop` is read at: smaller by the same factor as a video of
 * `size` would be to fit in 720p, and never smaller than a pixel. A portrait
 * video fits its long side to 1280 just the same. */
export function scaledCropSize(
  crop: { width: number; height: number },
  size: { width: number; height: number },
): { width: number; height: number } {
  const scale = Math.min(
    1,
    MAX_FRAME_LONG_SIDE / Math.max(size.width, size.height),
    MAX_FRAME_SHORT_SIDE / Math.min(size.width, size.height),
  );
  return {
    width: Math.max(1, Math.round(crop.width * scale)),
    height: Math.max(1, Math.round(crop.height * scale)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
