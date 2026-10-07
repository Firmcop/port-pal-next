import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "../index.css";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://portal.firmcop.com";
const OG_IMAGE =
  "https://storage.googleapis.com/gpt-engineer-file-uploads/B7xSW7UPQxgETBWVmpjzDutwHNU2/social-images/social-1778437747789-logo_suggestion_007.webp";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Port Pal — Container Depot Management System",
    template: "%s · Port Pal",
  },
  description:
    "Port Pal is a modern Container Depot Management System (CDMS) for efficient container operations, gate management, M&R, billing, and logistics.",
  authors: [{ name: "Port Pal" }],
  alternates: { canonical: "/" },
  icons: { icon: "/favicon.png", apple: "/favicon.png" },
  openGraph: {
    type: "website",
    url: SITE,
    title: "Port Pal — Container Depot Management System",
    description: "Modern CDMS for container depots: yard, gate, M&R, billing, logistics, and finance in one platform.",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    site: "@firmcop",
    title: "Port Pal — Container Depot Management System",
    description: "Modern CDMS for container depots: yard, gate, M&R, billing, logistics, and finance in one platform.",
    images: [OG_IMAGE],
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

const jsonLd = [
  { "@context": "https://schema.org", "@type": "Organization", name: "Port Pal", url: SITE, logo: OG_IMAGE },
  { "@context": "https://schema.org", "@type": "WebSite", name: "Port Pal", url: SITE },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
