import logoUrl from "@/assets/terramaps-logo.png"
import { cn } from "@/lib/utils"

interface BrandLogoProps {
  className?: string
  iconOnly?: boolean
  iconClassName?: string
}

export function BrandLogo({
  className,
  iconOnly = false,
  iconClassName,
}: BrandLogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <img
        src={logoUrl}
        alt="TerraMaps"
        className={cn("h-7 w-auto dark:invert", iconClassName)}
      />
      {!iconOnly && (
        <span className="text-base font-semibold tracking-tight text-foreground">
          TerraMaps
        </span>
      )}
    </div>
  )
}
