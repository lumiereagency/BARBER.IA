// Adapter de envio de código de acesso.
//
// O provedor de SMS ainda não foi decidido (pendência §19 #2 da Parte 3), então
// o que existe hoje é o provedor de desenvolvimento, que registra o código no
// log do servidor em vez de enviar. A interface é o ponto único a implementar
// quando o provedor for escolhido — nada além deste arquivo muda.
//
// O código NUNCA volta na resposta HTTP: se voltasse, qualquer pessoa poderia
// pedir o código de um telefone alheio e lê-lo na própria resposta.

export interface SendCodeInput {
  destination: string;
  code: string;
  channel: "SMS" | "EMAIL";
}

export interface MessagingProvider {
  readonly name: string;
  sendAccessCode(input: SendCodeInput): Promise<void>;
}

/// Desenvolvimento: escreve no log do servidor. Recusa-se a rodar em produção.
class LogOnlyProvider implements MessagingProvider {
  readonly name = "log";

  async sendAccessCode(input: SendCodeInput): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Nenhum provedor de envio configurado. Defina SMS_PROVIDER antes de subir para produção."
      );
    }
    console.info(
      `[otp] código para ${input.destination} (${input.channel}): ${input.code}`
    );
  }
}

let provider: MessagingProvider | null = null;

export function messagingProvider(): MessagingProvider {
  if (provider) return provider;

  // Quando o provedor for escolhido, é aqui que ele entra — a decisão fica
  // isolada em um ponto só.
  switch (process.env.SMS_PROVIDER) {
    case undefined:
    case "":
    case "log":
      provider = new LogOnlyProvider();
      break;
    default:
      throw new Error(`Provedor de envio desconhecido: ${process.env.SMS_PROVIDER}`);
  }

  return provider;
}

/// Usado pelos testes para observar o que seria enviado.
export function setMessagingProvider(custom: MessagingProvider | null): void {
  provider = custom;
}
