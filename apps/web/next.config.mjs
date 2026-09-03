/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Empacotamento para container: gera um servidor mínimo em .next/standalone
  output: "standalone",
  // O monorepo vive acima de apps/web; o trace precisa enxergar a raiz
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  // Pacotes do workspace são TypeScript consumidos direto da fonte
  transpilePackages: [
    "@barber/db",
    "@barber/domain",
    "@barber/api-contracts",
    "@barber/config",
    "@barber/integrations",
  ],
  experimental: {
    // O engine do Prisma é carregado dinamicamente, então o tracer do Next não
    // o enxerga sozinho: sem isto a imagem sobe e falha em toda query.
    outputFileTracingIncludes: {
      "**": [
        "../../node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/**",
        "../../node_modules/.pnpm/@prisma+client*/node_modules/@prisma/client/**",
      ],
    },
  },
};

export default nextConfig;
