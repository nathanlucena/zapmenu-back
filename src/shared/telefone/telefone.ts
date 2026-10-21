/** Tira do ID do WhatsApp o domínio e o aparelho (ex.: `5511…:3@s.whatsapp.net`). */
export function telefoneDoChatId(chatId: string): string {
  return chatId.replace(/(:\d+)?@(c\.us|g\.us|s\.whatsapp\.net)$/, '');
}

/**
 * Chave de comparação de telefones: só dígitos e, para celulares brasileiros,
 * sem o 9º dígito — o WhatsApp às vezes identifica a conta com e às vezes sem.
 */
export function chaveTelefone(telefone: string): string {
  const digitos = telefoneDoChatId(telefone).replace(/\D/g, '');
  if (digitos.length === 13 && digitos.startsWith('55') && digitos[4] === '9') {
    return digitos.slice(0, 4) + digitos.slice(5);
  }
  return digitos;
}
