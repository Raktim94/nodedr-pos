import type { Metadata } from "next";
import Link from "next/link";
import {
  WifiOff,
  Lock,
  Receipt,
  ScanBarcode,
  Users,
  GitFork,
  ChevronDown,
} from "lucide-react";
import { BrandFooter } from "@/components/BrandFooter";
import { HomeAuthRedirect } from "@/components/HomeAuthRedirect";
import { QuickstartCommand } from "@/components/QuickstartCommand";
import { ReceiptHero } from "@/components/ReceiptHero";

const title = "Free POS Software – Offline, Open Source, No Subscription";
const description =
  "nodedr-pos is free, open-source point-of-sale software for small retail shops. Runs fully offline, self-hosted on your own machine, no subscription or per-sale fees, with GST-ready billing for India.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: { title, description, url: "/" },
  twitter: { title, description },
};

const GITHUB_URL = "https://github.com/Raktim94/nodedr-pos";

const FEATURES = [
  {
    icon: WifiOff,
    title: "Works fully offline",
    body: "Sales, inventory, and receipt printing all run on your own machine via Docker or a native Windows/Debian installer — no internet connection needed to make a sale.",
  },
  {
    icon: Lock,
    title: "Self-hosted, your data stays put",
    body: "There's no cloud account and nothing to sync. Sales and customer data live in a local database on hardware you control.",
  },
  {
    icon: Receipt,
    title: "GST-ready billing for India",
    body: "GST-inclusive MRP pricing, per-product HSN/SAC codes, and CGST/SGST breakup on every printed or PDF receipt.",
  },
  {
    icon: ScanBarcode,
    title: "Barcode scanning & labels",
    body: "Scan-to-checkout with a USB barcode scanner, plus a built-in generator for printing labels on items that don't have one yet.",
  },
  {
    icon: Users,
    title: "Customers, dues & loyalty",
    body: "Track customer dues, store credit, and a points-based loyalty program without a third-party CRM subscription.",
  },
  {
    icon: GitFork,
    title: "Open source, AGPL-3.0-licensed",
    body: "The full source is public on GitHub. Audit exactly how pricing, auth, and receipts work — no closed-source vendor lock-in.",
  },
];

const COMPARISON_ROWS: [string, string, string][] = [
  ["Monthly subscription", "None — free forever", "Common, per terminal/location"],
  ["Works without internet", "Yes, fully offline", "Usually requires a live connection"],
  ["Where your data lives", "On your own machine", "Vendor's cloud servers"],
  ["Source code", "Open source (AGPL-3.0), auditable", "Closed source"],
  ["GST-inclusive Indian pricing", "Built in by default", "Varies, often an add-on"],
];

