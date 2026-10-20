import { describe, expect, it } from 'vitest';
import type { Pedido } from '../domain/pedido.js';
import { avisarPedidoPago } from './avisar-pedido-pago.js';

const pedidoPago: Pedido = {
  id: 'pedido-1',
  codigoCurto: 'PED-7KQ2',
  empreendedorId: 'emp-1',
  status: 'PAGO',
  valorTotal: 112,
  itens: [],
  expiraEm: new Date('2026-10-17T12:20:00Z'),
  criadoEm: new Date('2026-10-17T12:00:00Z'),
};

function criarMensageiroFake() {
  const enviadas: { telefone: string; texto: string }[] = [];
  return {
    enviadas,
    async enviarTexto(telefone: string, texto: string) {
      enviadas.push({ telefone, texto });
    },
  };
}

describe('avisarPedidoPago', () => {
  it('manda o código e o valor para o telefone do empreendedor', async () => {
    const mensageiro = criarMensageiroFake();
    const contatos = { telefoneDe: async (id: string) => (id === 'emp-1' ? '5581999990000' : null) };

    await avisarPedidoPago({ contatos, mensageiro }, pedidoPago);

    expect(mensageiro.enviadas).toEqual([{ telefone: '5581999990000', texto: 'Novo pedido pago! PED-7KQ2 — R$ 112.00' }]);
  });

  it('não envia nada quando o empreendedor não existe', async () => {
    const mensageiro = criarMensageiroFake();

    await avisarPedidoPago({ contatos: { telefoneDe: async () => null }, mensageiro }, pedidoPago);

    expect(mensageiro.enviadas).toHaveLength(0);
  });
});
