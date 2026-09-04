import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { PRODUCT_NAME } from "@barber/config";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: "Agenda online para barbearias",
};

// Aplica o tema salvo ANTES da primeira pintura — sem isto, a página nasceria
// escura (o padrão em :root) e trocaria para claro um instante depois, um
// flash visível. Dark é o padrão quando não há preferência salva (§4: dark
// premium é a identidade principal), então só o caso "light" precisa de JS.
const THEME_INIT_SCRIPT = `
try {
  var t = localStorage.getItem("barber-theme");
  if (t === "light") document.documentElement.setAttribute("data-theme", "light");
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={manrope.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
