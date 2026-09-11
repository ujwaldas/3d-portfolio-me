import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export type LayoutMode = "mobile" | "tablet" | "desktop";

/** Breakpoints used by both the DOM layout and the 3D scene layout. */
export function useLayoutMode(): LayoutMode {
  const desktop = useMediaQuery("(min-width: 1024px)");
  const tablet = useMediaQuery("(min-width: 768px)");
  return desktop ? "desktop" : tablet ? "tablet" : "mobile";
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

export function useCoarsePointer(): boolean {
  return useMediaQuery("(pointer: coarse)");
}
