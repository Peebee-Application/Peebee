import { BrandLogo } from "./BrandLogo";
import { Mail, MapPin, Phone } from "lucide-react";
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer px-5 py-10 sm:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1.2fr_0.8fr_0.8fr]">
        <div>
          <BrandLogo />
          <p className="mt-4 max-w-sm text-sm leading-6 text-ink-500">
            Peebee connects customers, riders, restaurants, and businesses for rides, food, shopping, and parcel delivery in Uganda.
          </p>
        </div>

        <div>
          <h2 className="footer-heading">Contact</h2>
          <div className="mt-4 space-y-3 text-sm text-ink-500">
            <a href="mailto:support@peebee.online" className="footer-link">
              <Mail className="h-4 w-4" aria-hidden />
              support@peebee.online
            </a>
            <a href="tel:+256783335335" className="footer-link">
              <Phone className="h-4 w-4" aria-hidden />
              0783 335 335
            </a>
            <a href="tel:+256756384715" className="footer-link">
              <Phone className="h-4 w-4" aria-hidden />
              0756 384 715
            </a>
            <p className="footer-link">
              <MapPin className="h-4 w-4" aria-hidden />
              Plot 15, Mugula Road, Entebbe
            </p>
          </div>
        </div>

        <div>
          <h2 className="footer-heading">Company</h2>
          <div className="mt-4 grid gap-3 text-sm text-ink-500">
            <Link href="/terms" className="hover:text-ink">
              Terms of Use
            </Link>
            <Link href="/privacy" className="hover:text-ink">
              Privacy Policy
            </Link>
            <Link href="/#services" className="hover:text-ink">
              Services
            </Link>
            <Link href="/#partners" className="hover:text-ink">
              Partners
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-8 flex max-w-7xl flex-col gap-2 border-t border-[var(--border-faint)] pt-5 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} Peebee. All rights reserved.</p>
        <p>Built for everyday movement in Uganda.</p>
      </div>
    </footer>
  );
}
