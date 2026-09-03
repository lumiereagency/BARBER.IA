import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BARBER SaaS",
  description: "Agenda online para barbearias",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
