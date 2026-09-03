// Campo de formulário com rótulo de fato associado ao controle.
//
// Existe para que a associação não dependa de lembrar `htmlFor`/`id` em cada
// formulário: o controle vive DENTRO do label, o que o associa implicitamente.
// Sem isso, leitor de tela não anuncia o campo e clicar no rótulo não foca —
// exatamente o que a Parte 3 §13 pede ao exigir componentes acessíveis.

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-900">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-neutral-500">{hint}</span> : null}
    </label>
  );
}

/// Caixa de seleção com o texto ao lado, também associada por aninhamento.
export function CheckboxField({
  name,
  label,
  defaultChecked,
  required,
  value,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  required?: boolean;
  value?: string;
}) {
  return (
    <label className="flex items-start gap-3 text-sm text-neutral-700">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        required={required}
        className="mt-0.5 h-5 w-5 shrink-0"
      />
      <span>{label}</span>
    </label>
  );
}

export const inputClass = "w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base";
