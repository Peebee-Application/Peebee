import { BrandLogo } from "./BrandLogo";
import { Menu } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

export function BrandHeader({ onMenuClick }: { onMenuClick?: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-navy/15 bg-cream/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open menu"
            className="-ml-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink"
          >
            <Menu className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </button>
        )}
        <BrandLogo />
        <span className="ml-auto rounded-full bg-ink/10 px-2.5 py-0.5 text-xs font-medium text-ink">
          Admin
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}
