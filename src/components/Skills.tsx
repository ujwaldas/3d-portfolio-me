import { focus, otherTech, skillGraph } from "../data/portfolio";
import ConstellationGraph from "./ConstellationGraph";
import { Chip, Reveal, Section } from "./ui";

export default function Skills() {
  return (
    <>
      <Section id="skills" eyebrow="Skills" title="A constellation, not a list of percentages.">
        <div className="grid items-center gap-10 lg:grid-cols-12">
          <Reveal className="lg:col-span-7">
            <div className="relative">
              <div className="pointer-events-none absolute inset-8 rounded-full bg-sky-500/[0.07] blur-3xl" />
              <ConstellationGraph nodes={skillGraph.nodes} edges={skillGraph.edges} center={skillGraph.center} />
              <p className="mono mt-2 text-center text-[10px] uppercase tracking-[0.3em] text-slate-500">
                Hover or tap a node to see its connections
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.1} className="lg:col-span-5">
            <h3 className="text-lg font-semibold text-white">Also worked with</h3>
            <p className="mt-2 text-sm text-slate-400">
              Tools and technologies I've used in production alongside the core stack.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {otherTech.map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
          </Reveal>
        </div>
      </Section>

      <Section id="focus" eyebrow="Engineering focus" title="Currently going deeper into" className="pt-0 md:pt-0">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {focus.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.05}>
              <div className="h-full rounded-xl border border-white/[0.07] bg-white/[0.02] p-5">
                <p className="text-sm font-semibold text-sky-200">{f.title}</p>
                <ul className="mt-3 space-y-1.5">
                  {f.items.map((it) => (
                    <li key={it} className="text-sm text-slate-300/90">
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>
    </>
  );
}
