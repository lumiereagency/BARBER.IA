export default function SmartSlotPage({ params }: { params: { token: string } }) {
  // TODO: resolver SmartSlotLink por token e oferecer exclusivamente essa
  // janela (seção 13.3 da Parte 1) — primeiro a confirmar leva.
  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">Vaga disponível</h1>
      <p className="mt-2 text-sm text-neutral-500">Placeholder de fundação técnica.</p>
    </main>
  );
}
