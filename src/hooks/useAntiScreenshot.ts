import { useRef, useEffect, useCallback } from "react";

let styleInjected = false;

function injectGlobalStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .anti-screenshot * {
      -webkit-user-select: none !important;
      user-select: none !important;
    }
    .anti-screenshot img, .anti-screenshot canvas {
      -webkit-user-drag: none !important;
      user-drag: none !important;
      -webkit-touch-callout: none !important;
    }
  `;
  document.head.appendChild(style);
}

export function useAntiScreenshot<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    injectGlobalStyles();
  }, []);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
  }, []);

  const handleCopy = useCallback((e: ClipboardEvent) => {
    e.preventDefault();
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === "c" || e.key === "C" || e.key === "s" || e.key === "S" || e.key === "p" || e.key === "P" || e.key === "u" || e.key === "U")
    ) {
      e.preventDefault();
    }
    if (e.key === "PrintScreen" || e.key === "F12") {
      e.preventDefault();
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("contextmenu", handleContextMenu);
    el.addEventListener("copy", handleCopy);
    el.addEventListener("keydown", handleKeyDown);
    return () => {
      el.removeEventListener("contextmenu", handleContextMenu);
      el.removeEventListener("copy", handleCopy);
      el.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleContextMenu, handleCopy, handleKeyDown]);

  return ref;
}
