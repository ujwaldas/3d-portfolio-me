import { profile } from "../data/portfolio";

export default function Footer() {
  return (
    <footer className="border-t border-white/[0.06] py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-lg font-bold tracking-tight text-white">{profile.initials}</p>
          <p className="mt-1 text-sm text-slate-300">{profile.name}</p>
          <p className="text-xs text-slate-500">{profile.role}</p>
        </div>
        <nav className="flex gap-6 text-sm text-slate-400">
          <a href={profile.github} target="_blank" rel="noreferrer" className="hover:text-white">
            GitHub
          </a>
          <a href={profile.linkedin} target="_blank" rel="noreferrer" className="hover:text-white">
            LinkedIn
          </a>
          <a href={`mailto:${profile.email}`} className="hover:text-white">
            Email
          </a>
        </nav>
        <p className="mono text-xs text-slate-500">© 2026 {profile.name}</p>
      </div>
    </footer>
  );
}
