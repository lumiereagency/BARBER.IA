"use client";

// Alternância de tema (§8: os dois já no MVP). Persiste em localStorage; o
// script em app/layout.tsx aplica essa preferência antes da primeira pintura,
// então este componente só precisa refletir e mudar o estado depois disso.

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "barber-theme";

export function ThemeToggle() {
  const [tema, setTema] = useState<"dark" | "light">("dark");
  const reduzMotion = useReducedMotion();

  useEffect(() => {
    const atual = document.documentElement.getAttribute("data-theme");
    setTema(atual === "light" ? "light" : "dark");
  }, []);

  function alternar() {
    const proximo = tema === "dark" ? "light" : "dark";
    setTema(proximo);
    if (proximo === "dark") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
    }
    try {
      localStorage.setItem(STORAGE_KEY, proximo);
    } catch {
      // Preferência não persistida (modo privado etc.) — a troca ainda funciona nesta visita
    }
  }

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={tema === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
      title={tema === "dark" ? "Tema claro" : "Tema escuro"}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line-subtle bg-surface-2 text-ink-secondary transition-colors hover:text-ink"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={tema}
          initial={reduzMotion ? false : { rotate: -60, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          exit={reduzMotion ? undefined : { rotate: 60, opacity: 0 }}
          transition={{ duration: reduzMotion ? 0 : 0.18 }}
          className="flex items-center justify-center"
        >
          {tema === "dark" ? <Sun size={17} strokeWidth={1.9} /> : <Moon size={17} strokeWidth={1.9} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
