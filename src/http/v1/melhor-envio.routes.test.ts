import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { criarMenuRepositoryFake } from '../../menu/__mocks__/menu.repository.fake.js';
import { criarOrdersRepositoryFake } from '../../orders/__mocks__/orders.repository.fake.js';
import { criarContasMelhorEnvioFake, criarGatewayMelhorEnvioFake } from '../../envio/__mocks__/melhor-envio.fake.js';
import { assinarEstado } from '../../envio/application/conexao.js';

function montar() {
  const contas = criarContasMelhorEnvioFake({ lojaId: 'loja-1', telefone: '5519999990000', empreendedorId: 'emp-1' });
  const app = buildApp({
    menuRepo: criarMenuRepositoryFake(),
    ordersRepo: criarOrdersRepositoryFake(),
    pedidoTtlMinutos: 20,
    frontendAllowedOrigin: 'http://localhost:3001',
    melhorEnvio: { gateway: criarGatewayMelhorEnvioFake(), contas, mensageiro: { enviarTexto: async () => undefined }, segredo: 's' },
  });
  return { app, contas };
}

describe('GET /v1/melhor-envio/retorno', () => {
  it('conecta a conta e mostra a página de sucesso', async () => {
    const { app, contas } = montar();
    const state = encodeURIComponent(assinarEstado('loja-1', 's', new Date()));
    const resposta = await app.inject({ method: 'GET', url: `/v1/melhor-envio/retorno?code=abc&state=${state}` });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.body).toContain('Conta conectada');
    expect(contas.conta.tokens?.accessToken).toBe('access-abc');
  });

  it('state inválido ou autorização negada: explica e não conecta', async () => {
    const { app, contas } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/melhor-envio/retorno?code=abc&state=lixo' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/v1/melhor-envio/retorno?error=access_denied' })).body).toContain('não foi concluída');
    expect(contas.conta.tokens).toBeUndefined();
  });
});
