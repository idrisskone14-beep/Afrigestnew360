"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Apparition douce au défilement ; désactivée si l'utilisateur préfère moins d'animations.
 * `as="li"` : à utiliser quand l'élément est un enfant direct d'un <ul>/<ol> (une <div> y serait invalide).
 */
export function Reveal({ children, delay = 0, className, as = "div" }: { children: React.ReactNode; delay?: number; className?: string; as?: "div" | "li" }) {
  const reduce = useReducedMotion();
  const Static = as;
  if (reduce) return <Static className={className}>{children}</Static>;
  const Animated = as === "li" ? motion.li : motion.div;
  return (
    <Animated
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
    >
      {children}
    </Animated>
  );
}
