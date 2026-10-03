"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineTenantAction } from "@/core/actions/define";
import * as costs from "./costs";
import * as fines from "./fines";
import * as ops from "./operations";
import {
  assignmentSchema, complianceSchema, completeMaintenanceSchema, driverSchema, fineSchema, fineStatusSchema, finishTripSchema, fuelSchema, idSchema, maintenanceSchema, startTripSchema, tripSchema,
  updateDriverSchema, updateFineSchema, updateMaintenanceSchema, updateTripSchema, updateVehicleSchema, vehicleSchema,
} from "./schemas";
import * as svc from "./service";

const M = "fleet";
const bust = () => { revalidatePath("/app/fleet", "layout"); revalidatePath("/app/dashboard"); };

// Véhicules, affectations, documents réglementaires
export const createVehicleAction = defineTenantAction({ input: vehicleSchema, module: M, permission: "fleet.vehicle.manage", handler: async ({ ctx, input }) => { const v = await svc.createVehicle(ctx, input); bust(); return { id: v.id }; } });
export const updateVehicleAction = defineTenantAction({ input: updateVehicleSchema, module: M, permission: "fleet.vehicle.manage", handler: async ({ ctx, input }) => { await svc.updateVehicle(ctx, input); bust(); } });
export const archiveVehicleAction = defineTenantAction({ input: idSchema, module: M, permission: "fleet.vehicle.manage", handler: async ({ ctx, input }) => { await svc.archiveVehicle(ctx, input.id); bust(); } });
export const assignDriverAction = defineTenantAction({ input: assignmentSchema, module: M, permission: "fleet.vehicle.manage", handler: async ({ ctx, input }) => { await svc.assignDriver(ctx, input); bust(); } });
export const endAssignmentAction = defineTenantAction({ input: idSchema, module: M, permission: "fleet.vehicle.manage", handler: async ({ ctx, input }) => { await svc.endAssignment(ctx, input.id); bust(); } });
export const addComplianceAction = defineTenantAction({ input: complianceSchema, module: M, permission: "fleet.vehicle.manage", handler: async ({ ctx, input }) => { await svc.addCompliance(ctx, input); bust(); } });
export const deleteComplianceAction = defineTenantAction({ input: idSchema, module: M, permission: "fleet.vehicle.manage", handler: async ({ ctx, input }) => { await svc.deleteCompliance(ctx, input.id); bust(); } });

// Chauffeurs
export const createDriverAction = defineTenantAction({ input: driverSchema, module: M, permission: "fleet.driver.manage", handler: async ({ ctx, input }) => { const dr = await svc.createDriver(ctx, input); bust(); return { id: dr.id }; } });
export const updateDriverAction = defineTenantAction({ input: updateDriverSchema, module: M, permission: "fleet.driver.manage", handler: async ({ ctx, input }) => { await svc.updateDriver(ctx, input); bust(); } });
export const archiveDriverAction = defineTenantAction({ input: idSchema, module: M, permission: "fleet.driver.manage", handler: async ({ ctx, input }) => { await svc.archiveDriver(ctx, input.id); bust(); } });

// Missions
export const createTripAction = defineTenantAction({ input: tripSchema, module: M, permission: "fleet.trip.manage", handler: async ({ ctx, input }) => { const t = await ops.createTrip(ctx, input); bust(); return { id: t.id }; } });
export const updateTripAction = defineTenantAction({ input: updateTripSchema, module: M, permission: "fleet.trip.manage", handler: async ({ ctx, input }) => { await ops.updateTrip(ctx, input); bust(); } });
export const startTripAction = defineTenantAction({ input: startTripSchema, module: M, permission: "fleet.trip.manage", handler: async ({ ctx, input }) => { await ops.startTrip(ctx, input); bust(); } });
export const finishTripAction = defineTenantAction({ input: finishTripSchema, module: M, permission: "fleet.trip.manage", handler: async ({ ctx, input }) => { await ops.finishTrip(ctx, input); bust(); } });
export const cancelTripAction = defineTenantAction({ input: idSchema, module: M, permission: "fleet.trip.manage", handler: async ({ ctx, input }) => { await ops.cancelTrip(ctx, input.id); bust(); } });

// Carburant, entretiens
export const addFuelAction = defineTenantAction({ input: fuelSchema, module: M, permission: "fleet.fuel.manage", handler: async ({ ctx, input }) => { await ops.addFuel(ctx, input); bust(); } });
export const deleteFuelAction = defineTenantAction({ input: idSchema, module: M, permission: "fleet.fuel.manage", handler: async ({ ctx, input }) => { await ops.deleteFuel(ctx, input.id); bust(); } });
export const addMaintenanceAction = defineTenantAction({ input: maintenanceSchema, module: M, permission: "fleet.maintenance.manage", handler: async ({ ctx, input }) => { await ops.addMaintenance(ctx, input); bust(); } });
export const updateMaintenanceAction = defineTenantAction({ input: updateMaintenanceSchema, module: M, permission: "fleet.maintenance.manage", handler: async ({ ctx, input }) => { await ops.updateMaintenance(ctx, input); bust(); } });
export const completeMaintenanceAction = defineTenantAction({ input: completeMaintenanceSchema, module: M, permission: "fleet.maintenance.manage", handler: async ({ ctx, input }) => { await ops.completeMaintenance(ctx, input); bust(); } });
export const cancelMaintenanceAction = defineTenantAction({ input: idSchema, module: M, permission: "fleet.maintenance.manage", handler: async ({ ctx, input }) => { await ops.cancelMaintenance(ctx, input.id); bust(); } });
export const deleteMaintenanceAction = defineTenantAction({ input: idSchema, module: M, permission: "fleet.maintenance.manage", handler: async ({ ctx, input }) => { await ops.deleteMaintenance(ctx, input.id); bust(); } });

// Contraventions
export const createFineAction = defineTenantAction({ input: fineSchema, module: M, permission: "fleet.fine.manage", handler: async ({ ctx, input }) => { const f = await fines.createFine(ctx, input); bust(); return { id: f.id }; } });
export const updateFineAction = defineTenantAction({ input: updateFineSchema, module: M, permission: "fleet.fine.manage", handler: async ({ ctx, input }) => { await fines.updateFine(ctx, input); bust(); } });
export const setFineStatusAction = defineTenantAction({ input: fineStatusSchema, module: M, permission: "fleet.fine.manage", handler: async ({ ctx, input }) => { await fines.setFineStatus(ctx, input); bust(); } });
export const deleteFineAction = defineTenantAction({ input: idSchema, module: M, permission: "fleet.fine.manage", handler: async ({ ctx, input }) => { await fines.deleteFine(ctx, input.id); bust(); } });

// Finance : dépense créée à partir d'un coût (le droit de gérer ce type de coût ET celui de créer des dépenses sont exigés)
const COST_PERMISSION = { fuel: "fleet.fuel.manage", maintenance: "fleet.maintenance.manage", fine: "fleet.fine.manage" } as const;
export const createExpenseFromCostAction = defineTenantAction({
  input: z.object({ source: z.enum(["fuel", "maintenance", "fine"]), id: z.string().uuid() }), module: M,
  handler: async ({ ctx, input }) => {
    ctx.assertCan(COST_PERMISSION[input.source]);
    const e = await costs.createExpenseFromCost(ctx, input.source, input.id);
    bust(); revalidatePath("/app/finance", "layout");
    return { id: e.id };
  },
});
