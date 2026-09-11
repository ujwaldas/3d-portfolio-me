import About from "./components/About";
import Contact from "./components/Contact";
import Experience from "./components/Experience";
import Footer from "./components/Footer";
import Hero from "./components/Hero";
import Highlights from "./components/Highlights";
import Navbar from "./components/Navbar";
import PhotoStrip from "./components/PhotoStrip";
import Projects from "./components/Projects";
import Skills from "./components/Skills";

export default function App() {
  return (
    <div className="min-h-screen bg-[#05070d] text-slate-200 antialiased selection:bg-sky-400/30">
      <Navbar />
      <main>
        <Hero />
        <div className="relative">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#21476a]/70 to-transparent" />
          <About />
          <Highlights />
          <Experience />
          <Projects />
          <Skills />
          <PhotoStrip />
          <Contact />
        </div>
      </main>
      <Footer />
    </div>
  );
}
