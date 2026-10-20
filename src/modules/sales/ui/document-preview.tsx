import { DOCUMENT_BRAND } from "@/core/pdf/legal-footer";
import { formatMoney } from "@/lib/reference-data";

/**
 * Aperçu « papier » d'un devis, à l'identique du PDF (voir core/pdf/business-document.ts) : mêmes blocs, mêmes libellés.
 * La feuille reste blanche en mode sombre, comme le document imprimé.
 */
export interface PreviewLine { description: string; quantity: number; unit: string; unitPrice: number; discountPct: number; taxRate: number; net: number; tax: number }

export interface PreviewData {
  title: string;
  number: string | null;
  /** Texte affiché à la place du numéro tant qu'il n'est pas attribué. */
  numberPlaceholder?: string;
  currency: string;
  issuer: { name: string; lines: string[]; footer: string; logoUrl: string | null };
  recipient: { name: string; lines: string[] } | null;
  dates: { label: string; value: string }[];
  lines: PreviewLine[];
  totals: { label: string; value: number; bold?: boolean }[];
  breakdown: { rate: number; base: number; tax: number }[];
  notes: string;
  terms: string;
  signatureLabel?: string;
}

const num = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(n);

export function DocumentPreview({ data }: { data: PreviewData }) {
  const m = (n: number) => formatMoney(n, data.currency);
  return (
    <article aria-label={`Aperçu du ${data.title.toLowerCase()}`} className="mx-auto w-full max-w-[860px] rounded-sm bg-white p-6 text-[#0b0c24] shadow-[0_2px_20px_rgb(11_12_36/0.18)] sm:p-9">
      <header className="flex items-start justify-between gap-4">
        <div className="min-h-16 min-w-0">
          {data.issuer.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- logo servi par la route protégée de l'entreprise
            <img src={data.issuer.logoUrl} alt={`Logo ${data.issuer.name}`} className="max-h-[4.5rem] w-auto max-w-[11rem] object-contain" />
          )}
        </div>
        <div className="text-right">
          <h2 className="font-display text-3xl font-semibold leading-none sm:text-4xl">{data.title}</h2>
          <p className="mt-2 text-xs text-[#5a5b7a]">N° {data.number ?? data.numberPlaceholder ?? "attribué à l'enregistrement"}</p>
        </div>
      </header>

      <section className="mt-8 grid gap-5 sm:grid-cols-2">
        <div>
          <p className="text-[11px] text-[#5c08da]">Émetteur</p>
          <p className="mt-0.5 text-sm font-bold uppercase">{data.issuer.name}</p>
          {data.issuer.lines.map((l) => <p key={l} className="text-[11px] leading-snug text-[#5a5b7a]">{l}</p>)}
        </div>
        <div>
          <p className="text-[11px] text-[#5c08da]">Client</p>
          {data.recipient ? (
            <>
              <p className="mt-0.5 text-sm font-bold">{data.recipient.name}</p>
              {data.recipient.lines.map((l) => <p key={l} className="text-[11px] leading-snug text-[#5a5b7a]">{l}</p>)}
            </>
          ) : <p className="mt-0.5 text-sm italic text-[#5a5b7a]">Sélectionnez un client</p>}
        </div>
      </section>

      <div className="mt-6 flex justify-end gap-8 text-right">
        {data.dates.map((d) => (
          <div key={d.label}>
            <p className="text-[11px] text-[#5c08da]">{d.label}</p>
            <p className="text-sm font-bold">{d.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-xs">
          <thead>
            <tr className="bg-[#5c08da] text-white">
              <th className="px-2 py-2 text-left font-bold">Désignations</th>
              <th className="px-2 py-2 text-right font-bold">Qté</th>
              <th className="px-2 py-2 text-right font-bold">Prix u. HT</th>
              <th className="px-2 py-2 text-right font-bold">TVA (%)</th>
              <th className="px-2 py-2 text-right font-bold">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l, i) => (
              <tr key={i} className="border-b border-[#e2e0f4] align-top">
                <td className="px-2 py-2">
                  {l.description || <span className="italic text-[#5a5b7a]">Désignation…</span>}
                  {l.discountPct > 0 && <span className="block text-[#5a5b7a]">Remise {num(l.discountPct)} %</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{num(l.quantity)} {l.unit}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{m(l.unitPrice)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{num(l.taxRate)}%</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{m(l.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid items-start gap-5 sm:grid-cols-[1fr_15rem]">
        <table className="w-full max-w-[17rem] border-collapse text-xs">
          <thead>
            <tr className="bg-[#5c08da] text-white">
              <th className="px-2 py-2 text-left font-bold">Base</th>
              <th className="px-2 py-2 text-right font-bold">Taux</th>
              <th className="px-2 py-2 text-right font-bold">Montant TVA</th>
            </tr>
          </thead>
          <tbody>
            {data.breakdown.map((b) => (
              <tr key={b.rate} className="border-b border-[#e2e0f4]">
                <td className="whitespace-nowrap px-2 py-2 tabular-nums">{m(b.base)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{num(b.rate)}%</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{m(b.tax)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-[#5c08da] text-white"><th colSpan={2} className="px-2 py-2 text-left font-bold">Récapitulatif</th></tr>
          </thead>
          <tbody>
            {data.totals.map((t) => (
              <tr key={t.label} className="border-b border-[#e2e0f4]">
                <td className={`px-2 py-2 ${t.bold ? "font-bold" : ""}`}>{t.label}</td>
                <td className={`whitespace-nowrap px-2 py-2 text-right tabular-nums ${t.bold ? "font-bold" : ""}`}>{m(t.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.notes && (
        <section className="mt-6">
          <p className="text-[11px] text-[#5c08da]">Notes</p>
          <p className="whitespace-pre-line text-xs">{data.notes}</p>
        </section>
      )}
      {data.terms && (
        <section className="mt-4">
          <p className="text-[11px] text-[#5c08da]">Paiement et mentions</p>
          <p className="whitespace-pre-line text-xs">{data.terms}</p>
        </section>
      )}
      {data.signatureLabel && (
        <div className="mt-6 flex justify-end">
          <div className="h-20 w-full max-w-[16rem] rounded-sm border border-[#e2e0f4] p-2 text-[11px] text-[#5a5b7a]">{data.signatureLabel}</div>
        </div>
      )}

      <footer className="mt-8 border-t border-[#e2e0f4] pt-3">
        <p className="whitespace-pre-line text-[11px] font-medium leading-snug">{data.issuer.footer}</p>
        <p className="mt-0.5 text-[10px] text-[#5a5b7a]">{DOCUMENT_BRAND}</p>
      </footer>
    </article>
  );
}
