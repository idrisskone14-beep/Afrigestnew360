"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineTenantAction } from "@/core/actions/define";

/** Les notifications sont personnelles : seules celles de l'utilisateur courant sont accessibles. */
export const markNotificationReadAction = defineTenantAction({
  input: z.object({ id: z.string().uuid() }),
  handler: async ({ ctx, input }) => {
    await ctx.db.notification.updateMany({
      where: { id: input.id, userId: ctx.user.id, status: "UNREAD" },
      data: { status: "READ", readAt: new Date() },
    });
    revalidatePath("/app", "layout");
  },
});

export const markAllNotificationsReadAction = defineTenantAction({
  input: z.object({}),
  handler: async ({ ctx }) => {
    await ctx.db.notification.updateMany({
      where: { userId: ctx.user.id, status: "UNREAD" },
      data: { status: "READ", readAt: new Date() },
    });
    revalidatePath("/app", "layout");
  },
});
