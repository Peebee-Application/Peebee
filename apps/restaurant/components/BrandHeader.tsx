import { BrandLogo } from "./BrandLogo";
import Link from "next/link";

export function BrandHeader() {
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-navy/15 bg-cream/95 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-lg items-center gap-3 px-4">
        <Link href="/" aria-label="Go to home" className="shrink-0">
          <BrandLogo />
        </Link>
        <span className="ml-auto rounded-full bg-green/15 px-2.5 py-0.5 text-xs font-medium text-green-600">Food</span>
      </div>
    </header>
  );
}
