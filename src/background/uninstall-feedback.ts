import { browser } from "wxt/browser";

const FEEDBACK_FORM_URL = "https://tally.so/r/Pd7g0B";

export type UninstallFeedbackRuntime = {
  setUninstallURL: (url: string) => Promise<void>;
};

export function startUninstallFeedback(
  runtime: UninstallFeedbackRuntime = browser.runtime,
): void {
  void runtime
    .setUninstallURL(FEEDBACK_FORM_URL)
    .catch((error) =>
      console.error(
        "[Screen OCR Translator] Failed to set uninstall feedback URL",
        error,
      ),
    );
}
