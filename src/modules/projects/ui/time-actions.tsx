"use client";

import { Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { deleteTimeAction } from "../actions";

export const DeleteTimeButton = ({ id }: { id: string }) => (
  <ActionButton action={deleteTimeAction} input={{ id }} variant="ghost" size="sm" label="Supprimer" icon={<Trash2 className="size-4" />} success="Saisie supprimée" confirm={{ title: "Supprimer cette saisie de temps ?" }} />
);
