import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:1994";
const description =
  "NodeDR POS is a free, open-source, offline-first Point of Sale and inventory management system for small retail shops. No subscription, no internet required.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "NodeDR POS | Offline-First POS & Inventory Management",
    template: "%s | NodeDR POS",
  },
  description,
  openGraph: {
    type: "website",
    siteName: "NodeDR POS",
    title: "NodeDR POS | Offline-First POS & Inventory Management",
    description,
  },
  twitter: {
    card: "summary",
    title: "NodeDR POS | Offline-First POS & Inventory Management",
    description,
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "NodeDR POS",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Windows, Linux, Docker",
  description,
  url: "https://github.com/Raktim94/nodedr-pos",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  publisher: {
    "@type": "Organization",
    name: "Nodedr Infotech Private Limited",
    url: "https://www.nodedr.com",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
