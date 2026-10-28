import { logger } from '../../shared/logger/logger.js';
import { lojaDisponivel, podeUsar } from '../../planos/domain/assinatura.js';
import { relatoriosDoMomento, type PeriodoDoRelatorio } from '../domain/periodos.js';
import { resumirVendas, textoDoRelatorio } from '../domain/relatorio.js';
import type { MensageiroRelatorios } from './ports/avisos-relatorio.js';
import type { LojaDoRelatorio, RelatoriosRepository } from './ports/relatorios.repository.js';

export interface RelatoriosDeps {
  repo: RelatoriosRepository;
  mensageiro: MensageiroRelatorios;
}

/** O texto do relatório de um período, comparado com o período anterior. */
export async function gerarRelatorio(
  repo: Pick<RelatoriosRepository, 'vendas'>,
  loja: Pick<LojaDoRelatorio, 'empreendedorId' | 'fuso'>,
  periodo: PeriodoDoRelatorio,
): Promise<string> {
  const [atual, anterior] = await Promise.all([
    repo.vendas(loja.empreendedorId, periodo),
    repo.vendas(loja.empreendedorId, periodo.anterior),
  ]);
  return textoDoRelatorio(periodo.titulo, resumirVendas(atual, loja.fuso), resumirVendas(anterior, loja.fuso), periodo.comparacao);
}

/** O relatório agendado vale para esta loja agora? Plano, loja no ar e o diário ligado. */
function querRelatorio(loja: LojaDoRelatorio, tipo: 'SEMANAL' | 'DIARIO'): boolean {
  if (!lojaDisponivel(loja.plano)) return false;
  if (tipo === 'SEMANAL') return podeUsar(loja.plano, 'RELATORIO_SEMANAL');
  return loja.relatorioDiario && podeUsar(loja.plano, 'RELATORIO_DIARIO');
}

/**
 * Job: manda o semanal (segunda às 9h, semana anterior) e o diário (8h,
 * ontem) no fuso de cada loja. O registro do envio impede mandar duas vezes,
 * mesmo com o job rodando várias vezes ou o processo reiniciando.
 */
export async function enviarRelatoriosAgendados(deps: RelatoriosDeps, agora: Date = new Date()): Promise<void> {
  for (const loja of await deps.repo.listarLojas()) {
    for (const { tipo, periodo } of relatoriosDoMomento(agora, loja.fuso)) {
      if (!querRelatorio(loja, tipo)) continue;
      try {
        if (!(await deps.repo.registrarEnvio(loja.lojaId, tipo, periodo.chave, agora))) continue;
        const texto = await gerarRelatorio(deps.repo, loja, periodo);
        const rodape = tipo === 'DIARIO' ? '\n\nPara não receber mais o diário, mande *parar relatório diário*.' : '';
        await deps.mensageiro.enviarTexto(loja.telefone, `${texto}${rodape}`);
        logger.info({ lojaId: loja.lojaId, tipo, chave: periodo.chave }, '📊 relatório enviado');
      } catch (erro) {
        logger.error({ err: erro, lojaId: loja.lojaId, tipo }, 'falha ao enviar o relatório');
      }
    }
  }
}
