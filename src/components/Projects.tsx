import { motion } from "framer-motion";
import { ArrowDown, ArrowRight } from "lucide-react";
import { Fragment } from "react";
import { projects, type Project } from "../data/portfolio";
import { Chip, Glass, Reveal, Section } from "./ui";

export default function Projects() {
  return (
    <Section id="projects" eyebrow="Projects" title="Systems I've owned pieces of.">
      <div className="grid gap-6 lg:grid-cols-2">
        {projects.map((p, i) => (
          <Reveal key={p.name} delay={i * 0.08}>
            <ProjectCard project={p} />
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

function ProjectCard({ project: p }: { project: Project }) {
  return (
    <Glass className="flex h-full flex-col p-7 md:p-8">
      <p className="mono text-[11px] uppercase tracking-[0.3em] text-sky-300/80">{p.kind}</p>
      <h3 className="mt-2 text-3xl font-semibold tracking-tight text-white">{p.name}</h3>
      <p className="mt-4 text-slate-300/90">{p.description}</p>

      <div className="mt-6 rounded-xl border border-white/[0.07] bg-[#04060c]/70 p-5">
        <p className="mono mb-4 text-[10px] uppercase tracking-[0.3em] text-slate-500">Highlight · {p.highlight}</p>
        {p.flow && <Flow steps={p.flow} />}
        {p.domains && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {p.domains.map((d) => (
              <div key={d} className="rounded-lg border border-sky-300/15 bg-sky-400/[0.04] px-3 py-2 text-center text-xs font-medium text-sky-100">
                {d}
              </div>
            ))}
          </div>
        )}
      </div>

      {p.metric && <Metric before={p.metric.before} after={p.metric.after} label={p.metric.label} />}

      <ul className="mt-6 space-y-2">
        {p.points.map((pt) => (
          <li key={pt} className="flex gap-3 text-sm leading-relaxed text-slate-300/90">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-sky-300/70" />
            {pt}
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-wrap gap-2 pt-6">
        {p.stack.map((s) => (
          <Chip key={s}>{s}</Chip>
        ))}
      </div>
    </Glass>
  );
}

function Flow({ steps }: { steps: string[] }) {
  return (
    <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center">
      {steps.map((s, i) => (
        <Fragment key={s}>
          <div className="flex-1 rounded-lg border border-sky-300/20 bg-sky-400/[0.06] px-3 py-2 text-center text-xs font-medium text-sky-100">
            {s}
          </div>
          {i < steps.length - 1 && (
            <span className="flex justify-center text-sky-300/60">
              <ArrowDown className="h-3.5 w-3.5 sm:hidden" />
              <ArrowRight className="hidden h-3.5 w-3.5 sm:block" />
            </span>
          )}
        </Fragment>
      ))}
    </div>
  );
}

function Metric({ before, after, label }: { before: string; after: string; label: string }) {
  return (
    <div className="mt-4 rounded-xl border border-white/[0.07] bg-[#04060c]/70 p-5">
      <div className="flex items-baseline justify-between">
        <p className="mono text-[10px] uppercase tracking-[0.3em] text-slate-500">{label}</p>
        <p className="text-sm font-semibold text-white">
          {before} <span className="text-sky-300">→</span> {after}
        </p>
      </div>
      <div className="mt-3 space-y-2">
        <Bar width="100%" label={`before · ${before}`} dim />
        <Bar width="15%" label={`after · ${after}`} />
      </div>
    </div>
  );
}

function Bar({ width, label, dim }: { width: string; label: string; dim?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
        <motion.div
          initial={{ width: 0 }}
          whileInView={{ width }}
          viewport={{ once: true }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          className={dim ? "h-full rounded-full bg-slate-500/70" : "h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-300"}
        />
      </div>
      <span className="mono w-28 text-right text-[10px] text-slate-400">{label}</span>
    </div>
  );
}
