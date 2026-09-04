import { PRODUCT_NAME } from "@barber/config";

// Site institucional (§15) ainda não foi construído — esta rota é o
// placeholder que existe desde a fundação técnica (Marco 0).
export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">{PRODUCT_NAME}</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Projeto em fase de fundação técnica. Consulte docs/product-scope-part1.md
          e docs/architecture.md.
        </p>
      </div>
    </main>
  );
}
