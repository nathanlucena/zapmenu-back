import { describe, expect, it } from 'vitest';
import { chaveTelefone, telefoneDoChatId } from './telefone.js';

describe('telefoneDoChatId', () => {
  it('tira o domínio e o aparelho do ID do WhatsApp', () => {
    expect(telefoneDoChatId('5511988887777@s.whatsapp.net')).toBe('5511988887777');
    expect(telefoneDoChatId('5511988887777:12@s.whatsapp.net')).toBe('5511988887777');
    expect(telefoneDoChatId('5511988887777@c.us')).toBe('5511988887777');
  });

  it('mantém IDs que não são telefone', () => {
    expect(telefoneDoChatId('123@lid')).toBe('123@lid');
  });
});

describe('chaveTelefone', () => {
  it('compara celulares brasileiros com e sem o 9º dígito', () => {
    expect(chaveTelefone('5511988887777@s.whatsapp.net')).toBe(chaveTelefone('551188887777'));
  });
});
