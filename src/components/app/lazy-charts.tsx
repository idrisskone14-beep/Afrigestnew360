"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Graphiques chargés à la demande : la bibliothèque (recharts, ~350 Ko) n'est plus embarquée dans le premier chargement
 * des pages concernées. Le squelette a la hauteur du graphique (h-64 + légende) : pas de saut de mise en page.
 */
const placeholder = () => <Skeleton className="h-72 w-full" role="status" aria-busy="true" aria-label="Chargement du graphique" />;

export const BarsChart = dynamic(() => import("./bars-chart").then((m) => m.BarsChart), { ssr: false, loading: placeholder });
export const CashflowChart = dynamic(() => import("./cashflow-chart").then((m) => m.CashflowChart), { ssr: false, loading: placeholder });
