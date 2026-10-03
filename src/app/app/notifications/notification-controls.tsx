"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runAction } from "@/components/app/form-kit";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/modules/notifications/actions";
import { cn } from "@/lib/utils";

export function MarkAllButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => { await runAction(markAllNotificationsReadAction({}), { success: "Tout est marqué comme lu" }); router.refresh(); })}>
      <CheckCheck className="size-4" /> Tout marquer comme lu
    </Button>
  );
}

export function NotificationItem({ id, title, body, link, unread, date }: {
  id: string; title: string; body: string | null; link: string | null; unread: boolean; date: string;
}) {
  const [, start] = useTransition();
  const router = useRouter();
  const markRead = () => {
    if (!unread) return;
    start(async () => { await runAction(markNotificationReadAction({ id }), { silentError: true }); router.refresh(); });
  };
  const content = (
    <div className="flex gap-3 px-4 py-3.5">
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", unread ? "bg-brand" : "bg-transparent")} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm", unread && "font-semibold")}>{title}</p>
        {body && <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>}
        <p className="mt-1 text-xs text-muted-foreground">{date}</p>
      </div>
      {unread && <span className="sr-only">Non lue</span>}
    </div>
  );
  return (
    <li className="transition-colors hover:bg-muted/50">
      {link ? <Link href={link} onClick={markRead}>{content}</Link> : <button type="button" className="block w-full text-left" onClick={markRead}>{content}</button>}
    </li>
  );
}
