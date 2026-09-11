import { motion, useScroll, useTransform } from "framer-motion";
import { useRef, useState } from "react";
import { photos, profile } from "../data/portfolio";
import { cn } from "../utils/cn";

/**
 * Secondary personal photos with subtle parallax.
 * Images that fail to load (e.g. not yet added to public/images) are hidden,
 * and the whole section disappears when none are available.
 */
export default function PhotoStrip() {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y1 = useTransform(scrollYProgress, [0, 1], [40, -40]);
  const y2 = useTransform(scrollYProgress, [0, 1], [80, -60]);
  const y3 = useTransform(scrollYProgress, [0, 1], [20, -90]);

  const visible = photos.filter((p) => !failed[p.src]);
  if (!visible.length) return null;
  const [lead, ...rest] = visible;
  const offsets = [y2, y3, y1];

  return (
    <section ref={ref} className="relative py-16 md:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-8 px-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <p className="mono mb-3 text-[11px] uppercase tracking-[0.35em] text-sky-300/80">Off the terminal</p>
          <h2 className="text-3xl font-semibold tracking-tight text-white">{profile.name.split(" ")[0]}, in person.</h2>
          <p className="mt-4 text-slate-400">Based in {profile.location}.</p>
        </div>
        <div className="relative lg:col-span-8">
          <motion.figure style={{ y: y1 }} className="relative ml-auto w-[78%] overflow-hidden rounded-2xl border border-white/10 sm:w-[64%]">
            <img
              src={lead.src}
              alt={lead.alt}
              loading="lazy"
              onError={() => setFailed((f) => ({ ...f, [lead.src]: true }))}
              className="aspect-[4/5] w-full object-cover"
            />
          </motion.figure>
          {rest.slice(0, 3).map((p, i) => (
            <motion.figure
              key={p.src}
              style={{ y: offsets[i] }}
              className={cn(
                "absolute w-[34%] overflow-hidden rounded-xl border border-white/10 shadow-2xl shadow-black/60 sm:w-[26%]",
                i === 0 && "left-0 top-6",
                i === 1 && "left-[10%] bottom-0 sm:left-[22%]",
                i === 2 && "right-0 -bottom-6 hidden sm:block",
              )}
            >
              <img
                src={p.src}
                alt={p.alt}
                loading="lazy"
                onError={() => setFailed((f) => ({ ...f, [p.src]: true }))}
                className="aspect-[3/4] w-full object-cover"
              />
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  );
}
