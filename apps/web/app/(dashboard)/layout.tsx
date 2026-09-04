import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  House,
  LogOut,
  Settings,
  Link as LinkIcon,
  Scissors,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { can } from "@barber/domain";
import { getSession } from "@/lib/auth";
import { signOut } from "../(auth)/actions";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";

export const dynamic = "force-dynamic";

/// Guarda única do painel: nenhuma tela abaixo daqui renderiza sem sessão, e
/// cada item de menu só aparece para quem tem a permissão correspondente.
/// A tela esconder não é a barreira — cada ação revalida no servidor.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/entrar");

  const nav: Array<{ href: string; label: string; icon: LucideIcon; permission: Parameters<typeof can>[1] }> = [
    { href: "/hoje", label: "Hoje", icon: House, permission: "appointments.read.own" as const },
    { href: "/agenda", label: "Agenda", icon: CalendarDays, permission: "appointments.read.own" as const },
    { href: "/clientes", label: "Clientes", icon: UserRound, permission: "customers.read" as const },
    { href: "/equipe", label: "Equipe", icon: Users, permission: "professionals.read" as const },
    { href: "/gestao/servicos", label: "Serviços", icon: Scissors, permission: "services.read" as const },
    { href: "/gestao/integracoes", label: "Integrações", icon: LinkIcon, permission: "integrations.read" as const },
    {
      href: "/gestao/configuracoes",
      label: "Configurações",
      icon: Settings,
      permission: "barbershop.settings.read" as const,
    },
  ].filter((item) => can(session.membership, item.permission));

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line-subtle bg-surface-1">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-4">
          <BrandMark className="h-6 w-6 shrink-0 text-brand-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{session.barbershopName}</p>
            <p className="truncate text-xs text-ink-secondary">{session.userName}</p>
          </div>
          <ThemeToggle />
          <form action={signOut}>
            <button
              type="submit"
              aria-label="Sair"
              title="Sair"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-secondary hover:bg-surface-2 hover:text-ink"
            >
              <LogOut size={17} strokeWidth={1.9} />
            </button>
          </form>
        </div>

        <nav className="mx-auto max-w-3xl overflow-x-auto px-5">
          <ul className="flex gap-1 pb-3">
            {nav.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm text-ink-secondary hover:bg-surface-2 hover:text-ink"
                  >
                    <Icon size={16} strokeWidth={1.9} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6">{children}</main>
    </div>
  );
}
