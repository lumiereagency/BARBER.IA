export default function ManageAppointmentPage({ params }: { params: { token: string } }) {
  // TODO: resolver Appointment por manageToken; permitir cancelar/remarcar
  // apenas enquanto status = CONFIRMED (decisão #6 da Parte 1).
  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">Gerenciar agendamento</h1>
      <p className="mt-2 text-sm text-neutral-500">Placeholder de fundação técnica.</p>
    </main>
  );
}
