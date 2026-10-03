"use server";

import { revalidatePath } from "next/cache";
import { defineTenantAction } from "@/core/actions/define";
import {
  fiscalYearSchema, idSchema, ledgerAccountSchema, manualEntrySchema, mappingSchema, periodLockSchema, updateLedgerAccountSchema, updateManualEntrySchema,
} from "./schemas";
import * as svc from "./service";

const bust = () => revalidatePath("/app/accounting", "layout");
const M = "accounting";

export const createLedgerAccountAction = defineTenantAction({ input: ledgerAccountSchema, module: M, permission: "accounting.chart.manage", handler: async ({ ctx, input }) => { await svc.createLedgerAccount(ctx, input); bust(); } });
export const updateLedgerAccountAction = defineTenantAction({ input: updateLedgerAccountSchema, module: M, permission: "accounting.chart.manage", handler: async ({ ctx, input }) => { await svc.updateLedgerAccount(ctx, input); bust(); } });
export const setMappingAction = defineTenantAction({ input: mappingSchema, module: M, permission: "accounting.chart.manage", handler: async ({ ctx, input }) => { await svc.setMapping(ctx, input); bust(); } });

export const createFiscalYearAction = defineTenantAction({ input: fiscalYearSchema, module: M, permission: "accounting.period.manage", handler: async ({ ctx, input }) => { await svc.createFiscalYear(ctx, input); bust(); } });
export const lockPeriodAction = defineTenantAction({ input: periodLockSchema, module: M, permission: "accounting.period.manage", handler: async ({ ctx, input }) => { await svc.setPeriodLocked(ctx, input.id, input.locked); bust(); } });
export const closeFiscalYearAction = defineTenantAction({ input: idSchema, module: M, permission: "accounting.period.manage", handler: async ({ ctx, input }) => { const r = await svc.closeFiscalYear(ctx, input.id); bust(); return r; } });

export const createEntryAction = defineTenantAction({ input: manualEntrySchema, module: M, permission: "accounting.entry.create", handler: async ({ ctx, input }) => { const e = await svc.createManualEntry(ctx, input); bust(); return { id: e.id }; } });
export const updateEntryAction = defineTenantAction({ input: updateManualEntrySchema, module: M, permission: "accounting.entry.create", handler: async ({ ctx, input }) => { await svc.updateManualEntry(ctx, input); bust(); } });
export const deleteEntryAction = defineTenantAction({ input: idSchema, module: M, permission: "accounting.entry.create", handler: async ({ ctx, input }) => { await svc.deleteManualEntry(ctx, input.id); bust(); } });
export const validateEntryAction = defineTenantAction({ input: idSchema, module: M, permission: "accounting.entry.validate", handler: async ({ ctx, input }) => { const r = await svc.validateManualEntry(ctx, input.id); bust(); return r; } });
export const reverseEntryAction = defineTenantAction({ input: idSchema, module: M, permission: "accounting.entry.validate", handler: async ({ ctx, input }) => { const r = await svc.reverseManualEntry(ctx, input.id); bust(); return { id: r.id, number: r.number }; } });

export const generateMissingEntriesAction = defineTenantAction({ input: idSchema.partial(), module: M, permission: ["accounting.entry.create", "accounting.entry.validate"], handler: async ({ ctx }) => { const r = await svc.generateMissingEntries(ctx); bust(); return r; } });
