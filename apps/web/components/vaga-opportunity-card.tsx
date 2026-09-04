"use client";

// Cartão de vaga aberta no painel da equipe (Marco 6.6).
//
// Gerar o link é uma ação que só pode acontecer uma vez: o token cru nunca é
// gravado, então se a equipe fechar a aba sem copiar, não há como reexibi-lo
// (mesma garantia dos tokens de gestão de agendamento, Parte 2 §5.4). Por
// isso o botão "Enviar no WhatsApp" só aparece com o link ainda em memória
// nesta sessão do navegador — depois de gerado uma vez, a vaga continua
// utilizável, só não pode ser regerada.

import { useState } from "react";
import { gerarLinkVaga } from "@/app/(dashboard)/agenda-inteligente/actions";

export interface Candidato {
  id: string;
  nome: string;
  telefone: string;
  score: number;
  motivos: string[];
}

export function VagaOportunidadeCard({
  opportunityId,
  professionalName,
  diaLabel,
  horario,
  valorFormatado,
  jaTemLink,
  candidatos,
  podeAgir,
}: {
  opportunityId: string;
  professionalName: string;
  diaLabel: string;
  horario: string;
  valorFormatado: string;
  jaTemLink: boolean;
  candidatos: Candidato[];
  podeAgir: boolean;
}) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function gerar() {
    setLoading(true);
    setError(null);
    try {
      const result = await gerarLinkVaga(opportunityId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setShareUrl(result.shareUrl);
    } finally {
      setLoading(false);
    }
  }

  async function copiar() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem permissão de clipboard: o link já está visível na tela para
      // copiar manualmente.
    }
  }

  return (
    <div className="rounded-xl border border-line-subtle bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-ink">com {professionalName}</p>
          <p className="text-sm text-ink-secondary first-letter:uppercase">
            {diaLabel}, {horario}
          </p>
        </div>
        <p className="shrink-0 text-sm font-medium text-ink">{valorFormatado}</p>
      </div>

      {error ? <p className="mt-3 text-sm text-error">{error}</p> : null}

      {shareUrl ? (
        <div className="mt-3 rounded-lg bg-canvas p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
            Link da vaga — copie agora, não é possível reexibir depois
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-sm text-ink">{shareUrl}</code>
            <button
              type="button"
              onClick={() => void copiar()}
              className="shrink-0 rounded-lg border border-line-subtle px-2.5 py-1 text-xs font-medium text-ink"
            >
              {copiado ? "Copiado!" : "Copiar"}
            </button>
          </div>
        </div>
      ) : jaTemLink ? (
        <p className="mt-3 text-sm text-ink-secondary">
          O link desta vaga já foi gerado antes. Se foi perdido, fale com o cliente diretamente.
        </p>
      ) : podeAgir ? (
        <button
          type="button"
          onClick={() => void gerar()}
          disabled={loading}
          className="mt-3 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-ink-inverse disabled:opacity-50"
        >
          {loading ? "Gerando…" : "Gerar link para compartilhar"}
        </button>
      ) : null}

      {candidatos.length > 0 ? (
        <div className="mt-4 border-t border-line-subtle pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-secondary">
            Quem mais tem chance de querer esta vaga
          </p>
          <ul className="space-y-2">
            {candidatos.map((candidato) => (
              <li
                key={candidato.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-canvas p-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{candidato.nome}</p>
                  <p className="truncate text-xs text-ink-secondary">
                    {candidato.motivos.join(" · ")}
                  </p>
                </div>
                {shareUrl ? (
                  <a
                    href={`https://wa.me/${candidato.telefone.replace(/\D/g, "")}?text=${encodeURIComponent(
                      `Olá, ${candidato.nome}! Abriu uma vaga ${professionalName ? `com ${professionalName} ` : ""}para ${diaLabel}, ${horario}. Primeiro a confirmar leva: ${shareUrl}`
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-lg border border-line-subtle px-2.5 py-1.5 text-xs font-medium text-ink"
                  >
                    Enviar WhatsApp
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
