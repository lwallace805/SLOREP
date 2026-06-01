import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SLO Rep · Pacing Dashboard",
  description: "Net single-ticket sales pacing vs peer median at key milestones",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
