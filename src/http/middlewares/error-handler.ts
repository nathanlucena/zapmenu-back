import { Prisma } from '@prisma/client';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { DomainError, type TipoErroDominio } from '../../shared/errors/domain-error.js';
import { IntegracaoError, type ServicoExterno } from '../../shared/errors/integracao-error.js';
import { logger } from '../../shared/logger/logger.js';

const STATUS_POR_TIPO: Record<TipoErroDominio, number> = {
  REGRA_VIOLADA: 400,
  NAO_ENCONTRADO: 404,
  CONFLITO: 409,
  INDISPONIVEL: 503,
};

interface RespostaDeErro {
  status: number;
  codigo: string;
  erro: string;
}

/** Erros que o próprio Fastify gera ao ler a requisição (corpo, formato, tamanho). */
const ERROS_DA_REQUISICAO: Record<string, Omit<RespostaDeErro, 'status'>> = {
  FST_ERR_CTP_INVALID_JSON_BODY: { codigo: 'CORPO_INVALIDO', erro: 'O corpo da requisição não é um JSON válido.' },
  FST_ERR_CTP_EMPTY_JSON_BODY: { codigo: 'CORPO_INVALIDO', erro: 'O corpo da requisição está vazio.' },
  FST_ERR_CTP_BODY_TOO_LARGE: { codigo: 'CORPO_GRANDE_DEMAIS', erro: 'A requisição é grande demais.' },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: { codigo: 'FORMATO_NAO_SUPORTADO', erro: 'Formato não suportado. Envie JSON.' },
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: { codigo: 'CORPO_INVALIDO', erro: 'O tamanho informado não bate com o corpo.' },
};

const MENSAGEM_DO_SERVICO: Record<ServicoExterno, string> = {
  mercado_pago: 'O pagamento está fora do ar agora. Tente de novo em instantes.',
  viacep: 'A busca de endereço está fora do ar agora. Tente de novo em instantes.',
  google: 'A busca de endereço está fora do ar agora. Tente de novo em instantes.',
  transcricao: 'A transcrição de áudio está fora do ar agora. Tente de novo em instantes.',
  deepseek: 'A IA está fora do ar agora. Tente de novo em instantes.',
  melhor_envio: 'Não conseguimos calcular o frete agora. Tente de novo em instantes.',
};

/** Falhas do banco que têm uma resposta melhor que "erro interno". */
function erroDoBanco(error: unknown): RespostaDeErro | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return { status: 409, codigo: 'REGISTRO_DUPLICADO', erro: 'Já existe um registro com esses dados.' };
    }
    if (error.code === 'P2025') {
      return { status: 404, codigo: 'REGISTRO_NAO_ENCONTRADO', erro: 'O registro não existe mais.' };
    }
    if (error.code === 'P1001' || error.code === 'P1008' || error.code === 'P2024') {
      return bancoIndisponivel();
    }
  }
  if (error instanceof Prisma.PrismaClientInitializationError || error instanceof Prisma.PrismaClientRustPanicError) {
    return bancoIndisponivel();
  }
  return undefined;
}

function bancoIndisponivel(): RespostaDeErro {
  return {
    status: 503,
    codigo: 'BANCO_INDISPONIVEL',
    erro: 'Estamos com instabilidade agora. Tente de novo em instantes.',
  };
}

/**
 * Toda resposta de erro sai como `{ erro, codigo }`. O que não tem tratamento
 * próprio vira 500 com um código de rastreio, o mesmo que vai para o log.
 */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof DomainError) {
    reply.status(STATUS_POR_TIPO[error.tipo]).send({ erro: error.message, codigo: error.code });
    return;
  }

  if (error instanceof IntegracaoError) {
    logger.error({ err: error, servico: error.servico, rastreio: request.id }, 'falha em serviço externo');
    reply.status(503).send({ erro: MENSAGEM_DO_SERVICO[error.servico], codigo: 'SERVICO_INDISPONIVEL' });
    return;
  }

  const daRequisicao = error.code ? ERROS_DA_REQUISICAO[error.code] : undefined;
  if (daRequisicao) {
    reply.status(error.statusCode ?? 400).send(daRequisicao);
    return;
  }

  const doBanco = erroDoBanco(error);
  if (doBanco) {
    logger.error({ err: error, rastreio: request.id }, 'falha no banco');
    reply.status(doBanco.status).send({ erro: doBanco.erro, codigo: doBanco.codigo });
    return;
  }

  // Outros erros 4xx do Fastify (ex.: cabeçalho inválido): mantém o status.
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    reply.status(error.statusCode).send({ erro: 'Requisição inválida.', codigo: 'REQUISICAO_INVALIDA' });
    return;
  }

  logger.error({ err: error, rastreio: request.id }, 'Erro não tratado na API');
  reply
    .status(500)
    .send({ erro: 'Erro interno. Tente de novo em instantes.', codigo: 'ERRO_INTERNO', rastreio: request.id });
}

/** Rota que não existe, no mesmo formato dos outros erros. */
export function rotaNaoEncontrada(request: FastifyRequest, reply: FastifyReply): void {
  reply
    .status(404)
    .send({ erro: `Rota não encontrada: ${request.method} ${request.url}`, codigo: 'ROTA_NAO_ENCONTRADA' });
}
