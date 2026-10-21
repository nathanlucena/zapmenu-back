import { describe, expect, it } from 'vitest';
import type { Pedido } from '../domain/pedido.js';
import { avisarPedidoPago } from './avisar-pedido-pago.js';

const pedidoPago: Pedido = {
  id: 'pedido-1',
  codigoCurto: 'PED-7KQ2',
  empreendedorId: 'emp-1',
  status: 'PAGO',
  valorTotal: 112,
  itens: [
    { itemCardapioId: 'i1', nome: 'Calabresa', quantidade: 2, precoUnitario: 49, variacaoEscolhida: { Tamanho: 'G' }, observacao: 'bem assada' },
    { itemCardapioId: 'i2', nome: 'Coca 2L', quantidade: 1, precoUnitario: 14 },
  ],
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
  it('manda os itens, a retirada e o total para o telefone do empreendedor', async () => {
    const mensageiro = criarMensageiroFake();
    const contatos = { telefoneDe: async (id: string) => (id === 'emp-1' ? '5581999990000' : null) };

    await avisarPedidoPago({ contatos, mensageiro }, pedidoPago);

    expect(mensageiro.enviadas).toEqual([
      {
        telefone: '5581999990000',
        texto: [
          '✅ Pedido pago! PED-7KQ2 — R$ 112.00',
          '',
          '2x Calabresa (Tamanho: G) — R$ 98.00',
          '   📝 bem assada',
          '1x Coca 2L — R$ 14.00',
          '',
          '🏪 Retirada na loja',
          '💰 Total: R$ 112.00 — PIX',
        ].join('\n'),
      },
    ]);
  });

  it('não envia nada quando o empreendedor não existe', async () => {
    const mensageiro = criarMensageiroFake();

    await avisarPedidoPago({ contatos: { telefoneDe: async () => null }, mensageiro }, pedidoPago);

    expect(mensageiro.enviadas).toHaveLength(0);
  });

  it('inclui o cliente com o telefone em link do WhatsApp, a entrega e a observação', async () => {
    const mensageiro = criarMensageiroFake();
    const contatos = { telefoneDe: async () => '5581999990000' };

    await avisarPedidoPago(
      { contatos, mensageiro },
      {
        ...pedidoPago,
        modalidade: 'ENTREGA',
        taxaEntrega: 5,
        nomeCliente: 'Ana',
        telefoneCliente: '5581988887777',
        observacao: 'Tocar o interfone 201',
        entrega: {
          enderecoFormatado: 'Rua da Aurora, 123 - Boa Vista, Recife - PE (apto 201)',
          numero: '123',
          latitude: -8.0591,
          longitude: -34.8798,
          distanciaKm: 1.05,
        },
      },
    );

    const texto = mensageiro.enviadas[0]?.texto ?? '';
    expect(texto.split('\n')[1]).toBe('👤 Ana · 📞 wa.me/5581988887777');
    expect(texto).toContain('🛵 Entrega em Rua da Aurora, 123 - Boa Vista, Recife - PE (apto 201) (taxa R$ 5.00)');
    expect(texto).toContain('📝 Tocar o interfone 201');
  });
});
