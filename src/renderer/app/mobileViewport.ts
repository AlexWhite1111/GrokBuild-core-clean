import { useEffect, useState } from "react";

const MOBILE_LAYOUT_MAX_WIDTH = 760;
const MOBILE_COARSE_MAX_WIDTH = 900;

interface MobileViewportMetrics {
  height: number;
  offsetTop: number;
  keyboardOpen: boolean;
}

function calculateMobileViewport(layoutHeight: number, visualHeight: number, offsetTop: number, editableFocused: boolean): MobileViewportMetrics {
  const height = Math.max(1, Math.round(visualHeight || layoutHeight));
  const top = Math.max(0, Math.round(offsetTop || 0));
  const keyboardInset = Math.max(0, Math.round(layoutHeight - height));
  return { height, offsetTop: top, keyboardOpen: editableFocused && keyboardInset > 80 };
}

function hasEditableFocus(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (active.isContentEditable || active instanceof HTMLTextAreaElement) return true;
  if (!(active instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(active.type);
}

export function useMobileViewport(): void {
  useEffect(() => {
    let frame = 0;
    const viewport = window.visualViewport;
    let landscape = window.innerWidth > window.innerHeight;
    let layoutHeight = window.innerHeight;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nextLandscape = window.innerWidth > window.innerHeight;
        const editableFocused = hasEditableFocus();
        if (nextLandscape !== landscape || !editableFocused) {
          landscape = nextLandscape;
          layoutHeight = window.innerHeight;
        } else {
          layoutHeight = Math.max(layoutHeight, window.innerHeight);
        }
        const metrics = calculateMobileViewport(layoutHeight, viewport?.height || window.innerHeight, viewport?.offsetTop || 0, editableFocused);
        const root = document.documentElement;
        root.style.setProperty("--app-viewport-height", `${metrics.height}px`);
        root.style.setProperty("--app-viewport-top", `${metrics.offsetTop}px`);
        root.dataset.keyboardOpen = metrics.keyboardOpen ? "true" : "false";
      });
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      delete document.documentElement.dataset.keyboardOpen;
    };
  }, []);
}

export function useMobileLayout(maxWidth = MOBILE_LAYOUT_MAX_WIDTH): boolean {
  const query = `(max-width: ${maxWidth}px), (pointer: coarse) and (max-width: ${MOBILE_COARSE_MAX_WIDTH}px)`;
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}
