export function telefoneDoChatId(chatId: string): string {
  return chatId.replace(/@c\.us$|@g\.us$/, '');
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
