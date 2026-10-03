import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium, firefox } from "@playwright/test";
import { transformWithOxc } from "vite";

const contentDir = new URL("../../../src/entrypoints/content/", import.meta.url);
const pickerSource = await readFile(new URL("image-picker.ts", contentDir), "utf8");
const selectionSource = await readFile(new URL("selection-overlay.ts", contentDir), "utf8");
const css = await readFile(new URL("style.css", contentDir), "utf8");
const { code } = await transformWithOxc(
  ["const t = (key: string) => key;", pickerSource, selectionSource]
    .join("\n")
    .replace(/^import .*;\n/gm, ""),
  "selection-overlay.ts",
);
const svg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/%3E";

for (const [name, browserType] of Object.entries({ chromium, firefox })) {
  test(`${name}: region selection picks a hovered image on click`, async () => {
    const browser = await browserType.launch({
      headless: true,
      executablePath: process.env[`${name.toUpperCase()}_TEST_EXECUTABLE`],
    });
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
      await page.setContent(`
        <body style="margin:0; height:3000px">
          <img id="photo" src="${svg}" style="position:absolute; left:100px; top:150px; width:300px; height:200px">
          <div id="cover" style="position:absolute; left:100px; top:150px; width:300px; height:200px"></div>
          <img id="icon" src="${svg}" style="position:absolute; left:500px; top:150px; width:16px; height:16px">
          <img id="passive" src="${svg}" style="position:absolute; left:600px; top:150px; width:100px; height:100px; pointer-events:none">
          <div style="position:absolute; left:450px; top:400px; width:100px; height:100px; overflow:hidden">
            <img id="clipped" src="${svg}" style="position:absolute; left:150px; top:0; width:100px; height:100px">
          </div>
        </body>
      `);
      await page.addScriptTag({
        type: "module",
        content: `${code}
          const host = document.createElement("div");
          document.body.append(host);
          const shadow = host.attachShadow({ mode: "open" });
          const style = document.createElement("style");
          style.textContent = ${JSON.stringify(css)};
          const container = document.createElement("div");
          shadow.append(style, container);

          // A page component with an image two shadow roots deep.
          const outer = document.createElement("div");
          outer.style.cssText = "position:absolute; left:100px; top:420px; width:200px; height:120px";
          const inner = document.createElement("div");
          const image = document.createElement("img");
          image.id = "shadowed";
          image.src = ${JSON.stringify(svg)};
          image.style.cssText = "display:block; width:200px; height:120px";
          inner.attachShadow({ mode: "open" }).append(image);
          outer.attachShadow({ mode: "open" }).append(inner);
          document.body.append(outer);

          window.release = releaseSelectionDim;
          window.pick = () => {
            window.picked = "pending";
            startImagePickerOverlay(container).then((result) => {
              window.picked = result?.id ?? null;
            });
          };
          window.start = (adjust) => {
            window.selection = "pending";
            startSelectionOverlay(container, adjust).then((result) => {
              window.selection = result?.kind === "image"
                ? { kind: "image", id: result.image.id }
                : result;
            });
          };
        `,
      });
      await page.waitForFunction(() => Boolean(window.start));
      const frame = page.locator(".ocr-translate-image-picker-frame");
      const settled = async () => {
        await page.waitForFunction(() => window.selection !== "pending");
        return page.evaluate(() => window.selection);
      };

      await page.evaluate(() => window.start(true));
      await page.mouse.move(250, 250);
      assert.deepEqual(await frame.boundingBox(), { x: 100, y: 150, width: 300, height: 200 });

      // Icons are too small to offer, and empty space shows nothing.
      await page.mouse.move(508, 158);
      assert.equal(await frame.isVisible(), false);
      await page.mouse.move(600, 400);
      assert.equal(await frame.isVisible(), false);

      // Hit testing skips images with pointer-events: none.
      await page.mouse.move(650, 200);
      assert.equal(await frame.isVisible(), false);

      // Clipped out by its container.
      await page.mouse.move(650, 450);
      assert.equal(await frame.isVisible(), false);

      // A lightbox hides the page behind its backdrop.
      await page.evaluate((src) => {
        const lightbox = document.createElement("div");
        lightbox.id = "lightbox";
        lightbox.style.cssText = "position:fixed; inset:0; background:rgba(0, 0, 0, 0.9)";
        const image = document.createElement("img");
        image.src = src;
        image.style.cssText = "position:absolute; left:250px; top:300px; width:200px; height:150px";
        lightbox.append(image);
        document.body.append(lightbox);
      }, svg);
      await page.mouse.move(150, 200);
      assert.equal(await frame.isVisible(), false);
      await page.mouse.move(300, 320);
      assert.deepEqual(await frame.boundingBox(), { x: 250, y: 300, width: 200, height: 150 });
      await page.evaluate(() => document.querySelector("#lightbox").remove());

      // The page scrolling under a still pointer moves the image away.
      await page.mouse.move(250, 250);
      assert.equal(await frame.isVisible(), true);
      await page.evaluate(() => window.scrollTo(0, 300));
      await frame.waitFor({ state: "hidden" });
      await page.evaluate(() => window.scrollTo(0, 0));
      await frame.waitFor({ state: "visible" });

      // A drag too small for an area falls back to the hover.
      await page.mouse.down();
      await page.mouse.move(260, 260, { steps: 3 });
      assert.equal(await frame.isVisible(), false);
      await page.mouse.up();
      assert.equal(await frame.isVisible(), true);
      assert.equal(await page.evaluate(() => window.selection), "pending");

      // A click picks the image without the adjust step.
      await page.mouse.click(250, 250);
      assert.deepEqual(await settled(), { kind: "image", id: "photo" });
      assert.equal(await frame.isVisible(), false);
      await page.evaluate(() => window.release());

      // Images inside open shadow roots, as Pick image finds them.
      await page.evaluate(() => window.start(true));
      await page.mouse.move(200, 480);
      assert.deepEqual(await frame.boundingBox(), { x: 100, y: 420, width: 200, height: 120 });
      await page.mouse.click(200, 480);
      assert.deepEqual(await settled(), { kind: "image", id: "shadowed" });
      await page.evaluate(() => window.release());

      // A drag that starts on an image still selects an area.
      await page.evaluate(() => window.start(false));
      await page.mouse.move(150, 200);
      await page.mouse.down();
      await page.mouse.move(350, 320, { steps: 5 });
      assert.equal(await frame.isVisible(), false);
      await page.mouse.up();
      assert.deepEqual(await settled(), {
        kind: "area",
        rect: { x: 150, y: 200, width: 200, height: 120 },
      });
      await page.evaluate(() => window.release());

      // An area being adjusted takes priority over image hover.
      await page.evaluate(() => window.start(true));
      await page.mouse.move(450, 400);
      await page.mouse.down();
      await page.mouse.move(600, 500, { steps: 5 });
      await page.mouse.up();
      await page.mouse.move(250, 250);
      assert.equal(await frame.isVisible(), false);
      await page.keyboard.press("Escape");
      assert.equal(await settled(), null);
      assert.equal(await page.locator(".ocr-translate-selection-overlay").count(), 0);

      // Pick image uses the same lookup.
      await page.evaluate(() => window.pick());
      await page.mouse.move(250, 250);
      assert.deepEqual(await frame.boundingBox(), { x: 100, y: 150, width: 300, height: 200 });
      await page.mouse.move(650, 450);
      assert.equal(await frame.isVisible(), false);
      await page.mouse.move(200, 480);
      assert.deepEqual(await frame.boundingBox(), { x: 100, y: 420, width: 200, height: 120 });
      await page.mouse.click(200, 480);
      await page.waitForFunction(() => window.picked !== "pending");
      assert.equal(await page.evaluate(() => window.picked), "shadowed");
    } finally {
      await browser.close();
    }
  });
}
