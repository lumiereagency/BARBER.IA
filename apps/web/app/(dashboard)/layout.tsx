import Link from "next/link";
import { redirect } from "next/navigation";
import { can } from "@barber/domain";
import { getSession } from "@/lib/auth";
import { signOut } from "../(auth)/actions";

export const dynamic = "force-dynamic";

/// Guarda única do painel: nenhuma tela abaixo daqui renderiza sem sessão, e
/// cada item de menu só aparece para quem tem a permissão correspondente.
/// A tela esconder não é a barreira — cada ação revalida no servidor.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/entrar");

  const nav = [
    { href: "/hoje", label: "Hoje", permission: "appointments.read.own" as const },
    { href: "/agenda", label: "Agenda", permission: "appointments.read.own" as const },
    { href: "/clientes", label: "Clientes", permission: "customers.read" as const },
    { href: "/equipe", label: "Equipe", permission: "professionals.read" as const },
    { href: "/gestao/servicos", label: "Serviços", permission: "services.read" as const },
    {
      href: "/gestao/configuracoes",
      label: "Configurações",
      permission: "barbershop.settings.read" as const,
    },
  ].filter((item) => can(session.membership, item.permission));

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-medium text-neutral-900">{session.barbershopName}</p>
            <p className="text-xs text-neutral-500">{session.userName}</p>
          </div>
          <form action={signOut}>
            <button type="submit" className="text-sm text-neutral-500 underline">
              Sair
            </button>
          </form>
        </div>

        <nav className="mx-auto max-w-3xl overflow-x-auto px-5">
          <ul className="flex gap-4 pb-3">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="whitespace-nowrap text-sm text-neutral-600 hover:text-neutral-900"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6">{children}</main>
    </div>
  );
}
