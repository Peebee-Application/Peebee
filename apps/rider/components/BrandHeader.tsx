import { BrandLogo } from "./BrandLogo";
import Link from "next/link";

export function BrandHeader() {
  return (
    <header className="sticky top-0 z-40 h-14 bg-cream/95 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-lg items-center gap-3 px-4">
        <Link href="/" aria-label="Go to home" className="shrink-0">
          <BrandLogo />
        </Link>
        <span className="ml-auto rounded-full bg-[rgb(var(--surface-muted))] px-3 py-1.5 text-xs font-medium text-ink">Rider</span>
      </div>
    </header>
  );
}
