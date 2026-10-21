import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { proto } from 'baileys';
import { describe, expect, it } from 'vitest';
import { lerVoto, type EnqueteGuardada } from './enquete.js';

/** Cifra um voto como o WhatsApp faz (o inverso de decryptPollVote do Baileys). */
function cifrarVoto(enquete: EnqueteGuardada, criadorJid: string, votanteJid: string, opcoes: string[]) {
  const segredo = Buffer.from(enquete.segredo, 'base64');
  const assinatura = Buffer.concat([
    Buffer.from(enquete.id),
    Buffer.from(criadorJid),
    Buffer.from(votanteJid),
    Buffer.from('Poll Vote'),
    new Uint8Array([1]),
  ]);
  const chave0 = createHmac('sha256', new Uint8Array(32)).update(segredo).digest();
  const chave = createHmac('sha256', chave0).update(assinatura).digest();
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  cifra.setAAD(Buffer.from(`${enquete.id}\u0000${votanteJid}`));
  const voto = proto.Message.PollVoteMessage.encode({
    selectedOptions: opcoes.map((opcao) => createHash('sha256').update(opcao).digest()),
  }).finish();
  const cifrado = Buffer.concat([cifra.update(voto), cifra.final(), cifra.getAuthTag()]);
  return { encPayload: cifrado, encIv: iv };
}

const enquete: EnqueteGuardada = {
  id: '3EB0ABC123',
  segredo: randomBytes(32).toString('base64'),
  criadorJid: '5511900000001@s.whatsapp.net',
  opcoes: ['Aceitar', 'Recusar'],
};

describe('lerVoto', () => {
  it('decifra o voto e devolve a opção marcada', () => {
    const voto = cifrarVoto(enquete, enquete.criadorJid, '5511988887777@s.whatsapp.net', ['Recusar']);

    expect(lerVoto(enquete, voto, [enquete.criadorJid], ['5511988887777@s.whatsapp.net'])).toEqual(['Recusar']);
  });

  it('acha a combinação certa quando o WhatsApp usou o LID de quem votou', () => {
    const voto = cifrarVoto(enquete, enquete.criadorJid, '123456789@lid', ['Aceitar']);

    const opcoes = lerVoto(
      enquete,
      voto,
      [enquete.criadorJid, '999@lid'],
      ['5511988887777@s.whatsapp.net', '123456789@lid'],
    );

    expect(opcoes).toEqual(['Aceitar']);
  });

  it('devolve undefined quando nenhuma combinação decifra', () => {
    const voto = cifrarVoto(enquete, enquete.criadorJid, 'outra@s.whatsapp.net', ['Aceitar']);

    expect(lerVoto(enquete, voto, [enquete.criadorJid], ['5511988887777@s.whatsapp.net'])).toBeUndefined();
  });
});
