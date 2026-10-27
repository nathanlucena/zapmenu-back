import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../../shared/errors/domain-error.js';
import type { MelhorEnvioDeps } from './dependencias.js';

/** O link de conexão vale por 1 dia. */
const VALIDADE_DO_LINK_MS = 24 * 60 * 60_000;

function assinatura(conteudo: string, segredo: string): string {
  return createHmac('sha256', segredo).update(conteudo).digest('base64url');
}

/** `state` do OAuth: "<lojaId>.<instante>.<assinatura>". */
export function assinarEstado(lojaId: string, segredo: string, agora: Date): string {
  const conteudo = `${lojaId}.${agora.getTime()}`;
  return `${conteudo}.${assinatura(conteudo, segredo)}`;
}

/** A loja do `state`, se ele é nosso e ainda vale. */
export function lerEstado(estado: string, segredo: string, agora: Date): string | undefined {
  const partes = estado.split('.');
  if (partes.length !== 3) return undefined;
  const [lojaId, instante, recebida] = partes as [string, string, string];
  const esperada = assinatura(`${lojaId}.${instante}`, segredo);
  if (recebida.length !== esperada.length || !timingSafeEqual(Buffer.from(recebida), Buffer.from(esperada))) return undefined;
  if (agora.getTime() - Number(instante) > VALIDADE_DO_LINK_MS) return undefined;
  return lojaId;
}

/** Link para o lojista autorizar o ZapMenu na conta dele do Melhor Envio. */
export async function linkParaConectar(deps: MelhorEnvioDeps, identificador: string): Promise<string | undefined> {
  const conta = await deps.contas.daLoja(identificador);
  if (!conta) return undefined;
  return deps.gateway.urlDeAutorizacao(assinarEstado(conta.lojaId, deps.segredo, deps.relogio?.() ?? new Date()));
}

/** A loja já conectou a conta. */
export async function contaConectada(deps: Pick<MelhorEnvioDeps, 'contas'>, identificador: string): Promise<boolean> {
  return Boolean((await deps.contas.daLoja(identificador))?.tokens);
}

/** Volta do OAuth: troca o código pelos tokens, guarda e avisa a loja na gestão. */
export async function concluirConexao(deps: MelhorEnvioDeps, estado: string, codigo: string): Promise<void> {
  const lojaId = lerEstado(estado, deps.segredo, deps.relogio?.() ?? new Date());
  if (!lojaId) {
    throw new DomainError('Este link de conexão não vale mais. Peça outro na conversa com o ZapMenu.', 'CONEXAO_INVALIDA');
  }
  const conta = await deps.contas.daLoja(lojaId);
  if (!conta) {
    throw new DomainError('Loja não encontrada.', 'LOJA_NAO_ENCONTRADA', 'NAO_ENCONTRADO');
  }
  await deps.contas.salvarTokens(lojaId, await deps.gateway.trocarCodigo(codigo));
  await deps.mensageiro
    .enviarTexto(conta.telefone, '✅ Sua conta do Melhor Envio está conectada! Os clientes já podem escolher o frete por transportadora.')
    .catch(() => undefined);
}

/** Token válido, renovando quando falta menos de 5 min (o refresh também é guardado). */
export async function tokenValido(deps: MelhorEnvioDeps, identificador: string): Promise<{ lojaId: string; telefone: string; accessToken: string } | undefined> {
  const conta = await deps.contas.daLoja(identificador);
  if (!conta?.tokens) return undefined;
  const agora = deps.relogio?.() ?? new Date();
  if (conta.tokens.expiraEm.getTime() - agora.getTime() > 5 * 60_000) {
    return { lojaId: conta.lojaId, telefone: conta.telefone, accessToken: conta.tokens.accessToken };
  }
  const renovados = await deps.gateway.renovar(conta.tokens.refreshToken);
  await deps.contas.salvarTokens(conta.lojaId, renovados);
  return { lojaId: conta.lojaId, telefone: conta.telefone, accessToken: renovados.accessToken };
}
