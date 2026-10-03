import "server-only";
import { on } from "@/core/events";

/** Le module RH applique la décision d'un approbateur aux demandes de congé. */
on("approval.decided", async (tx, _ctx, { resourceType, resourceId, decision }) => {
  if (resourceType !== "leave") return;
  const r = await tx.leaveRequest.findFirst({ where: { id: resourceId } });
  if (r?.status === "PENDING") await tx.leaveRequest.update({ where: { id: resourceId }, data: { status: decision === "APPROVED" ? "APPROVED" : "REJECTED" } });
});
