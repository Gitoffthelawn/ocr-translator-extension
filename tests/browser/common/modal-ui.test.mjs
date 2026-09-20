import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium, firefox } from "@playwright/test";
import { transformWithOxc } from "vite";

const contentDir = new URL("../../../src/entrypoints/content/", import.meta.url);
const modalSource = await readFile(new URL("modal-ui.ts", contentDir), "utf8");
const selectionSource = await readFile(new URL("selection-overlay.ts", contentDir), "utf8");
const css = await readFile(new URL("style.css", contentDir), "utf8");
const { code } = await transformWithOxc(
  modalSource + "\n" + selectionSource.replace(
    'import { t } from "@/shared/i18n";',
    'const t = (key: string) => key;',
  ),
  "modal-ui.ts",
);

for (const [name, browserType] of Object.entries({ chromium, firefox })) {
  test(`${name}: region selection follows the active modal lifecycle`, async () => {
    const browser = await browserType.launch({
      headless: true,
      executablePath: process.env[`${name.toUpperCase()}_TEST_EXECUTABLE`],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <button id="open">Open image</button>
        <section id="viewer">
          <dialog id="image"><button>Sample image</button></dialog>
        </section>
        <dialog id="other"><button>Another image</button></dialog>
        <dialog id="nonmodal" open>Sample text</dialog>
      `);
      await page.addScriptTag({
        type: "module",
        content: `${code}
          const host = document.createElement("ocr-translate-ui");
          const shadow = host.attachShadow({ mode: "open" });
          const html = document.createElement("html");
          const head = document.createElement("head");
          const style = document.createElement("style");
          style.textContent = ${JSON.stringify(css)};
          const container = document.createElement("body");
          head.append(style);
          html.append(head, container);
          shadow.append(html);
          let stop;
          window.dismissals = 0;
          window.activate = () => {
            stop?.();
            getUiAnchor().append(host);
            stop = watchUiModal(host, container, () => {
              window.dismissals++;
              cancelSelectionOverlay();
              releaseSelectionDim();
            });
            window.selection = "pending";
            startSelectionOverlay(container).then(result => window.selection = result);
          };
        `,
      });
      await page.waitForFunction(() => Boolean(window.activate));
      const activate = () => page.evaluate(() => window.activate());
      const parent = () => page.locator("ocr-translate-ui").evaluate(
        host => host.parentElement.id || host.parentElement.tagName,
      );
      const draw = async () => {
        const viewport = page.viewportSize();
        assert.deepEqual(await page.locator(".ocr-translate-selection-overlay").boundingBox(), {
          x: 0, y: 0, width: viewport.width, height: viewport.height,
        });
        await page.mouse.move(100, 100);
        await page.mouse.down();
        await page.mouse.move(400, 300, { steps: 5 });
        await page.mouse.up();
        assert.deepEqual(await page.locator(".ocr-translate-selection-rect").boundingBox(), {
          x: 100, y: 100, width: 300, height: 200,
        });
        assert.equal(await page.locator(".ocr-translate-selection-run").isVisible(), true);
        assert.equal(await page.locator(".ocr-translate-selection-run").evaluate(
          el => el.getRootNode().activeElement === el,
        ), true);
      };

      await activate();
      assert.equal(await parent(), "BODY");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => window.selection === null);

      await page.evaluate(() => document.querySelector("#image").showModal());
      await activate();
      assert.equal(await parent(), "image");
      await draw();
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => window.selection === null);
      assert.equal(await page.locator("#image").evaluate(el => el.matches(":modal")), true);
      await page.locator("#image button").evaluate(button => {
        button.addEventListener("click", () => button.dataset.clicked = "true");
      });
      await page.locator("#image button").click();
      assert.equal(await page.locator("#image button").getAttribute("data-clicked"), "true");

      for (const containingBlock of [
        "transform: translate(40px, 30px) scale(0.8) rotate(5deg)",
        "filter: blur(0px)",
        "contain: paint",
        "will-change: transform",
      ]) {
        await page.locator("#image").evaluate((dialog, css) => {
          dialog.style.cssText = `margin:0; padding:0; border:0; left:200px; top:150px;
            width:450px; height:300px; overflow:hidden; ${css}`;
        }, containingBlock);
        await activate();
        await draw();
        await page.locator(".ocr-translate-selection-run").click();
        await page.waitForFunction(() => window.selection !== "pending");
        assert.deepEqual(await page.evaluate(() => window.selection), {
          x: 100, y: 100, width: 300, height: 200,
        });
      }
      await page.locator("#image").evaluate(dialog => dialog.removeAttribute("style"));

      await activate();
      await draw();
      await page.evaluate(() => document.querySelector("#image").close());
      await page.waitForFunction(() => window.selection === null && window.dismissals === 1);
      assert.equal(await page.locator("ocr-translate-ui").count(), 0);

      await activate();
      assert.equal(await parent(), "BODY");
      await draw();
      await page.keyboard.press("Escape");

      await page.evaluate(() => {
        const dialog = document.createElement("dialog");
        dialog.id = "replacement";
        document.body.append(dialog);
        dialog.showModal();
      });
      await activate();
      await draw();
      await page.evaluate(() => document.querySelector("#replacement").replaceChildren());
      await page.waitForFunction(() => window.selection === null && window.dismissals === 2);
      assert.equal(await page.locator("ocr-translate-ui").count(), 0);
      assert.equal(await page.locator("#replacement").evaluate(el => el.matches(":modal")), true);

      await activate();
      assert.equal(await parent(), "replacement");
      await draw();
      await page.evaluate(() => document.body.append(document.querySelector("ocr-translate-ui")));
      await page.waitForFunction(() => window.selection === null && window.dismissals === 3);
      assert.equal(await page.locator("ocr-translate-ui").count(), 0);
      await page.evaluate(() => document.querySelector("#replacement").close());
      await activate();
      assert.equal(await parent(), "BODY");
      await draw();
      await page.keyboard.press("Escape");

      // Open in reverse DOM order to exercise focused-modal selection.
      await page.evaluate(() => {
        document.querySelector("#other").showModal();
        document.querySelector("#image").showModal();
      });
      await activate();
      assert.equal(await parent(), "image");
      await draw();
      await page.evaluate(() => document.querySelector("#viewer").remove());
      await page.waitForFunction(() => window.selection === null && window.dismissals === 4);
      assert.equal(await page.locator("ocr-translate-ui").count(), 0);

      await activate();
      assert.equal(await parent(), "other");
      await draw();
      await page.locator(".ocr-translate-selection-run").click();
      await page.waitForFunction(() => window.selection !== "pending");
      assert.deepEqual(await page.evaluate(() => window.selection), {
        x: 100, y: 100, width: 300, height: 200,
      });
      assert.equal(await page.locator(".ocr-translate-selection-overlay.is-capturing").count(), 1);
      await page.evaluate(() => document.querySelector("#other").removeAttribute("open"));
      await page.waitForFunction(() => window.dismissals === 5);
      assert.equal(await page.locator("ocr-translate-ui").count(), 0);
      // Removing `open` alone leaves the page inert in both browsers.
      await page.evaluate(() => document.querySelector("#other").remove());
      await activate();
      assert.equal(await parent(), "BODY");
      await draw();
    } finally {
      await browser.close();
    }
  });
}
