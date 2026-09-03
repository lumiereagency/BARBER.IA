export default function BarbershopPublicPage({ params }: { params: { slug: string } }) {
  // TODO: carregar Barbershop por slug, listar serviços/profissionais e iniciar
  // o wizard de agendamento (seção 7 da Parte 1).
  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">Página pública — {params.slug}</h1>
      <p className="mt-2 text-sm text-neutral-500">Placeholder de fundação técnica.</p>
    </main>
  );
}
