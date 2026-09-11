import { Mail } from "lucide-react";
import { profile } from "../data/portfolio";
import { GithubIcon, LinkedinIcon } from "./Icons";
import { Reveal } from "./ui";

export default function Contact() {
  return (
    <section id="contact" className="relative scroll-mt-24 overflow-hidden py-24 md:py-36">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_100%,rgba(56,120,220,0.18),transparent_60%)]" />
      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <Reveal>
          <p className="mono mb-4 text-[11px] uppercase tracking-[0.35em] text-sky-300/80">Contact</p>
          <h2 className="text-4xl font-semibold tracking-tight text-white md:text-6xl">Let's build something useful.</h2>
          <a href={`mailto:${profile.email}`} className="mt-6 inline-block text-lg text-slate-300 underline-offset-4 hover:text-white hover:underline md:text-xl">
            {profile.email}
          </a>
        </Reveal>
        <Reveal delay={0.1} className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a
            href={`mailto:${profile.email}`}
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-100"
          >
            <Mail className="h-4 w-4" /> Email
          </a>
          <a
            href={profile.github}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-slate-200 transition hover:border-sky-300/40 hover:text-white"
          >
            <GithubIcon /> GitHub
          </a>
          <a
            href={profile.linkedin}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-slate-200 transition hover:border-sky-300/40 hover:text-white"
          >
            <LinkedinIcon /> LinkedIn
          </a>
        </Reveal>
      </div>
    </section>
  );
}
