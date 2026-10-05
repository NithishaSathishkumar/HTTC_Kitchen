import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HTTC Kitchen Hub | Temple Kitchen Operations",
  description: "A shared kitchen dashboard for inventory, volunteer shifts, and kitchen expenses.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
