import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SLO Rep · Analytics",
  description: "SLO Rep marketing analytics dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <nav style={{
          background: "#1A1A1A",
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          gap: 0,
          flexWrap: "wrap",
          borderBottom: "2px solid #333",
          fontFamily: "'Inter Tight', system-ui, sans-serif",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}>
          <span style={{
            fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase",
            color: "#8B7E68", marginRight: 24, paddingRight: 24,
            borderRight: "1px solid #333", lineHeight: "48px",
            whiteSpace: "nowrap",
          }}>
            SLO Rep
          </span>
          {[
            { href: "/",                    label: "Pacing" },
            { href: "/instances",           label: "By Performance" },
            { href: "/season-subscription", label: "Season Subscription" },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              style={{
                display: "inline-block",
                padding: "0 16px",
                lineHeight: "48px",
                fontSize: 13,
                fontWeight: 500,
                color: "#C8BFAC",
                textDecoration: "none",
                borderBottom: "2px solid transparent",
                marginBottom: "-2px",
                transition: "color 0.15s, border-color 0.15s",
              }}
              // active state handled client-side via CSS — hover is enough for a static indicator
            >
              {label}
            </Link>
          ))}
        </nav>
        {children}
      </body>
    </html>
  );
}
