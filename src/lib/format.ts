const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export const fmtDate = (d: Date | string | null | undefined) => (d ? dateFmt.format(new Date(d)) : "—");
export const fmtDateTime = (d: Date | string | null | undefined) => (d ? dateTimeFmt.format(new Date(d)) : "—");
/** Valeur pour <input type="date"> (YYYY-MM-DD) */
export const toInputDate = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
export const todayInput = () => new Date().toISOString().slice(0, 10);
export const isPast = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() < Date.now() : false);
