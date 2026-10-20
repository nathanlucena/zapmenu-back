import { beforeEach, describe, expect, it } from 'vitest';
import { criarWhatsAppClientFake, type WhatsAppClientFake } from '../__mocks__/whatsapp-client.fake.js';
import { criarOrdersRepositoryFake } from '../../orders/__mocks__/orders.repository.fake.js';
import { criarIdempotencyRepositoryFake } from '../../shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { criarPedido } from '../../orders/orders.service.js';
import type { OrdersRepository } from '../../orders/orders.repository.js';
import { registrarOrdersInboundRouter, type GeradorCobranca } from './orders-inbound.router.js';
import type { MensagemRecebida } from '../whatsapp-client.interface.js';

function mensagem(overrides: Partial<MensagemRecebida> = {}): MensagemRecebida {
  return { id: 'msg-1', telefone: '5511988887777', corpo: '', timestamp: new Date(), ...overrides };
}

function geradorCobrancaFake(): GeradorCobranca {
  return {
    async gerarCobranca() {
      return { copiaCola: '00020126...pix', qrCodeBase64: 'data:image/png;base64,ABC' };
    },
  };
}

describe('orders-inbound.router', () => {
  let whatsapp: WhatsAppClientFake;
  let ordersRepo: OrdersRepository;

  beforeEach(() => {
    whatsapp = criarWhatsAppClientFake();
    ordersRepo = criarOrdersRepositoryFake();
  });

  it('confirma pedido, gera cobrança e envia copia-e-cola + QR code', async () => {
    const pedido = await criarPedido(
      ordersRepo,
      { empreendedorId: 'emp-1', itens: [{ itemCardapioId: 'i1', quantidade: 1, precoUnitario: 25 }] },
      20,
    );

    registrarOrdersInboundRouter({
      whatsapp: whatsapp.client,
      ordersRepo,
      idempotency: criarIdempotencyRepositoryFake(),
      geradorCobranca: geradorCobrancaFake(),
    });

    await whatsapp.emitirMensagem(mensagem({ corpo: `Confirmar pedido ${pedido.codigoCurto}` }));

    expect(whatsapp.mensagensEnviadas[0]?.conteudo).toContain('00020126...pix');
    expect(whatsapp.mensagensEnviadas[1]).toMatchObject({ tipo: 'imagem', conteudo: 'data:image/png;base64,ABC' });

    const atualizado = await ordersRepo.buscarPorCodigo(pedido.codigoCurto);
    expect(atualizado?.status).toBe('AGUARDANDO_PAGAMENTO');
    expect(atualizado?.telefoneCliente).toBe('5511988887777');
  });

  it('responde com erro amigável quando o código não existe', async () => {
    registrarOrdersInboundRouter({
      whatsapp: whatsapp.client,
      ordersRepo,
      idempotency: criarIdempotencyRepositoryFake(),
      geradorCobranca: geradorCobrancaFake(),
    });

    await whatsapp.emitirMensagem(mensagem({ corpo: 'Confirmar pedido PED-ZZZZ' }));

    expect(whatsapp.mensagensEnviadas[0]?.conteudo).toContain('não encontrado');
  });

  it('pede o código quando a mensagem não contém um', async () => {
    registrarOrdersInboundRouter({
      whatsapp: whatsapp.client,
      ordersRepo,
      idempotency: criarIdempotencyRepositoryFake(),
      geradorCobranca: geradorCobrancaFake(),
    });

    await whatsapp.emitirMensagem(mensagem({ corpo: 'oi, quero pagar' }));

    expect(whatsapp.mensagensEnviadas[0]?.conteudo).toContain('Não encontrei o código');
  });

  it('não reprocessa mensagem já marcada como idempotente', async () => {
    const idempotency = criarIdempotencyRepositoryFake();
    await idempotency.marcarProcessado('wppconnect_orders', 'msg-1');

    registrarOrdersInboundRouter({
      whatsapp: whatsapp.client,
      ordersRepo,
      idempotency,
      geradorCobranca: geradorCobrancaFake(),
    });

    await whatsapp.emitirMensagem(mensagem({ corpo: 'Confirmar pedido PED-ZZZZ' }));

    expect(whatsapp.mensagensEnviadas).toHaveLength(0);
  });
});
