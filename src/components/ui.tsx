import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export function Section({
  id,
  eyebrow,
  title,
  children,
  className,
}: {
  id: string;
  eyebrow?: string;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("relative scroll-mt-24 py-20 md:py-28", className)}>
      <div className="mx-auto max-w-6xl px-6">
        {(eyebrow || title) && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="mb-10 md:mb-14"
          >
            {eyebrow && <p className="mono mb-3 text-[11px] uppercase tracking-[0.35em] text-sky-300/80">{eyebrow}</p>}
            {title && (
              <h2 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight text-white md:text-4xl">
                {title}
              </h2>
            )}
          </motion.div>
        )}
        {children}
      </div>
    </section>
  );
}

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "mono inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] tracking-wide text-slate-300",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Glass({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 backdrop-blur-sm transition-colors duration-300 hover:border-sky-300/20",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Star({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-3 w-3 text-sky-300", className)} fill="currentColor" aria-hidden>
      <path d="M12 0c.6 7 5 11.4 12 12-7 .6-11.4 5-12 12-.6-7-5-11.4-12-12 7-.6 11.4-5 12-12z" />
    </svg>
  );
}
