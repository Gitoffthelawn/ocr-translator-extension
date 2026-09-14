# AGENTS.md

## Extension architecture

Firefox: MV3 event page; OCR worker runs directly.
Chrome: MV3 service worker + offscreen document.

Content UI runs in a WXT shadow root; keep styles in `src/entrypoints/content/style.css`.

## Tests

Run browser tests outside the container sandbox. Otherwise they may fail to launch or hang.

Use generic, fictional text in test fixtures. Do not add real names, places, quoted dialogue, news excerpts, or text copied from screenshots or other source material; common greetings and neutral examples are fine.

## Localization

Use i18n helpers for user-facing text.

## OCR models

Read `src/public/assets/ocr/README.md` before replacing or re-converting packaged models.

## Commit attribution

If adding AI attribution, use an `Assisted-by:` trailer, not `Co-Authored-By:`.
Format: `Assisted-by: AGENT_NAME:MODEL_VERSION`, for example: `Assisted-by: Codex:gpt-5`.
