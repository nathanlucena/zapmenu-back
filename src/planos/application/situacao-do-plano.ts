import type { Assinatura, SituacaoDoPlano } from '../domain/assinatura.js';
import type { AssinaturasRepository } from './ports/assinaturas.repository.js';

/** Plano e status de uma loja, só lendo (vitrine, pedidos). Sem assinatura gravada: undefined, tratado como teste. */
export async function situacaoDoPlano(
  repo: Pick<AssinaturasRepository, 'obter'>,
  identificador: string,
): Promise<SituacaoDoPlano | undefined> {
  const encontrada = await repo.obter(identificador);
  return encontrada?.assinatura && { plano: encontrada.assinatura.plano, status: encontrada.assinatura.status };
}

/**
 * A assinatura de quem fala na gestão: a primeira conversa de uma loja nova é
 * quando o teste de 14 dias começa. undefined = empreendedor ainda não existe.
 */
export async function assinaturaNaGestao(
  repo: Pick<AssinaturasRepository, 'obterOuIniciarTeste'>,
  identificador: string,
  agora: Date = new Date(),
): Promise<Assinatura | undefined> {
  return (await repo.obterOuIniciarTeste(identificador, agora))?.assinatura;
}
