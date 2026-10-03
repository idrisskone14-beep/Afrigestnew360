"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    const doc = document as ViewTransitionDoc;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || reduce) { setTheme(next); return; }

    const r = e.currentTarget.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const t = doc.startViewTransition(() => {
      // appliqué tout de suite pour que la capture « après » montre déjà le nouveau thème
      document.documentElement.classList.toggle("dark", next === "dark");
      setTheme(next);
    });
    void t.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
  };

  return (
    <Button variant="ghost" size="icon" aria-label="Basculer le thème clair/sombre" onClick={toggle} className="group/theme">
      <Sun className="size-4 transition-transform duration-500 group-hover/theme:rotate-90 dark:hidden" />
      <Moon className="hidden size-4 transition-transform duration-500 group-hover/theme:-rotate-12 dark:block" />
    </Button>
  );
}
