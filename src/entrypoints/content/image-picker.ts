// Elements that paint content over whatever is under them.
const REPLACED_ELEMENTS = new Set([
  "canvas",
  "embed",
  "iframe",
  "img",
  "object",
  "svg",
  "video",
]);

// Smaller images are icons and the like. A press on one starts an area.
const MIN_IMAGE_SIZE = 30;

// The topmost image a user can see at a viewport point, or the iframe showing
// a page there; its own content script looks inside it. Hit testing already
// skips clipped, hidden, and inert images; this also skips images behind a
// backdrop or panel, such as the page under a lightbox. Images with
// pointer-events: none are skipped too: bounds alone can't tell whether they
// are visible.
export function findImageAtPoint(
  x: number,
  y: number,
  ignore?: Element,
): HTMLImageElement | HTMLIFrameElement | undefined {
  const stack = elementsAtPoint(document, x, y, ignore);

  for (const [index, element] of stack.entries()) {
    if (
      (element instanceof HTMLIFrameElement ||
        (element instanceof HTMLImageElement && isSelectableImage(element))) &&
      !isCovered(element, stack.slice(0, index))
    ) {
      return element;
    }
  }
  return undefined;
}

// Hit testing reports a shadow tree as its host. Open shadow trees are
// expanded in place, each element listed just above its host.
export function elementsAtPoint(
  root: Document | ShadowRoot,
  x: number,
  y: number,
  ignore: Element | undefined,
): Element[] {
  return root.elementsFromPoint(x, y).flatMap((element) => {
    // A shadow root also reports the elements around it; the caller has them.
    if (element === ignore || element.getRootNode() !== root) {
      return [];
    }
    const shadow = element.shadowRoot;
    return shadow
      ? [...elementsAtPoint(shadow, x, y, ignore), element]
      : [element];
  });
}

// Overlays that stay within the image (captions, badges, transparent click
// catchers) leave it visible; a painted layer reaching past it hides it.
function isCovered(target: Element, above: Element[]): boolean {
  const bounds = target.getBoundingClientRect();
  return above.some(
    (element) =>
      !element.contains(target) &&
      !isWithin(element.getBoundingClientRect(), bounds) &&
      paints(element),
  );
}

function isWithin(inner: DOMRect, outer: DOMRect): boolean {
  return (
    inner.left >= outer.left - 1 &&
    inner.top >= outer.top - 1 &&
    inner.right <= outer.right + 1 &&
    inner.bottom <= outer.bottom + 1
  );
}

function paints(element: Element): boolean {
  const style = getComputedStyle(element);
  if (style.opacity === "0") {
    return false;
  }
  return (
    REPLACED_ELEMENTS.has(element.localName) ||
    style.backgroundImage !== "none" ||
    !isTransparent(style.backgroundColor)
  );
}

function isTransparent(color: string): boolean {
  return (
    color === "transparent" ||
    /^rgba\(.*,\s*0\)$/.test(color) ||
    /\/\s*0\)$/.test(color)
  );
}

function isSelectableImage(image: HTMLImageElement): boolean {
  if (!image.currentSrc && !image.src) {
    return false;
  }
  const rect = image.getBoundingClientRect();
  return rect.width >= MIN_IMAGE_SIZE && rect.height >= MIN_IMAGE_SIZE;
}
