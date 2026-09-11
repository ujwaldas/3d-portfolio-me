import { highlights } from "../data/portfolio";
import { Reveal, Section, Star } from "./ui";

export default function Highlights() {
  return (
    <Section id="highlights" eyebrow="Engineering highlights" title="Real numbers from production systems.">
      <div className="grid gap-px overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-3">
        {highlights.map((h, i) => (
          <Reveal key={h.label} delay={i * 0.06} className="bg-[#070a12] p-7 md:p-8">
            <div className="flex items-center gap-2">
              <Star className="h-2.5 w-2.5" />
              <span className="mono text-[10px] uppercase tracking-[0.3em] text-slate-500">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <p className="mt-5 text-3xl font-semibold tracking-tight text-white md:text-4xl">{h.value}</p>
            <p className="mt-2 text-sm text-slate-300">{h.label}</p>
            <p className="mono mt-1 text-xs text-sky-300/80">{h.sub}</p>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
