// Mensagens prontas para envio manual pelo WhatsApp (Parte 1 §17.1).
//
// A plataforma nunca envia nada: ela monta o link, e quem aperta o botão de
// enviar é a pessoa. Por isso estas funções são puras e devolvem apenas URL —
// não existe caminho aqui que fale com o WhatsApp.
//
// Nenhuma dessas mensagens é requisito para a reserva valer: o cliente já tem
// confirmação e link de gestão pela própria plataforma.

export interface WhatsappContext {
  customerPhone: string;
  customerName: string;
  serviceName: string;
  professionalName: string;
  /// Já formatados no fuso da barbearia
  dayLabel: string;
  timeLabel: string;
  shopName: string;
  /// Link de gestão, quando faz sentido oferecer ao cliente
  manageUrl?: string;
}

function link(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/// Primeiro nome, para a mensagem não soar como formulário.
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/// A barbearia confirmando o horário com o cliente.
export function confirmationMessage(context: WhatsappContext): string {
  return link(
    context.customerPhone,
    `Olá, ${firstName(context.customerName)}! Confirmando seu horário na ${context.shopName}: ` +
      `${context.serviceName} com ${context.professionalName}, ${context.dayLabel} às ${context.timeLabel}. ` +
      `Até lá!`
  );
}

/// Cliente que não chegou no horário. Tom de quem quer atender, não de cobrança.
export function runningLateMessage(context: WhatsappContext): string {
  return link(
    context.customerPhone,
    `Olá, ${firstName(context.customerName)}! Seu horário na ${context.shopName} era ` +
      `${context.dayLabel} às ${context.timeLabel}. Está conseguindo chegar? ` +
      `Se precisar remarcar, é só avisar.`
  );
}

/// Aviso de que a barbearia precisou cancelar, com o caminho para reagendar.
export function shopCancellationMessage(context: WhatsappContext): string {
  const reagendar = context.manageUrl ? ` Você pode escolher outro horário aqui: ${context.manageUrl}` : "";
  return link(
    context.customerPhone,
    `Olá, ${firstName(context.customerName)}. Precisamos cancelar seu horário de ` +
      `${context.dayLabel} às ${context.timeLabel} na ${context.shopName}. Desculpe pelo transtorno.` +
      reagendar
  );
}

/// Convite para o cliente voltar (usado no Marco 6, mas o texto vive aqui).
export function comeBackMessage(context: WhatsappContext & { daysSinceLastVisit: number }): string {
  return link(
    context.customerPhone,
    `Olá, ${firstName(context.customerName)}! Faz um tempo desde seu último ${context.serviceName} ` +
      `na ${context.shopName}. Quer marcar um horário?`
  );
}
