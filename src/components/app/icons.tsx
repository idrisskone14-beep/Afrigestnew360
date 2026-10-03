import {
  BarChart3, BookOpenCheck, Banknote, Boxes, FolderOpen, HardHat, KanbanSquare, LayoutDashboard, Package,
  ReceiptText, ShoppingCart, Sparkles, Truck, UserRoundCog, Users, Wallet, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  BarChart3, BookOpenCheck, Banknote, Boxes, FolderOpen, HardHat, KanbanSquare, LayoutDashboard,
  ReceiptText, ShoppingCart, Sparkles, Truck, UserRoundCog, Users, Wallet,
};

export function ModuleIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = (name && ICONS[name]) || Package;
  return <Icon className={className} aria-hidden="true" />;
}
