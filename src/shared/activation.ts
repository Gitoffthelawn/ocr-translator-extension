const UNSUPPORTED_ACTIVATION_PROTOCOLS = new Set([
  "about:",
  "chrome:",
  "chrome-extension:",
  "devtools:",
  "edge:",
  "moz-extension:",
  "opera:",
  "resource:",
  "view-source:",
]);

const UNSUPPORTED_ACTIVATION_HOSTS = new Set([
  "chromewebstore.google.com",
  "addons.mozilla.org",
]);

export function isActivationPageSupported(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }

  return (
    !UNSUPPORTED_ACTIVATION_PROTOCOLS.has(parsed.protocol) &&
    !UNSUPPORTED_ACTIVATION_HOSTS.has(parsed.hostname)
  );
}

export type ActivationTab = { id?: number; url?: string };

export type PingTab = (
  tabId: number,
  message: { type: "PING" },
  options: { frameId: number },
) => Promise<unknown>;

/** Without the tabs permission, the URL is hidden on schemes outside the host
 * permissions (blob:, filesystem:, chrome:). The content script may still run
 * on some of them, so ask it directly. */
export async function isTabActivatable(
  tab: ActivationTab | undefined,
  ping: PingTab,
): Promise<boolean> {
  if (typeof tab?.id !== "number") {
    return false;
  }
  if (tab.url) {
    return isActivationPageSupported(tab.url);
  }
  try {
    return (await ping(tab.id, { type: "PING" }, { frameId: 0 })) === true;
  } catch {
    return false;
  }
}

export function isContentScriptUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return /could not establish connection|receiving end does not exist|no receiver|cannot access|cannot be scripted|missing host permission/i.test(
    message,
  );
}
