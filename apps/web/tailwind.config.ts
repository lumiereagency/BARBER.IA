import type { Config } from "tailwindcss";

// Tokens da Parte 4 §6, como variáveis CSS (globals.css) lidas via
// rgb(var(--x) / <alpha-value>) — isso é o que permite bg-error/12 etc.
function token(name: string) {
  return `rgb(var(--${name}) / <alpha-value>)`;
}

// Não usa a variante `dark:` do Tailwind: o tema vira pela variável CSS de
// cada token (globals.css), não por uma classe utilitária por elemento.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: token("canvas"),
        surface: {
          1: token("surface-1"),
          2: token("surface-2"),
          3: token("surface-3"),
        },
        line: {
          subtle: token("border-subtle"),
          strong: token("border-strong"),
        },
        ink: {
          DEFAULT: token("text-primary"),
          secondary: token("text-secondary"),
          muted: token("text-muted"),
          inverse: token("text-inverse"),
        },
        brand: {
          400: token("brand-400"),
          500: token("brand-500"),
          600: token("brand-600"),
          soft: token("brand-soft"),
        },
        success: token("success"),
        warning: token("warning"),
        error: token("error"),
        info: token("info"),
      },
      fontFamily: {
        sans: ["var(--font-manrope)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
      },
      borderRadius: {
        // Painel/modal do §10 (20px) — 3xl do Tailwind é 24px por padrão
        "3xl": "20px",
      },
      backgroundImage: {
        // Gradiente principal (§7) — só para CTAs estratégicos, nunca em todo botão
        "brand-gradient": "linear-gradient(135deg, #FF7A35 0%, #FF4D16 48%, #C92C0A 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
