import { AnimatePresence, motion } from "framer-motion";
import { FileText, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { navLinks, profile } from "../data/portfolio";
import { cn } from "../utils/cn";
import { GithubIcon, LinkedinIcon } from "./Icons";

export default function Navbar() {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > window.innerHeight * 1.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-500",
        open || solid
          ? "border-b border-[#17314d]/70 bg-[#05070d] backdrop-blur-md"
          : "bg-transparent",
      )}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <a href="#top" className="text-lg font-bold tracking-tight text-white" onClick={() => setOpen(false)}>
          {profile.initials}
        </a>

        <ul className="hidden items-center gap-8 md:flex">
          {navLinks.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="text-sm text-slate-300/90 transition hover:text-white">
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-1 md:flex">
          <IconLink href={profile.github} label="GitHub">
            <GithubIcon />
          </IconLink>
          <IconLink href={profile.linkedin} label="LinkedIn">
            <LinkedinIcon />
          </IconLink>
          <a
            href={profile.resume}
            target="_blank"
            rel="noreferrer"
            className="ml-2 inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-1.5 text-xs font-medium text-slate-200 transition hover:border-sky-300/40 hover:text-white"
          >
            <FileText className="h-3.5 w-3.5" /> Resume
          </a>
        </div>

        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white md:hidden"
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-[200] flex flex-col bg-[#05070d] px-6 pb-8 pt-20 md:hidden"
              >
                <ul className="space-y-1">
                  {navLinks.map((l, i) => (
                    <motion.li
                      key={l.href}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * i }}
                    >
                      <a
                        href={l.href}
                        onClick={() => setOpen(false)}
                        className="block rounded-xl px-3 py-3 text-2xl font-semibold text-white hover:bg-white/5"
                      >
                        {l.label}
                      </a>
                    </motion.li>
                  ))}
                </ul>
                <div className="mt-auto flex items-center gap-3 border-t border-white/[0.06] pt-6">
                  <a href={profile.github} target="_blank" rel="noreferrer" className="flex-1 rounded-xl border border-white/10 px-4 py-3 text-center text-sm text-slate-200">
                    GitHub
                  </a>
                  <a href={profile.linkedin} target="_blank" rel="noreferrer" className="flex-1 rounded-xl border border-white/10 px-4 py-3 text-center text-sm text-slate-200">
                    LinkedIn
                  </a>
                  <a href={profile.resume} target="_blank" rel="noreferrer" className="flex-1 rounded-xl bg-white px-4 py-3 text-center text-sm font-semibold text-slate-950">
                    Resume
                  </a>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </header>
  );
}

function IconLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/5 hover:text-white"
    >
      {children}
    </a>
  );
}
