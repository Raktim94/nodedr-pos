import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  WifiOff,
  Lock,
  Receipt,
  ScanBarcode,
  Users,
  GitFork,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { BrandFooter } from "@/components/BrandFooter";
import { HomeAuthRedirect } from "@/components/HomeAuthRedirect";
import { QuickstartCommand } from "@/components/QuickstartCommand";

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
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 py-12 sm:py-16">
        <section className="flex flex-col items-center gap-6 text-center">
          <Image src="/logo.png" alt="nodedr-pos logo" width={72} height={72} className="h-16 w-16 rounded-full sm:h-[72px] sm:w-[72px]" priority />
          <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
            Free POS Software That Works Completely Offline
          </h1>
          <p className="max-w-2xl text-balance text-base text-foreground/70 sm:text-lg">
            nodedr-pos is free, open-source point-of-sale and inventory software for small retail
            shops. Self-hosted on your own machine, no subscription or per-sale fees, and it keeps
            working with no internet connection.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition-colors hover:opacity-90"
            >
              <GitFork className="h-4 w-4" aria-hidden="true" />
              View on GitHub
            </a>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-border"
            >
              Sign in
            </Link>
          </div>
        </section>

        <section aria-labelledby="features-heading" className="flex flex-col gap-6">
          <h2 id="features-heading" className="text-center text-2xl font-semibold text-foreground">
            Why small shops choose this free, open-source POS
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title: t, body }) => (
              <Card key={t} className="flex flex-col gap-3 p-5">
                <Icon className="h-6 w-6 text-brand" aria-hidden="true" />
                <h3 className="font-semibold text-foreground">{t}</h3>
                <p className="text-sm text-foreground/70">{body}</p>
              </Card>
            ))}
          </div>
        </section>

        <section aria-labelledby="compare-heading" className="flex flex-col gap-6">
          <h2 id="compare-heading" className="text-center text-2xl font-semibold text-foreground">
            Self-hosted, offline POS vs. typical cloud POS software
          </h2>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[480px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border">
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
          </Card>
        </section>

        <section aria-labelledby="faq-heading" className="flex flex-col gap-6">
          <h2 id="faq-heading" className="text-center text-2xl font-semibold text-foreground">
            Frequently asked questions
          </h2>
          <div className="flex flex-col gap-4">
            {FAQS.map((f) => (
              <Card key={f.q} className="p-5">
                <h3 className="font-semibold text-foreground">{f.q}</h3>
                <p className="mt-2 text-sm text-foreground/70">{f.a}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="flex flex-col items-center gap-4 pb-4 text-center">
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
