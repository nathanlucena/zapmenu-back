import type { FastifyInstance } from 'fastify';
import type { MelhorEnvioDeps } from '../../envio/application/dependencias.js';
import { concluirConexao } from '../../envio/application/conexao.js';
import { DomainError } from '../../shared/errors/domain-error.js';
import { logger } from '../../shared/logger/logger.js';

/** Página simples de volta do Melhor Envio: a conversa continua no WhatsApp. */
function pagina(titulo: string, texto: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#18201b"><h1 style="font-size:1.5rem">${titulo}</h1><p>${texto}</p></body></html>`;
}

/** Retorno do OAuth do Melhor Envio (o lojista autorizou na conta dele). */
export function registerMelhorEnvioRoutes(app: FastifyInstance, deps: MelhorEnvioDeps): void {
  app.get('/melhor-envio/retorno', async (request, reply) => {
    const { code, state, error } = request.query as Record<string, string | undefined>;
    reply.type('text/html; charset=utf-8');
    if (error || !code || !state) {
      return pagina('Conexão não concluída', 'A autorização não foi concluída. Peça um link novo na conversa com o ZapMenu (mande <b>conectar melhor envio</b>).');
    }
    try {
      await concluirConexao(deps, state, code);
      return pagina('Conta conectada ✅', 'Pronto! Sua conta do Melhor Envio está conectada ao ZapMenu. Pode voltar para o WhatsApp.');
    } catch (erro) {
      if (erro instanceof DomainError) {
        return reply.status(400).send(pagina('Conexão não concluída', erro.message));
      }
      logger.error({ err: erro }, 'falha ao concluir a conexão com o Melhor Envio');
      return reply.status(502).send(pagina('Conexão não concluída', 'O Melhor Envio não respondeu agora. Tente de novo em instantes.'));
    }
  });
}
