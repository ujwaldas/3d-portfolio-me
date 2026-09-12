import { motion, useMotionValueEvent, useScroll, useTransform } from "framer-motion";
import { ArrowDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { profile } from "../data/portfolio";
import { useCoarsePointer, useLayoutMode, usePrefersReducedMotion } from "../hooks/useMedia";
import ParticlePortrait from "../three/ParticlePortrait";

function HeroPortraitFallback() {
  return (
    <div className="pointer-events-none flex h-full w-full items-center justify-center">
      <div className="relative mx-auto w-full max-w-[320px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a1220]/40 shadow-[0_0_80px_rgba(56,120,220,0.12)]">
        <img
          src={profile.heroImage}
          alt="Ujwal Das H S - Backend Software Engineer"
          className="mx-auto block aspect-square w-full max-w-[320px] rounded-2xl object-cover opacity-90"
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(56,120,220,0.18),transparent_65%)]" />
      </div>
    </div>
  );
}

/**
 * Hero = a 300vh scroll track with a sticky 100vh stage.
 * scrollYProgress (0→1 across the track) drives:
 *   - the 3D rig (rotation / camera dolly / dissolve) via progressRef (no React re-renders)
 *   - the DOM text (opacity / y) via framer-motion transforms
 */
export default function Hero() {
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  const mode = useLayoutMode();
  const reducedPref = usePrefersReducedMotion();
  const coarse = useCoarsePointer();
  const touchLayout = coarse || mode === "mobile" || mode === "tablet";
  /* iOS Accessibility → Reduce Motion is commonly on and would skip the hero cinematic.
     Keep dust/scroll animation on touch; still honor reduced motion on desktop. */
  const reduced = reducedPref && !touchLayout;
  const [active, setActive] = useState(true);
  const [ready, setReady] = useState(false);
  const [introComplete, setIntroComplete] = useState(false);
  const [painted, setPainted] = useState(false);
  const hasRenderedFrame = useRef(false);

  const { scrollYProgress } = useScroll({ target: trackRef, offset: ["start start", "end end"] });

  useEffect(() => {
    progressRef.current = scrollYProgress.get();
  }, [scrollYProgress]);

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    progressRef.current = v;
  });

  /* iOS Safari: framer useScroll can skip during inertial scroll — mirror progress from geometry */
  useEffect(() => {
    const updateProgress = () => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const total = el.offsetHeight - vh;
      if (total > 0) {
        progressRef.current = Math.min(1, Math.max(0, -rect.top / total));
      }
    };
    updateProgress();
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.visualViewport?.addEventListener("scroll", updateProgress);
    window.visualViewport?.addEventListener("resize", updateProgress);
    return () => {
      window.removeEventListener("scroll", updateProgress);
      window.visualViewport?.removeEventListener("scroll", updateProgress);
      window.visualViewport?.removeEventListener("resize", updateProgress);
    };
  }, []);

  const textOpacity = useTransform(scrollYProgress, [0, 0.28, 0.58], [1, 1, 0]);
  const textY = useTransform(scrollYProgress, [0, 0.58], [0, -56]);
  const hintOpacity = useTransform(scrollYProgress, [0, 0.08], [1, 0]);

  /* Observe the scroll track — sticky stage stays visible for the whole 300vh hero. */
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setActive(e.isIntersecting), { rootMargin: "80px 0px", threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const canvasActive = active || !painted || !introComplete;
  const staticText = reduced;

  return (
    <div id="top" ref={trackRef} className={reduced ? "relative hero-stage" : "relative hero-track"}>
      <div ref={stageRef} className="hero-stage relative sticky top-0 overflow-hidden">
        {/* atmosphere */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_70%_35%,rgba(56,120,220,0.16),transparent_55%),radial-gradient(ellipse_at_20%_80%,rgba(30,64,175,0.12),transparent_55%)]" />

        <div className="hero-portrait-slot pointer-events-none absolute inset-0 z-0">
          <ParticlePortrait
            src={profile.heroImage}
            progressRef={progressRef}
            mode={mode}
            touchLayout={touchLayout}
            reducedMotion={reduced}
            mouseEnabled={!coarse && !reduced}
            active={canvasActive}
            quality={mode === "mobile" ? "low" : "auto"}
            onReady={() => setReady(true)}
            onIntroComplete={() => setIntroComplete(true)}
            onFirstFrame={() => {
              hasRenderedFrame.current = true;
              setPainted(true);
            }}
            className="hero-canvas-host"
            fallback={<HeroPortraitFallback />}
          />
        </div>

        {/* copy overlays the ambient portrait layer */}
        <motion.div
          style={staticText ? undefined : { opacity: textOpacity, y: textY }}
          className="pointer-events-none absolute inset-0 z-10"
        >
          <div className="hero-copy-pad mx-auto flex h-full max-w-7xl flex-col justify-end px-6 pb-24 md:justify-center md:pb-0 md:pt-0">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: ready || reduced ? 1 : 0, y: ready || reduced ? 0 : 30 }}
              transition={{ duration: 1.1, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-auto max-w-md md:max-w-sm lg:max-w-lg xl:max-w-xl"
            >
              <p className="mono mb-3 text-[11px] uppercase tracking-[0.42em] text-sky-300 md:text-xs">{profile.role}</p>
              <h1 className="text-[2.6rem] font-semibold leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl [@media(max-height:620px)]:text-4xl">
                {profile.name.toUpperCase()}
              </h1>
              <p className="mt-5 text-xl font-medium text-slate-100 sm:text-2xl lg:text-3xl [@media(max-height:620px)]:mt-2 [@media(max-height:620px)]:text-lg">
                {profile.tagline}
              </p>
              <p className="mono mt-4 text-xs text-slate-400 sm:text-sm [@media(max-height:620px)]:mt-2">{profile.stackLine.join("  •  ")}</p>

              <div className="mt-8 flex flex-wrap items-center gap-3 [@media(max-height:620px)]:mt-4">
                <a
                  href="#projects"
                  className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-100"
                >
                  Explore my work
                </a>
                <a
                  href="#contact"
                  className="rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-slate-200 backdrop-blur-sm transition hover:border-sky-300/40 hover:text-white"
                >
                  Contact me
                </a>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 [@media(max-height:620px)]:mt-4 [@media(max-height:520px)]:hidden">
                <span className="mono inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-slate-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  {profile.status}
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold text-white">{profile.years}</span>
                  <span className="text-xs text-slate-400">{profile.yearsLabel}</span>
                </span>
              </div>
            </motion.div>
          </div>
        </motion.div>

        {!reduced && (
          <motion.div
            style={{ opacity: hintOpacity }}
            className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex flex-col items-center gap-2 text-slate-500"
          >
            <span className="mono text-[10px] uppercase tracking-[0.4em]">Scroll</span>
            <motion.span animate={{ y: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}>
              <ArrowDown className="h-4 w-4" />
            </motion.span>
          </motion.div>
        )}

        {/* bottom fade into the page */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#05070d]" />
      </div>
    </div>
  );
}
