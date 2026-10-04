import { BrandLogo } from "../../components/BrandLogo";
import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "../../components/SiteFooter";
import { ThemeModeToggle } from "../../components/ThemeModeToggle";

export const metadata: Metadata = {
  title: "Privacy Policy | Peebee",
  description: "Privacy Policy for Peebee customers, riders, restaurants, and visitors.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-cream">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" aria-label="Peebee home">
          <BrandLogo />
        </Link>
        <div className="flex items-center gap-2">
          <ThemeModeToggle />
          <Link href="/" className="button button-light">
            Home
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-5 py-12 sm:px-8">
        <p className="eyebrow">Legal</p>
        <h1 className="mt-3 text-4xl font-black leading-tight text-ink sm:text-5xl">Privacy Policy</h1>
        <p className="mt-4 text-sm text-ink-500">Last updated: September 25, 2026</p>

        <div className="legal-card mt-8 space-y-8">
          <section>
            <h2>1. Information we collect</h2>
            <p>
              Peebee may collect account details, contact information, delivery and ride details, order history, location information needed to provide services, payment status, chat messages, support requests, device information, and verification details for riders, restaurants, and staff.
            </p>
          </section>

          <section>
            <h2>2. How we use information</h2>
            <p>
              We use information to create and manage accounts, match customers with riders, process orders and payments, show live updates, provide support, improve safety, prevent fraud, troubleshoot issues, and operate Peebee's customer, rider, restaurant, and admin services.
            </p>
          </section>

          <section>
            <h2>3. Location and delivery data</h2>
            <p>
              Location data helps Peebee show pickup and delivery points, calculate distance, support live tracking, improve matching, and assist with support or safety questions. Some location details may be shared with the customer, rider, or restaurant involved in a job.
            </p>
          </section>

          <section>
            <h2>4. Sharing information</h2>
            <p>
              We may share relevant information with customers, riders, restaurants, payment providers, communication providers, verification providers, hosting providers, and support tools when needed to provide, secure, or improve Peebee. We may also share information if required by law.
            </p>
          </section>

          <section>
            <h2>5. Payments and wallets</h2>
            <p>
              Peebee may process payment status, wallet activity, mobile money details, cash dues, transaction references, and related records. Sensitive payment processing may involve third-party providers.
            </p>
          </section>

          <section>
            <h2>6. Security and retention</h2>
            <p>
              We use reasonable technical and organizational safeguards to protect information. We keep information for as long as needed to provide services, comply with legal obligations, resolve disputes, prevent fraud, and maintain business records.
            </p>
          </section>

          <section>
            <h2>7. Your choices</h2>
            <p>
              You can contact us to ask about your information, request updates, or ask for account support. Some information may need to be retained where required for safety, legal, payment, or operational reasons.
            </p>
          </section>

          <section>
            <h2>8. Contact</h2>
            <p>
              For privacy questions, contact Peebee at <a href="mailto:support@peebee.online">support@peebee.online</a> or visit us at Plot 15, Mugula Road, Entebbe.
            </p>
          </section>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
