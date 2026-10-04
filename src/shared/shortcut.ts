import { browser } from "wxt/browser";
import { START_SELECTION_COMMAND } from "./commands";

export async function getStartSelectionShortcut(): Promise<string | undefined> {
  const commands = await browser.commands.getAll();
  const shortcut = commands.find(
    ({ name }) => name === START_SELECTION_COMMAND,
  )?.shortcut;
  return shortcut
    ? shortcut
        .split("+")
        .map((key) => key.trim())
        .join(" + ")
    : undefined;
}

export async function openShortcutSettings(): Promise<void> {
  const commands = browser.commands as typeof browser.commands & {
    openShortcutSettings?: () => Promise<void>;
  };
  if (commands.openShortcutSettings) {
    await commands.openShortcutSettings();
    return;
  }
  const openedTab = browser.tabs.create?.({
    url: "chrome://extensions/shortcuts",
  });
  if (!openedTab) {
    throw new Error("Shortcut settings are unavailable");
  }
  await openedTab;
}
