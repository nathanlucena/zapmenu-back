import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/http/app.js';
import { criarMenuRepositoryFake } from '../../src/menu/__mocks__/menu.repository.fake.js';
import { criarItem } from '../../src/menu/menu.service.js';
import { criarOrdersRepositoryFake } from '../../src/orders/__mocks__/orders.repository.fake.js';
import { criarMercadoPagoClientFake } from '../../src/payments/__mocks__/mercado-pago.client.fake.js';
import { criarPaymentsRepositoryFake } from '../../src/payments/__mocks__/payments.repository.fake.js';
import { criarGeradorCobranca, type PaymentsServiceDeps } from '../../src/payments/payments.service.js';
import { criarIdempotencyRepositoryFake } from '../../src/shared/idempotency/__mocks__/idempotency.repository.fake.js';
import { extrairCodigoPedido } from '../../src/orders/orders.service.js';
import { criarWhatsAppClientFake } from '../../src/whatsapp/__mocks__/whatsapp-client.fake.js';
import { registrarOrdersInboundRouter } from '../../src/whatsapp/orders-session/orders-inbound.router.js';
import type { Pedido } from '../../src/orders/orders.types.js';

describe('Fluxo 2 — cliente compra e paga via WhatsApp (e2e in-process)', () => {
  it('carrinho -> confirmação no WhatsApp -> cobrança PIX -> webhook aprova -> pedido pago e empreendedor notificado', async () => {
    const ordersRepo = criarOrdersRepositoryFake();
    const mpClient = criarMercadoPagoClientFake();
    const paymentsRepo = criarPaymentsRepositoryFake();
    const idempotencyWebhook = criarIdempotencyRepositoryFake();
    const notificacoesAoEmpreendedor: Pedido[] = [];

    const paymentsDeps: PaymentsServiceDeps = {
      mpClient,
      paymentsRepo,
      ordersRepo,
      idempotency: idempotencyWebhook,
      notificarEmpreendedor: async (pedido) => {
        notificacoesAoEmpreendedor.push(pedido);
      },
    };

    const menuRepo = criarMenuRepositoryFake();
    const bolo = await criarItem(menuRepo, 'emp-1', { nome: 'Bolo de pote', precoBase: 25, variacoes: [] });

    const app = buildApp({
      menuRepo,
      ordersRepo,
      pedidoTtlMinutos: 20,
      frontendAllowedOrigin: 'http://localhost:3001',
      paymentsDeps,
    });

    // 1. Cliente monta o carrinho no app e o frontend cria o pedido via API.
    const respostaCarrinho = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        empreendedorId: 'emp-1',
        itens: [{ itemCardapioId: bolo.id, quantidade: 2 }],
      },
    });
    expect(respostaCarrinho.statusCode).toBe(201);
    const { pedido } = respostaCarrinho.json() as { pedido: Pedido & { expiraEm: string } };
    expect(pedido.status).toBe('AGUARDANDO_CONFIRMACAO');
    expect(pedido.valorTotal).toBe(50);

    // 2. O app gera o link wa.me com só o código curto; o cliente manda essa mensagem.
    const linkGerado = `Confirmar pedido ${pedido.codigoCurto}`;
    expect(extrairCodigoPedido(linkGerado)).toBe(pedido.codigoCurto);

    const whatsapp = criarWhatsAppClientFake();
    registrarOrdersInboundRouter({
      whatsapp: whatsapp.client,
      ordersRepo,
      idempotency: criarIdempotencyRepositoryFake(),
      geradorCobranca: criarGeradorCobranca(paymentsDeps),
    });

    await whatsapp.emitirMensagem({
      id: 'wpp-msg-1',
      telefone: '5511988887777',
      corpo: linkGerado,
      timestamp: new Date(),
    });

    // 3. Backend gerou a cobrança PIX e respondeu com copia-e-cola + QR code.
    expect(whatsapp.mensagensEnviadas[0]?.conteudo).toContain('Pix copia e cola');
    expect(whatsapp.mensagensEnviadas[1]).toMatchObject({ tipo: 'imagem' });

    const pagamento = await paymentsRepo.buscarPorPedidoId(pedido.id);
    expect(pagamento?.status).toBe('PENDENTE');

    // 4. Mercado Pago avisa via webhook que o PIX foi aprovado.
    mpClient.definirStatusConsulta(pagamento!.idTransacaoExterno, 'approved');
    const respostaWebhook = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/mercado-pago',
      payload: { id: 555, type: 'payment', data: { id: pagamento!.idTransacaoExterno } },
    });
    expect(respostaWebhook.statusCode).toBe(200);

    // 5. Pedido confirmado como pago e empreendedor notificado.
    const pedidoFinal = await ordersRepo.buscarPorId(pedido.id);
    expect(pedidoFinal?.status).toBe('PAGO');
    expect(notificacoesAoEmpreendedor).toHaveLength(1);
    expect(notificacoesAoEmpreendedor[0]?.id).toBe(pedido.id);

    // 6. Reenvio do mesmo evento de webhook não duplica a notificação (idempotência).
    await app.inject({
      method: 'POST',
      url: '/v1/webhooks/mercado-pago',
      payload: { id: 555, type: 'payment', data: { id: pagamento!.idTransacaoExterno } },
    });
    expect(notificacoesAoEmpreendedor).toHaveLength(1);
  });
});
