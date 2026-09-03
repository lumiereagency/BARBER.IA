import { prisma } from "@barber/db";

export const dynamic = "force-dynamic";

/// Usado pelo HEALTHCHECK do container e pelo deploy (Parte 3 §6).
/// Verifica o que precisa estar de pé para a aplicação servir: processo vivo e
/// banco alcançável. Não expõe versão, host nem qualquer detalhe interno —
/// o endpoint é público.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch (error) {
    // A resposta é deliberadamente opaca, mas a causa precisa aparecer no log
    // do servidor: sem isto, uma falha de empacotamento (client do Prisma
    // ausente na imagem) fica indistinguível de banco fora do ar.
    console.error("[health] verificação de banco falhou", error);
    return Response.json({ status: "degraded" }, { status: 503 });
  }
}
