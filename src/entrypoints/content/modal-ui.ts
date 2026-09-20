export function getUiAnchor(): HTMLElement {
  const focusedModal = document.activeElement?.closest<HTMLDialogElement>(
    "dialog[open]:modal",
  );
  return focusedModal ?? Array.from(
    document.querySelectorAll<HTMLDialogElement>("dialog[open]:modal"),
  ).at(-1) ?? document.body;
}

export function watchUiModal(
  host: HTMLElement,
  container: HTMLElement,
  onClose: () => void,
): () => void {
  const modal = host.parentElement;
  if (!(modal instanceof HTMLDialogElement) || !modal.matches(":modal")) {
    return () => {};
  }

  // Stay inside the modal for input, but escape its containing block for layout.
  container.classList.add("ocr-translate-modal-surface");
  container.popover = "manual";
  container.showPopover();

  const observer = new MutationObserver(() => {
    if (!modal.isConnected || !modal.open || host.parentElement !== modal) {
      dismiss();
    }
  });
  function stop(): void {
    observer.disconnect();
    modal?.removeEventListener("close", dismiss);
    if (container.matches(":popover-open")) {
      container.hidePopover();
    }
    container.removeAttribute("popover");
    container.classList.remove("ocr-translate-modal-surface");
  }
  function dismiss(): void {
    stop();
    onClose();
    host.remove();
  }

  modal.addEventListener("close", dismiss);
  observer.observe(modal, { attributes: true, attributeFilter: ["open"] });
  // Removing a dialog (or its ancestor) does not fire its close event.
  observer.observe(document, { childList: true, subtree: true });
  return stop;
}
