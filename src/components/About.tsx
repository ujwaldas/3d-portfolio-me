import { GraduationCap, Languages, MapPin } from "lucide-react";
import { about, education, languages, profile } from "../data/portfolio";
import ConstellationGraph from "./ConstellationGraph";
import { Reveal, Section } from "./ui";

export default function About() {
  return (
    <Section id="about" eyebrow="About">
      <div className="grid items-center gap-12 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Reveal>
            <h2 className="max-w-2xl text-3xl font-semibold leading-tight tracking-tight text-white md:text-5xl">
              {about.heading}
            </h2>
          </Reveal>
          <div className="mt-8 max-w-2xl space-y-5 text-base leading-relaxed text-slate-300/90 md:text-lg">
            {about.paragraphs.map((p, i) => (
              <Reveal key={i} delay={0.1 + i * 0.08}>
                <p>{p}</p>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.25} className="mt-10 grid gap-4 sm:grid-cols-3">
            <Fact icon={<MapPin className="h-4 w-4" />} label="Based in" value={profile.location} />
            <Fact
              icon={<GraduationCap className="h-4 w-4" />}
              label="Education"
              value={`${education.degree}, ${education.field}`}
              sub={`${education.school} · ${education.period}`}
            />
            <Fact icon={<Languages className="h-4 w-4" />} label="Languages" value={languages.join(" · ")} />
          </Reveal>
        </div>

        <Reveal delay={0.15} className="lg:col-span-5">
          <div className="relative mx-auto max-w-md lg:max-w-none">
            <div className="pointer-events-none absolute inset-0 rounded-full bg-sky-500/10 blur-3xl" />
            <ConstellationGraph nodes={about.techNodes} width={480} height={440} radius={150} fontSize={16} />
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

function Fact({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="mono mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-sky-300/80">
        {icon} {label}
      </div>
      <p className="text-sm font-medium text-slate-100">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
