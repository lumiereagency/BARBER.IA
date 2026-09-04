"use client";

// Busca imediata (§17: "busca imediata; filtros simples"), sem depender de
// clicar em nada — digitou, a lista já filtra. O estado vive na URL, não em
// memória: atualizar a página ou voltar pelo navegador preserva a busca.

import { useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { Search } from "lucide-react";

export function ClientesSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const timer = useRef<ReturnType<typeof setTimeout>>();

  function onChange(value: string) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (value) params.set("q", value);
      else params.delete("q");
      router.replace(`/clientes?${params.toString()}`);
    }, 250);
  }

  return (
    <div className="relative">
      <Search
        size={16}
        strokeWidth={1.9}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
      />
      <input
        type="search"
        role="searchbox"
        aria-label="Buscar cliente por nome ou telefone"
        placeholder="Nome ou telefone"
        defaultValue={initialQuery}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-line-subtle bg-surface-2 py-2.5 pl-9 pr-3 text-base text-ink placeholder:text-ink-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
      />
    </div>
  );
}
