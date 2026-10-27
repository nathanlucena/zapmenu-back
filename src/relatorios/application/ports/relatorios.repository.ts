import type { SituacaoDoPlano } from '../../../planos/domain/assinatura.js';
import type { Intervalo, TipoRelatorio } from '../../domain/periodos.js';
import type { PedidoParaRelatorio } from '../../domain/relatorio.js';

export interface LojaDoRelatorio {
  lojaId: string;
  /** Id interno do empreendedor (o mesmo de Pedido.empreendedorId). */
  empreendedorId: string;
  telefone: string;
  fuso: string;
  /** O lojista pode desligar o relatório diário ("parar relatório diário"). */
  relatorioDiario: boolean;
  /** Ausente: loja sem assinatura gravada (tratada como em teste). */
  plano?: SituacaoDoPlano;
}

export interface RelatoriosRepository {
  /** Pelo telefone do dono (gestão). null = ainda não tem loja. */
  lojaDe(identificador: string): Promise<LojaDoRelatorio | null>;
  listarLojas(): Promise<LojaDoRelatorio[]>;
  /** Pedidos que viraram venda (PAGO ou CONFIRMADO, e o que veio depois) com confirmadoEm no intervalo [de, ate). */
  vendas(empreendedorId: string, intervalo: Intervalo): Promise<PedidoParaRelatorio[]>;
  /** Anota o envio; false se esse relatório (tipo + chave) já tinha saído. */
  registrarEnvio(lojaId: string, tipo: TipoRelatorio, chave: string, em: Date): Promise<boolean>;
  definirRelatorioDiario(lojaId: string, ligado: boolean): Promise<void>;
}
