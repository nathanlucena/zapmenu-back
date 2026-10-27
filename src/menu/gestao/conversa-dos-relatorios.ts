import { podeUsar, type SituacaoDoPlano } from '../../planos/domain/assinatura.js';
import { mensagemRecursoDoPlano } from '../../planos/application/mensagens.js';
import { hojeAteAgora, mesAteAgora, ontem, ultimos7Dias } from '../../relatorios/domain/periodos.js';
import { gerarRelatorio, type RelatoriosDeps } from '../../relatorios/application/relatorios.js';
import { reconhecerComandoDeRelatorio } from './comandos.js';

export interface ConversaDosRelatorios {
  relatorios: RelatoriosDeps;
  telefone: string;
  texto: string;
  /** Ausente: planos desligados (tudo liberado). */
  plano?: SituacaoDoPlano;
  linkDosPlanos?: string;
  agora?: Date;
}

const PERIODOS = { SEMANA: ultimos7Dias, MES: mesAteAgora, HOJE: hojeAteAgora, ONTEM: ontem } as const;

/**
 * "relatório", "relatório do mês", "vendas de hoje", "vendas de ontem" e o
 * liga/desliga do diário. Sem IA. undefined = a mensagem não é sobre relatório.
 */
export async function conversaDosRelatorios(conversa: ConversaDosRelatorios): Promise<string[] | undefined> {
  const comando = reconhecerComandoDeRelatorio(conversa.texto);
  if (!comando) {
    return undefined;
  }
  const recurso = comando === 'PARAR_DIARIO' || comando === 'LIGAR_DIARIO' ? 'RELATORIO_DIARIO' : 'RELATORIO_SEMANAL';
  if (conversa.plano && !podeUsar(conversa.plano, recurso)) {
    return [mensagemRecursoDoPlano(recurso, conversa.linkDosPlanos)];
  }
  const loja = await conversa.relatorios.repo.lojaDe(conversa.telefone);
  if (!loja) {
    return ['Ainda não há vendas: termine o cadastro da loja e os relatórios aparecem aqui. 🙂'];
  }
  if (comando === 'PARAR_DIARIO') {
    await conversa.relatorios.repo.definirRelatorioDiario(loja.lojaId, false);
    return ['Combinado, não mando mais o relatório diário. O semanal continua toda segunda às 9h. Para voltar, mande *voltar relatório diário*.'];
  }
  if (comando === 'LIGAR_DIARIO') {
    await conversa.relatorios.repo.definirRelatorioDiario(loja.lojaId, true);
    return ['Pronto! O relatório de ontem chega todo dia às 8h.'];
  }
  const periodo = PERIODOS[comando](conversa.agora ?? new Date(), loja.fuso);
  return [await gerarRelatorio(conversa.relatorios.repo, loja, periodo)];
}
