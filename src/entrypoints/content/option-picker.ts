import { CHEVRON_ICON } from "./icons";

let nextPickerId = 0;

export function createOptionPicker(config: {
  options: ReadonlyArray<{ id: string; label: string }>;
  currentId: string | undefined;
  title: (current: { id: string; label: string }) => string;
  onSelect: (id: string) => void;
  overlay?: boolean;
}): { element: HTMLElement; dispose: () => void } | undefined {
  if (config.options.length < 2) {
    return undefined;
  }

  const current =
    config.options.find((option) => option.id === config.currentId) ??
    config.options[0];
  const wrapper = document.createElement("div");
  wrapper.className = "ocr-translate-popup-langpill";
  if (config.overlay) {
    wrapper.classList.add("ocr-translate-overlay-provider");
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "ocr-translate-popup-langpill-button";
  if (config.overlay) {
    button.classList.add("ocr-translate-overlay-provider-button");
  }
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  button.title = config.title(current);
  button.setAttribute("aria-label", button.title);

  const label = document.createElement("span");
  if (config.overlay) {
    label.className = "ocr-translate-overlay-provider-label";
  }
  label.textContent = current.label;

  const chevron = document.createElement("span");
  chevron.className = "ocr-translate-popup-langpill-chevron";
  chevron.innerHTML = CHEVRON_ICON;
  button.append(label, chevron);

  const list = document.createElement("div");
  list.className = "ocr-translate-popup-langpill-list";
  list.setAttribute("role", "listbox");
  list.id = `ocr-options-${nextPickerId++}`;
  list.setAttribute("aria-label", button.title);
  button.setAttribute("aria-controls", list.id);
  list.hidden = true;

  const closeList = (): void => {
    list.hidden = true;
    wrapper.classList.remove("is-open-above");
    button.setAttribute("aria-expanded", "false");
  };

  const itemsBox = document.createElement("div");
  itemsBox.className = "ocr-translate-popup-langpill-items";
  const items: HTMLButtonElement[] = [];
  let activeItem: HTMLButtonElement | undefined;

  const setActive = (item: HTMLButtonElement | undefined): void => {
    activeItem?.classList.remove("is-active");
    activeItem = item;
    activeItem?.classList.add("is-active");
    activeItem?.scrollIntoView({ block: "nearest" });
  };

  for (const option of config.options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ocr-translate-popup-langpill-item";
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(option.id === current.id));
    item.textContent = option.label;
    if (option.id === current.id) {
      item.setAttribute("aria-selected", "true");
      item.classList.add("is-selected");
    }
    item.addEventListener("click", () => {
      closeList();
      button.focus();
      if (option.id !== current.id) {
        config.onSelect(option.id);
      }
    });
    itemsBox.append(item);
    items.push(item);
    item.addEventListener("focus", () => setActive(item));
  }
  list.append(itemsBox);

  const openList = (): void => {
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    wrapper.classList.remove("is-open-above");
    if (
      config.overlay &&
      list.getBoundingClientRect().bottom > window.innerHeight - 8
    ) {
      wrapper.classList.add("is-open-above");
    }
    setActive(items.find((item) => item.classList.contains("is-selected")));
    activeItem?.focus();
  };

  button.addEventListener("click", () => {
    if (list.hidden) openList();
    else closeList();
  });

  wrapper.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (list.hidden) {
        openList();
        return;
      }
      const index = items.findIndex((item) => item === activeItem);
      const next = Math.max(
        0,
        Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
      );
      setActive(items[next]);
      activeItem?.focus();
    } else if (!list.hidden && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeList();
      button.focus();
    }
  });

  const handleOutsideClick = (event: MouseEvent): void => {
    if (!list.hidden && !event.composedPath().includes(wrapper)) {
      closeList();
    }
  };
  document.addEventListener("click", handleOutsideClick);

  wrapper.append(button, list);
  return {
    element: wrapper,
    dispose: () => document.removeEventListener("click", handleOutsideClick),
  };
}
