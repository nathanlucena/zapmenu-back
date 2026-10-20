import { describe, expect, it } from 'vitest';
import { reconhecerComando } from './comandos.js';

describe('reconhecerComando', () => {
  it.each([
    'cardápio',
    'Ver cardápio',
    'meu cardapio',
    'Mostrar cardapio',
    'mostra o cardápio',
    'me mostra o meu cardápio!',
    'quero ver o cardápio',
    'Pode mandar o cardápio?',
    'listar cardapio',
    'cardápio atual',
  ])('reconhece "%s" como pedido de cardápio', (texto) => {
    expect(reconhecerComando(texto)).toBe('CARDAPIO');
  });

  it.each(['coloca pizza no cardápio', 'tira a coca do cardapio', 'o cardapio ta errado'])(
    'deixa "%s" para a IA',
    (texto) => {
      expect(reconhecerComando(texto)).toBeUndefined();
    },
  );

  it('mantém as outras palavras-chave', () => {
    expect(reconhecerComando('Sim!')).toBe('SIM');
    expect(reconhecerComando('cancelar')).toBe('CANCELAR');
    expect(reconhecerComando('não')).toBe('NAO');
  });
});
