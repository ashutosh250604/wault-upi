import { useCallback, useEffect, useRef, useState } from "react";

const TRIGGER_DISTANCE = 64;
const MAX_DISTANCE = 96;
/** Movement below this is treated as a scroll, not a pull. */
const DEAD_ZONE = 6;
/**
 * How long the indicator stays up once a refresh starts, at minimum. On a warm
 * local server the request resolves in tens of milliseconds, and a spinner that
 * flashes for two frames reads as a glitch rather than as work being done.
 */
const MIN_VISIBLE_MS = 450;

export interface PullToRefresh {
  /** Attach to the scrolling element. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** Current pull distance in px (0 when idle). */
  distance: number;
  refreshing: boolean;
  /** 0 → 1 progress toward the trigger distance. */
  progress: number;
}

/**
 * Touch pull-to-refresh for a scroll container. Only engages when the
 * container is already scrolled to the top, so it never fights normal
 * scrolling, and it's inert on devices without touch.
 */
export function usePullToRefresh(
  onRefresh: () => Promise<void> | void,
  enabled = true,
): PullToRefresh {
  const ref = useRef<HTMLDivElement | null>(null);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startY = useRef<number | null>(null);
  const pulling = useRef(false);
  // Mirrored so the touchend handler reads the latest distance, not a stale render's.
  const distanceRef = useRef(0);
  distanceRef.current = distance;
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  const finish = useCallback(async () => {
    setRefreshing(true);
    setDistance(TRIGGER_DISTANCE);
    try {
      await Promise.all([
        refreshRef.current(),
        new Promise((resolve) => window.setTimeout(resolve, MIN_VISIBLE_MS)),
      ]);
    } finally {
      setRefreshing(false);
      setDistance(0);
    }
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    const onTouchStart = (event: TouchEvent) => {
      if (element.scrollTop > 0 || refreshing) {
        startY.current = null;
        return;
      }
      startY.current = event.touches[0]?.clientY ?? null;
      pulling.current = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (startY.current === null) return;
      const delta = (event.touches[0]?.clientY ?? 0) - startY.current;

      if (delta <= DEAD_ZONE) {
        if (pulling.current) {
          pulling.current = false;
          setDistance(0);
        }
        return;
      }
      // Resist the pull so it feels elastic rather than 1:1.
      const resisted = Math.min(MAX_DISTANCE, (delta - DEAD_ZONE) * 0.55);
      if (resisted > 0) {
        pulling.current = true;
        setDistance(resisted);
        // Keep the browser from scrolling the page while we own the gesture.
        if (event.cancelable) event.preventDefault();
      }
    };

    const onTouchEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      if (!pulling.current) return;
      pulling.current = false;
      if (distanceRef.current >= TRIGGER_DISTANCE) void finish();
      else setDistance(0);
    };

    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    element.addEventListener("touchend", onTouchEnd);
    element.addEventListener("touchcancel", onTouchEnd);
    return () => {
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", onTouchEnd);
      element.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [enabled, finish, refreshing]);

  return {
    ref,
    distance,
    refreshing,
    progress: Math.min(1, distance / TRIGGER_DISTANCE),
  };
}
