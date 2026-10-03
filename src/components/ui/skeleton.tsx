import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-shimmer rounded-lg bg-[linear-gradient(110deg,var(--accent)_30%,color-mix(in_srgb,var(--brand)_10%,var(--card))_50%,var(--accent)_70%)] bg-[length:200%_100%]", className)}
      {...props}
    />
  )
}

export { Skeleton }
