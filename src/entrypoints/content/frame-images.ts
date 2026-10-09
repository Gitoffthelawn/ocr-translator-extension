import type { Rect } from "@/shared/types";
import { findImageAtPoint } from "./image-picker";

// Region selection covers the page from the top frame, so pages in iframes
// never see the pointer. To find an image in one, the top frame posts the
// point to the iframe's window. The content script there looks it up, or
// passes it on to a nested iframe, and answers through the background, which
// adds its frame ID. Answers never pass through a page, so a parent page
// can't use them to look inside a cross-origin frame.

const PROBE_TYPE = "ocr-translate:find-frame-image";
// Frames without the content script never answer.
const PROBE_TIMEOUT_MS = 300;

interface Point {
  x: number;
  y: number;
}

// Where a frame's viewport sits in the top frame's viewport.
interface FrameView {
  x: number;
  y: number;
  scale: number;
  /** The part of the top viewport the frame shows through. */
  clip: Rect;
}

interface Probe {
  type: typeof PROBE_TYPE;
  probeId: number;
  /** In the receiving frame's viewport. */
  point: Point;
  view: FrameView;
}

export interface FrameImageAnswer {
  probeId: number;
  /** Set by the background. */
  frameId?: number;
  /** Absent when there is no image at the point. */
  image?: { rect: Rect; point: Point };
}

export interface FrameImage {
  frameId: number;
  /** The visible part of the image, in the top frame's viewport. */
  rect: Rect;
  /** A point on the image, in its frame's viewport. */
  point: Point;
}

let lastProbeId = 0;
const pendingProbes = new Map<
  number,
  (image: FrameImage | undefined) => void
>();

/** The image at a top viewport point inside `frame`, or a nested frame. */
export function findFrameImage(
  frame: HTMLIFrameElement,
  point: Point,
): Promise<FrameImage | undefined> {
  const probeId = ++lastProbeId;
  return new Promise((resolve) => {
    const settle = (image: FrameImage | undefined): void => {
      clearTimeout(timeout);
      pendingProbes.delete(probeId);
      resolve(image);
    };
    const timeout = setTimeout(() => settle(undefined), PROBE_TIMEOUT_MS);
    pendingProbes.set(probeId, settle);

    const top: FrameView = {
      x: 0,
      y: 0,
      scale: 1,
      clip: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
    };
    if (!postProbe(frame, probeId, point, top)) {
      settle(undefined);
    }
  });
}

export function receiveFrameImage({
  probeId,
  frameId,
  image,
}: FrameImageAnswer): void {
  pendingProbes.get(probeId)?.(
    image && frameId !== undefined ? { frameId, ...image } : undefined,
  );
}

/** Answers a probe posted by the parent frame. */
export function answerFrameImageProbe(
  event: MessageEvent,
  ignore: Element | undefined,
  answer: (answer: FrameImageAnswer) => void,
): void {
  const probe: unknown = event.data;
  if (
    window.parent === window ||
    event.source !== window.parent ||
    !isProbe(probe)
  ) {
    return;
  }

  const { probeId, point, view } = probe;
  const target = findImageAtPoint(point.x, point.y, ignore);
  if (target instanceof HTMLIFrameElement) {
    if (!postProbe(target, probeId, point, view)) {
      answer({ probeId });
    }
    return;
  }
  if (!target) {
    answer({ probeId });
    return;
  }

  const rect = intersect(
    view.clip,
    toTopViewport(view, target.getBoundingClientRect()),
  );
  answer({ probeId, image: { rect, point } });
}

function postProbe(
  frame: HTMLIFrameElement,
  probeId: number,
  point: Point,
  view: FrameView,
): boolean {
  const target = frame.contentWindow;
  if (!target) {
    return false;
  }

  const bounds = frame.getBoundingClientRect();
  // A transform on the iframe or an ancestor scales its page too.
  const scale = frame.offsetWidth > 0 ? bounds.width / frame.offsetWidth : 1;
  const style = getComputedStyle(frame);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;
  const paddingBottom = parseFloat(style.paddingBottom) || 0;
  // The iframe's page fills its content box.
  const content = {
    x: bounds.x + (frame.clientLeft + paddingLeft) * scale,
    y: bounds.y + (frame.clientTop + paddingTop) * scale,
    width: (frame.clientWidth - paddingLeft - paddingRight) * scale,
    height: (frame.clientHeight - paddingTop - paddingBottom) * scale,
  };
  const contentInTop = toTopViewport(view, content);

  const probe: Probe = {
    type: PROBE_TYPE,
    probeId,
    point: {
      x: (point.x - content.x) / scale,
      y: (point.y - content.y) / scale,
    },
    view: {
      x: contentInTop.x,
      y: contentInTop.y,
      scale: view.scale * scale,
      clip: intersect(view.clip, contentInTop),
    },
  };
  target.postMessage(probe, "*");
  return true;
}

function toTopViewport(view: FrameView, rect: Rect): Rect {
  return {
    x: view.x + rect.x * view.scale,
    y: view.y + rect.y * view.scale,
    width: rect.width * view.scale,
    height: rect.height * view.scale,
  };
}

function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

// Any page can post messages, so check every field before using it.
function isProbe(data: unknown): data is Probe {
  const probe = data as Partial<Probe> | null | undefined;
  const { point, view } = probe ?? {};
  return (
    probe?.type === PROBE_TYPE &&
    [
      probe.probeId,
      point?.x,
      point?.y,
      view?.x,
      view?.y,
      view?.scale,
      view?.clip?.x,
      view?.clip?.y,
      view?.clip?.width,
      view?.clip?.height,
    ].every(Number.isFinite)
  );
}
