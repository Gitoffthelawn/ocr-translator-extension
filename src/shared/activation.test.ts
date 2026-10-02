import { describe, expect, it, vi } from "vitest";
import {
  isActivationPageSupported,
  isContentScriptUnavailableError,
  isTabActivatable,
} from "./activation";

describe("activation page support", () => {
  it("allows regular web pages", () => {
    expect(isActivationPageSupported("https://example.com/")).toBe(true);
    expect(isActivationPageSupported("http://localhost:3000/")).toBe(true);
  });

  it("blocks browser and extension pages", () => {
    expect(isActivationPageSupported("about:addons")).toBe(false);
    expect(isActivationPageSupported("about:preferences")).toBe(false);
    expect(isActivationPageSupported("moz-extension://example/options.html")).toBe(
      false,
    );
    expect(isActivationPageSupported("chrome://extensions")).toBe(false);
  });

  it("blocks tabs whose URL is unavailable", () => {
    expect(isActivationPageSupported(undefined)).toBe(false);
  });

  it("blocks the Chrome Web Store, which hides content scripts", () => {
    expect(
      isActivationPageSupported(
        "https://chromewebstore.google.com/detail/abcdefghijklmnopabcdefghijklmnop",
      ),
    ).toBe(false);
  });

  it("keeps other hosts on regular web pages", () => {
    expect(
      isActivationPageSupported("https://example.com/item/example"),
    ).toBe(true);
  });

  it("lets malformed URLs fall through to messaging", () => {
    expect(isActivationPageSupported("not a url")).toBe(true);
  });
});

describe("tab activation check", () => {
  const unusedPing = vi.fn(() => Promise.reject(new Error("unexpected ping")));

  it("rejects tabs without an id", async () => {
    expect(await isTabActivatable(undefined, unusedPing)).toBe(false);
    expect(await isTabActivatable({ url: "https://example.com/" }, unusedPing)).toBe(
      false,
    );
  });

  it("decides from the URL when it is visible", async () => {
    expect(
      await isTabActivatable({ id: 1, url: "https://example.com/" }, unusedPing),
    ).toBe(true);
    expect(
      await isTabActivatable({ id: 1, url: "chrome://extensions" }, unusedPing),
    ).toBe(false);
    expect(unusedPing).not.toHaveBeenCalled();
  });

  it("pings the top frame when the URL is hidden", async () => {
    const ping = vi.fn(() => Promise.resolve(true));

    expect(await isTabActivatable({ id: 7 }, ping)).toBe(true);
    expect(ping).toHaveBeenCalledWith(7, { type: "PING" }, { frameId: 0 });
  });

  it("rejects hidden URLs where no content script answers", async () => {
    const missing = vi.fn(() =>
      Promise.reject(
        new Error("Could not establish connection. Receiving end does not exist."),
      ),
    );

    expect(await isTabActivatable({ id: 7 }, missing)).toBe(false);
    expect(
      await isTabActivatable({ id: 7 }, () => Promise.resolve(undefined)),
    ).toBe(false);
  });
});

describe("content script availability errors", () => {
  it("recognizes missing receiver failures from tabs.sendMessage", () => {
    expect(
      isContentScriptUnavailableError(
        new Error("Could not establish connection. Receiving end does not exist."),
      ),
    ).toBe(true);
  });

  it("does not classify unrelated errors as page support failures", () => {
    expect(isContentScriptUnavailableError(new Error("Unexpected failure"))).toBe(
      false,
    );
  });
});
