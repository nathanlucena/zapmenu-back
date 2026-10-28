import { DomainError } from '../../shared/errors/domain-error.js';
import type { Pedido } from '../../orders/domain/pedido.js';
import type { MelhorEnvioDeps } from './dependencias.js';
import { tokenValido } from './conexao.js';
import { produtosDoPacote } from './cotador.js';

/** Pedidos que já podem ganhar etiqueta: pagos (ou separados), por Melhor Envio, ainda sem etiqueta. */
const STATUS_COM_ETIQUETA = ['PAGO', 'SEPARADO'];

export interface EtiquetaGerada {
  etiquetaId: string;
  pdf: Uint8Array;
  rastreio?: string;
  transportadora: string;
}

/**
 * "gerar etiqueta do PED-XXXX": compra a etiqueta com o saldo do lojista no
 * Melhor Envio e devolve o PDF. Quem marca o pedido como ENVIADO e avisa o
 * cliente é a gestão, com o rastreio daqui.
 */
export async function gerarEtiqueta(deps: MelhorEnvioDeps, pedido: Pedido): Promise<EtiquetaGerada> {
  if (pedido.modalidade !== 'MELHOR_ENVIO' || !pedido.servicoEnvio || !pedido.entrega) {
    throw new DomainError(`O pedido ${pedido.codigoCurto} não é por transportadora (Melhor Envio).`, 'ETIQUETA_INDISPONIVEL');
  }
  if (pedido.etiquetaId) {
    throw new DomainError(`O pedido ${pedido.codigoCurto} já tem etiqueta.`, 'ETIQUETA_REPETIDA', 'CONFLITO');
  }
  if (!STATUS_COM_ETIQUETA.includes(pedido.status)) {
    throw new DomainError(`A etiqueta sai depois do pagamento: o pedido ${pedido.codigoCurto} ainda não foi pago.`, 'ETIQUETA_INDISPONIVEL');
  }
  const token = await tokenValido(deps, pedido.empreendedorId);
  const remetente = token && (await deps.contas.remetente(token.lojaId));
  if (!token || !remetente) {
    throw new DomainError('Conecte sua conta do Melhor Envio para gerar etiquetas: mande *conectar melhor envio*.', 'ETIQUETA_INDISPONIVEL');
  }
  const produtos = await produtosDoPacote(deps, pedido.itens);
  const entrega = pedido.entrega;
  const comprada = await deps.gateway.comprarEtiqueta(token.accessToken, {
    servicoId: pedido.servicoEnvio.id,
    referencia: pedido.codigoCurto,
    de: remetente,
    para: {
      nome: pedido.nomeCliente ?? 'Cliente',
      telefone: pedido.telefoneCliente,
      cep: entrega.cep ?? '',
      logradouro: entrega.logradouro ?? '',
      numero: entrega.numero,
      complemento: entrega.complemento,
      bairro: entrega.bairro,
      cidade: entrega.cidade,
      uf: entrega.uf,
    },
    produtos,
  });
  const pdf = await deps.gateway.baixarEtiqueta(token.accessToken, comprada.etiquetaId);
  return { etiquetaId: comprada.etiquetaId, pdf, rastreio: comprada.rastreio, transportadora: pedido.servicoEnvio.empresa };
}
