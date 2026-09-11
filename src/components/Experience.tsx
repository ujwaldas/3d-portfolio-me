import { experience } from "../data/portfolio";
import { Chip, Reveal, Section } from "./ui";

export default function Experience() {
  return (
    <Section id="experience" eyebrow="Experience" title="Production backend work, end to end.">
      <ol className="relative space-y-16 border-l border-white/[0.08] pl-8 md:pl-12">
        {experience.map((job, i) => (
          <li key={job.company} className="relative">
            <span className="absolute -left-[41px] top-1.5 flex h-4 w-4 items-center justify-center md:-left-[57px]">
              <span className="absolute h-4 w-4 rounded-full bg-sky-400/20 blur-[2px]" />
              <span className="relative h-2 w-2 rounded-full bg-sky-300" />
            </span>

            <Reveal delay={i * 0.05}>
              <div className="flex flex-col gap-2 md:flex-row md:items-baseline md:justify-between">
                <div>
                  <h3 className="text-2xl font-semibold text-white">{job.company}</h3>
                  <p className="text-slate-300">{job.role}</p>
                </div>
                <p className="mono text-xs uppercase tracking-[0.2em] text-slate-400">
                  {job.period} · {job.location}
                </p>
              </div>
              <p className="mt-4 max-w-3xl text-slate-300/90">{job.summary}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {job.stack.map((s) => (
                  <Chip key={s}>{s}</Chip>
                ))}
              </div>
            </Reveal>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {job.groups.map((g, gi) => (
                <Reveal key={g.title} delay={0.05 + gi * 0.04}>
                  <div className="h-full rounded-xl border border-white/[0.07] bg-white/[0.02] p-5">
                    <p className="text-sm font-semibold text-sky-200">{g.title}</p>
                    <ul className="mt-3 space-y-2">
                      {g.items.map((item) => (
                        <li key={item} className="flex gap-3 text-sm leading-relaxed text-slate-300/90">
                          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-sky-300/70" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
