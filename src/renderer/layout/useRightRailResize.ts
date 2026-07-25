import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

const MIN_WIDTH = 280;
const MAX_WIDTH = 520;
const COLLAPSE_THRESHOLD = 140;

export function useRightRailResize(input: {
  width: number;
  onWidthChange: (value: number) => void;
  onClose: () => void;
}) {
  const [liveWidth, setLiveWidth] = useState(input.width);
  const widthRef = useRef(input.width);
  const collapseRef = useRef(false);

  useEffect(() => {
    setLiveWidth(input.width);
    widthRef.current = input.width;
  }, [input.width]);

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    const move = (pointer: PointerEvent) => {
      const raw = startWidth + startX - pointer.clientX;
      collapseRef.current = raw < COLLAPSE_THRESHOLD;
      widthRef.current = clampWidth(raw);
      setLiveWidth(widthRef.current);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      if (collapseRef.current) input.onClose();
      else input.onWidthChange(widthRef.current);
      collapseRef.current = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home"
      ? 320
      : event.key === "End"
        ? MAX_WIDTH
        : clampWidth(widthRef.current + (event.key === "ArrowLeft" ? 16 : -16));
    widthRef.current = next;
    setLiveWidth(next);
    input.onWidthChange(next);
  };

  return { liveWidth, beginResize, resizeWithKeyboard };
}

function clampWidth(value: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(value)));
}