const FAQS = [
  {
    q: "Is nodedr-pos really free, with no subscription or hidden fees?",
    a: "Yes. It's AGPL-3.0-licensed and open source — no subscription, no per-transaction fee, and no paid tier. You self-host it on hardware you already own or a low-cost VPS, so there's no ongoing software cost.",
  },
  {
    q: "Does this free POS software work without internet?",
    a: "Yes. nodedr-pos runs entirely offline once installed. The app and its database run locally via Docker Compose or a native Windows/Debian installer, so checkout and receipt printing keep working with no internet connection.",
  },
  {
    q: "Is open-source POS software safe for handling sales and customer data?",
    a: "Your data never leaves your premises unless you choose to host it elsewhere yourself. Because the code is open source, you (or anyone) can audit exactly how it handles passwords, pricing, and customer records, rather than trusting a closed-source cloud vendor.",
  },
  {
    q: "Does nodedr-pos support GST billing for Indian retailers?",
    a: "Yes. Pricing is GST-inclusive by default, matching India's Legal Metrology MRP rules, with per-product HSN/SAC codes and a CGST/SGST breakup shown on every receipt.",
  },
  {
    q: "What do I need to run this free POS system?",
    a: "Any machine that can run Docker Compose, or a native installer for Windows 10/11 and Debian/Ubuntu. A USB barcode scanner and ESC/POS thermal printer are supported but optional.",
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function HomePage() {
  return (
    <>
      <HomeAuthRedirect />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-20 px-4 py-12 sm:py-16">
        <section className="flex flex-col items-center gap-10 lg:flex-row lg:items-center lg:gap-14">
          <div className="flex flex-col items-center gap-6 text-center lg:items-start lg:text-left">
            <h1 className="max-w-xl text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
              Free POS software that works completely offline
            </h1>
            <p className="max-w-lg text-balance text-base text-foreground/70 sm:text-lg">
              nodedr-pos is open-source point-of-sale and inventory software for small retail
              shops. Self-hosted on your own machine, with no subscription, no per-sale fee, and
              no internet connection required to make a sale.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <Link
                href="/onboarding"
                className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground shadow-sm transition-all hover:-translate-y-px hover:opacity-90 hover:shadow-lg hover:shadow-brand/20"
              >
                Get started — free
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-border"
              >
                Sign in
              </Link>
            </div>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-foreground/60 underline-offset-2 hover:text-foreground hover:underline"
            >
              <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
              View source on GitHub
            </a>
          </div>
          <div className="flex w-full justify-center lg:w-auto lg:justify-end">
            <ReceiptHero />
          </div>
        </section>

        <section aria-labelledby="features-heading" className="flex flex-col gap-6">
          <h2 id="features-heading" className="text-xl font-semibold text-foreground">
            Why small shops choose it
          </h2>
          <div className="grid grid-cols-1 gap-x-8 divide-y divide-border rounded-xl border border-border sm:grid-cols-2 sm:divide-y-0">
            {FEATURES.map(({ icon: Icon, title: t, body }, i) => (
              <div
                key={t}
                className={`flex gap-4 px-5 py-5 ${i % 2 === 0 ? "sm:border-r sm:border-border" : ""} ${i >= 2 ? "sm:border-t sm:border-border" : ""}`}
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-foreground">{t}</h3>
                  <p className="mt-1 text-sm text-foreground/70">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="compare-heading" className="flex flex-col gap-6">
          <h2 id="compare-heading" className="text-xl font-semibold text-foreground">
            nodedr-pos vs. typical cloud POS software
          </h2>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[480px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b-2 border-border">
                  <th className="px-4 py-3 font-semibold text-foreground/70">&nbsp;</th>
                  <th className="px-4 py-3 font-semibold text-foreground">nodedr-pos</th>
                  <th className="px-4 py-3 font-semibold text-foreground/70">Typical cloud POS</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map(([label, ours, theirs]) => (
                  <tr key={label} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-3 font-medium text-foreground/70">{label}</th>
                    <td className="px-4 py-3 text-foreground">{ours}</td>
                    <td className="px-4 py-3 text-foreground/60">{theirs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="faq-heading" className="flex flex-col gap-6">
          <h2 id="faq-heading" className="text-xl font-semibold text-foreground">
            Frequently asked questions
          </h2>
          <div className="divide-y divide-border rounded-xl border border-border">
            {FAQS.map((f) => (
              <details key={f.q} className="faq-row group px-5 py-4">
                <summary className="flex cursor-pointer items-center justify-between gap-4 font-medium text-foreground">
                  {f.q}
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-foreground/50 transition-transform duration-200 group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <p className="mt-3 text-sm text-foreground/70">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface-muted px-6 py-10 pb-8 text-center">
          <h2 className="text-2xl font-semibold text-foreground">Get started for free</h2>
          <p className="max-w-xl text-sm text-foreground/70">
            Pick your OS and run one command — it checks for Docker, installs it if it&apos;s
            missing, then installs and starts nodedr-pos. No signup, no credit card, no trial
            period.
          </p>
          <QuickstartCommand />
          <p className="max-w-xl text-xs text-foreground/60">
            Prefer no Docker at all? Grab the{" "}
            <a
              href={`${GITHUB_URL}/releases/latest`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              native Windows or Debian/Ubuntu installer
            </a>{" "}
            instead, or see the{" "}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              full source on GitHub
            </a>
            .
          </p>
        </section>

        <BrandFooter />
      </main>
    </>
  );
}
