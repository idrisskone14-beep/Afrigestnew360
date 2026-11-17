"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { BrowserFrame } from "@/components/marketing/browser-frame";
import { cn } from "@/lib/utils";

interface FlowStep { key: string; label: string; image: string; alt: string; title: string; you: string; auto: readonly string[] }

/**
 * Le « flux » du devis à la comptabilité : quatre onglets, une vraie capture du produit par étape.
 * Toutes les captures sont rendues (empilées, transparentes tant qu'elles ne sont pas actives) pour que le changement d'onglet soit instantané.
 */
export function FlowShowcase({ steps }: { steps: readonly FlowStep[] }) {
  const [index, setIndex] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = steps[index]!;

  const move = (to: number) => {
    const next = (to + steps.length) % steps.length;
    setIndex(next);
    tabs.current[next]?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(index + 1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(index - 1); }
    else if (e.key === "Home") { e.preventDefault(); move(0); }
    else if (e.key === "End") { e.preventDefault(); move(steps.length - 1); }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.5fr)] lg:items-start lg:gap-12">
      <div>
        <div role="tablist" aria-label="Du devis à la comptabilité" onKeyDown={onKeyDown} className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
          {steps.map((s, i) => (
            <button
              key={s.key}
              ref={(el) => { tabs.current[i] = el; }}
              type="button"
              role="tab"
              id={`flow-tab-${s.key}`}
              aria-selected={i === index}
              aria-controls="flow-panel"
              tabIndex={i === index ? 0 : -1}
              onClick={() => setIndex(i)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                i === index ? "border-brand bg-accent text-accent-foreground" : "bg-card text-muted-foreground hover:border-brand/50 hover:text-foreground",
              )}
            >
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", i === index ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground")}>{i + 1}</span>
              {s.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id="flow-panel" aria-labelledby={`flow-tab-${current.key}`} tabIndex={0} className="mt-6 space-y-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
          <h3 className="font-display text-2xl font-semibold tracking-tight">{current.title}</h3>
          <div>
            <p className="eyebrow">Vous faites</p>
            <p className="mt-1.5 text-muted-foreground">{current.you}</p>
          </div>
          <div>
            <p className="eyebrow">Global Gest s'en charge</p>
            <ul className="mt-2 space-y-2.5">
              {current.auto.map((a) => <li key={a} className="flex gap-2.5 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />{a}</li>)}
            </ul>
          </div>
        </div>
      </div>

      <BrowserFrame>
        <div className="relative aspect-[1600/1000] bg-secondary">
          {steps.map((s, i) => (
            <Image
              key={s.key}
              src={s.image}
              alt={s.alt}
              fill
              sizes="(min-width: 1024px) 760px, 100vw"
              aria-hidden={i !== index}
              className={cn("object-cover object-top transition-opacity duration-500", i === index ? "opacity-100" : "opacity-0")}
            />
          ))}
        </div>
      </BrowserFrame>
    </div>
  );
}
