import { describe, expect, it } from 'vitest';
import type { Pedido } from '../domain/pedido.js';
import { linhasDoPedido } from './resumo-do-pedido.js';

const pedido: Pedido = {
  id: 'p1',
  codigoCurto: 'PED-7KQ2',
  empreendedorId: 'emp-1',
  status: 'PAGO',
  valorTotal: 72,
  taxaEntrega: 12,
  itens: [{ itemCardapioId: 'camiseta', nome: 'Camiseta', quantidade: 1, precoUnitario: 60, variacaoEscolhida: { Tamanho: 'M', Cor: 'Azul' } }],
  expiraEm: new Date('2026-10-23T12:20:00Z'),
  criadoEm: new Date('2026-10-23T12:00:00Z'),
};

describe('linhasDoPedido', () => {
  it('envio pelos Correios mostra o endereço completo e o frete para a loja', () => {
    const linhas = linhasDoPedido({
      ...pedido,
      modalidade: 'ENVIO',
      entrega: { enderecoFormatado: 'Rua da Aurora, 123 - Boa Vista, Recife - PE, 50050-000', numero: '123', uf: 'PE' },
    });

    expect(linhas).toContain('1x Camiseta (Tamanho: M, Cor: Azul) — R$ 60.00');
    expect(linhas).toContain('📦 Enviar pelos Correios para Rua da Aurora, 123 - Boa Vista, Recife - PE, 50050-000 (frete R$ 12.00)');
  });
});
