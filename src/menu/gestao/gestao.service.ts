import { logger as loggerRaiz, trecho } from '../../shared/logger/logger.js';
import { DomainError } from '../../shared/errors/domain-error.js';
import type { ConversationRepository } from '../conversation/conversation.repository.js';
import { contextoInicial, type Contexto, type DadosLoja, type Estado } from '../conversation/conversation-state.types.js';
import {
  cadastroCompleto,
  descreverObrigatorios,
  obrigatoriosDaLoja,
  opcionaisDaLoja,
  type LojaParaCadastro,
} from '../cadastro-da-loja.js';
import { buscarEndereco, linkMapa, normalizarCep } from '../endereco/endereco.service.js';
import type { EnderecoDeps } from '../endereco/endereco.types.js';
import { descreverTaxaFixa, entregaConfigurada, entregaEmUso } from '../entrega.js';
import type { CadastroEmpreendedores } from './cadastro-empreendedores.js';
import { reconhecerComando } from './comandos.js';
import { filtrarPorTipo } from './permissoes-por-tipo.js';
import { filtrarPorPlano } from './permissoes-por-plano.js';
import { podeUsar, type Assinatura } from '../../planos/domain/assinatura.js';
import type { PlanosDeps } from '../../planos/application/dependencias.js';
import { assinaturaNaGestao } from '../../planos/application/situacao-do-plano.js';
import { mensagemLojaSuspensa, mensagemRecursoDoPlano } from '../../planos/application/mensagens.js';
import { conversaDoPlano } from './conversa-do-plano.js';
import { conversaDosRelatorios } from './conversa-dos-relatorios.js';
import { problemasDoGuia, tabelaEmTexto } from '../guia-medidas/guia-medidas.js';
import type { GuiasRepository } from '../guia-medidas/guias.repository.js';
import type { RelatoriosDeps } from '../../relatorios/application/relatorios.js';
import { conversaDasPromocoes, proporPromocao, type ConversaDasPromocoes, type PromocoesDeps } from './conversa-das-promocoes.js';
import { diaNoFuso } from '../../planos/domain/calendario.js';
import { NOMES_DOS_DIAS, diaEMinutoNoFuso } from '../../promocoes/domain/promocao.js';
import {
  ehOpcaoDaEnquete,
  oQueMudaNaTroca,
  OPCOES_TIPO,
  PERGUNTA_TIPO,
  TEXTO_PERGUNTA_TIPO,
  tipoDaResposta,
  vocabulario,
} from './tipo-da-loja.js';
import { montarPrevia, type PreviasRepository } from './previa.js';
import type { GestaoRepository, SnapshotCardapio } from './gestao.repository.js';
import type { InterpretadorMensagem, RespostaConversa } from './interpretador.js';
import {
  aplicarOperacoes,
  confirmarEndereco,
  contarAlteracoes,
  descreverAlteracoes,
  descreverFaixas,
  descreverGrade,
  estaVazio,
  formatarHorarios,
  formatarPreco,
  montarResumo,
  pendenciasParaSalvar,
  recusarEndereco,
} from './rascunho.js';

const logger = loggerRaiz.child({ modulo: 'gestao' });

/** Rascunho parado há mais que isso: o bot relembra o que está pendente. */
const LEMBRETE_APOS_MS = 30 * 60_000;
/** Rascunho parado há mais que isso: é descartado. */
const EXPIRA_APOS_MS = 24 * 60 * 60_000;
/** Intervalo mínimo entre dois lembretes dos dados opcionais da loja. */
const LEMBRETE_OPCIONAIS_MS = 7 * 24 * 60 * 60_000;
/** Mensagens da conversa enviadas à IA como memória. */
const MAX_HISTORICO = 20;
/** Tamanho máximo de cada mensagem guardada no histórico. */
const MAX_CARACTERES_HISTORICO = 500;

export const RESPOSTA_NUMERO_SEM_ACESSO =
  'Este número ainda não está cadastrado no ZapMenu. Fale com a gente para liberar o acesso.';

export interface GestaoDeps {
  conversationRepo: ConversationRepository;
  gestaoRepo: GestaoRepository;
  /** Sem interpretador a conversa livre não funciona (só as palavras-chave). */
  interpretador?: InterpretadorMensagem;
  /** Sem ele (sem chave do Google) o cadastro de endereço avisa que está indisponível. */
  endereco?: EnderecoDeps;
  cadastro: CadastroEmpreendedores;
  /** Link público do cardápio pelo slug, para mandar quando a loja entra no ar. */
  urlDoCardapio?: (slug: string) => string;
  /** Prévia em imagem das alterações: onde guardar e a URL da imagem no front. Sem isso, só texto. */
  previas?: { repo: PreviasRepository; urlDaImagem: (id: string) => string };
  /** Planos e assinatura. Sem isso, a gestão não limita nada (como antes dos planos). */
  planos?: PlanosDeps;
  /** Guias de medidas (loja, Profissional). Sem isso, a gestão diz que não está disponível. */
  guias?: GuiasRepository;
  /** Conta do Melhor Envio da loja (link de conexão). Sem isso, o envio por transportadora fica indisponível. */
  melhorEnvio?: {
    linkParaConectar(telefone: string): Promise<string | undefined>;
    conectada(telefone: string): Promise<boolean>;
  };
  /** Promoções da loja. Sem isso, a gestão responde que ainda não estão disponíveis. */
  promocoes?: PromocoesDeps;
  /** Relatórios de vendas pedidos na conversa. Sem isso, "relatório" vai para a IA. */
  relatorios?: RelatoriosDeps;
}

export interface MensagemGestao {
  telefone: string;
  texto: string;
  imagemUrl?: string;
}

/** Estado de uma rodada: lido do banco, alterado pelos passos, salvo no fim. */
interface Rodada {
  deps: GestaoDeps;
  mensagem: MensagemGestao;
  empreendedorId: string;
  snapshot: SnapshotCardapio;
  /** Ausente quando os planos estão desligados: nada é limitado. */
  assinatura?: Assinatura;
  estado: Estado;
  contexto: Contexto;
  respostas: RespostaGestao[];
}

/**
 * Processa uma mensagem do empreendedor e devolve as respostas a enviar.
 *
 * A conversa acumula um rascunho de alterações; a IA só propõe operações sobre
 * ele. Quando a IA percebe que a pessoa terminou, este serviço monta o resumo
 * e só grava no banco depois do "sim".
 */
/** Texto, ou a imagem da prévia (URL que o WhatsApp baixa) com legenda. */
export type RespostaGestao =
  | string
  | { imagemUrl: string; legenda: string }
  /** Enquete do WhatsApp; o voto volta como mensagem de texto com a opção escolhida. */
  | { enquete: { pergunta: string; opcoes: string[] } };

export async function processarMensagemGestao(mensagem: MensagemGestao, deps: GestaoDeps): Promise<RespostaGestao[]> {
  const empreendedorId = await deps.cadastro.empreendedorIdDoTelefone(mensagem.telefone);
  if (!empreendedorId) {
    logger.info({ telefone: mensagem.telefone }, '🚫 número sem acesso à gestão');
    return [RESPOSTA_NUMERO_SEM_ACESSO];
  }
  const conversa = await deps.conversationRepo.obterOuCriar(mensagem.telefone);

  const rodada: Rodada = {
    deps,
    mensagem,
    empreendedorId,
    snapshot: await deps.gestaoRepo.carregarSnapshot(empreendedorId),
    // Depois do snapshot, que cria o empreendedor na primeira conversa: é aí que o teste começa.
    assinatura: deps.planos ? await assinaturaNaGestao(deps.planos.repo, empreendedorId) : undefined,
    estado: conversa.estado,
    contexto: conversa.contexto,
    respostas: [],
  };
  const estadoAnterior = rodada.estado;

  verificarAbandono(rodada);
  await tratar(rodada);
  // Começo de conversa: mostra o que falta no cadastro ou, com a loja no ar, lembra dos opcionais.
  if (estadoAnterior === 'OCIOSO' && rodada.estado !== 'OCIOSO') {
    if (!cadastroCompleto(lojaParaCadastro(rodada))) {
      const loja = lojaParaCadastro(rodada, rodada.contexto.rascunho.loja);
      responder(rodada, `Para sua loja entrar no ar ainda faltam alguns dados:\n${descreverObrigatorios(loja)}`);
      avisarEntregaPorConfigurar(rodada);
    } else {
      avisarEntregaPorConfigurar(rodada);
      await lembrarOpcionaisSeDevido(rodada);
    }
  }

  await avisarFimDoFreteFixo(rodada);

  rodada.contexto.atualizadoEm = new Date().toISOString();
  logger.info(
    {
      telefone: mensagem.telefone,
      transicao: `${estadoAnterior} → ${rodada.estado}`,
      alteracoesNoRascunho: contarAlteracoes(rodada.contexto.rascunho),
    },
    '🗂️  conversa de gestão',
  );
  await deps.conversationRepo.salvar({ ...conversa, estado: rodada.estado, contexto: rodada.contexto });
  return rodada.respostas;
}

// ---------------------------------------------------------------------------
// Fluxo
// ---------------------------------------------------------------------------

function verificarAbandono(rodada: Rodada): void {
  const { atualizadoEm, rascunho } = rodada.contexto;
  if (rodada.estado === 'OCIOSO' || !atualizadoEm) {
    return;
  }
  const parado = Date.now() - new Date(atualizadoEm).getTime();

  if (parado > EXPIRA_APOS_MS) {
    const tinhaAlteracoes = !estaVazio(rascunho);
    reiniciar(rodada);
    if (tinhaAlteracoes) {
      responder(rodada, '⌛ As alterações que você tinha deixado pendentes expiraram e foram descartadas.');
    }
    return;
  }
  if (parado > LEMBRETE_APOS_MS && !estaVazio(rascunho)) {
    responder(
      rodada,
      [
        '👋 Você tinha alterações pendentes (ainda não salvas):',
        ...descreverAlteracoes(rascunho, rodada.snapshot),
        '',
        'Vamos continuar de onde parou? Se preferir descartar, mande *cancelar*.',
      ].join('\n'),
    );
  }
}

async function tratar(rodada: Rodada): Promise<void> {
  const { texto, imagemUrl } = rodada.mensagem;
  if (await tratarPlano(rodada)) {
    return;
  }
  if (await tratarPromocoes(rodada)) {
    return;
  }
  if (await tratarRelatorios(rodada)) {
    return;
  }
  if (await tratarGuiaPendente(rodada)) {
    return;
  }
  if (rodada.snapshot.lojaSalva.tipoPendente) {
    await escolherTipoNoCadastro(rodada);
    return;
  }
  if (rodada.contexto.trocaDeTipo) {
    await continuarTrocaDeTipo(rodada);
    return;
  }
  if (fotoDaSequencia(rodada)) {
    return;
  }
  if (ehOpcaoDaEnquete(texto)) {
    // Voto numa enquete antiga do tipo: sem passar pela IA.
    responder(rodada, `Sua loja está como *${vocabulario(rodada.snapshot.segmento).tipo}*. Para trocar, mande *mudar tipo da loja*.`);
    return;
  }
  const comando = !imagemUrl && texto.trim() ? reconhecerComando(texto) : undefined;

  if (rodada.contexto.enderecoPendente && (comando === 'SIM' || comando === 'NAO')) {
    responderSobreEndereco(rodada, comando === 'SIM');
    return;
  }

  switch (comando) {
    case 'CANCELAR': {
      const tinhaAlteracoes = !estaVazio(rodada.contexto.rascunho);
      reiniciar(rodada);
      const { lista } = vocabulario(rodada.snapshot.segmento);
      responder(
        rodada,
        tinhaAlteracoes
          ? `🗑️ Ok, descartei as alterações. Nada foi mudado no ${lista}.`
          : `Ok! Quando quiser mexer no ${lista} é só me chamar. 😊`,
      );
      return;
    }
    case 'CARDAPIO':
      responder(rodada, descreverCardapio(rodada.snapshot, entregaPorDistancia(rodada)));
      return;
    case 'PENDENCIAS':
      responder(rodada, descreverPendencias(rodada));
      return;
    case 'PREVIA':
      if (!recursoLiberado(rodada, 'PREVIA_IMAGEM')) {
        responder(rodada, mensagemRecursoDoPlano('PREVIA_IMAGEM', rodada.deps.planos?.linkDosPlanos));
      } else if (!rodada.deps.previas) {
        responder(rodada, 'A prévia em imagem não está disponível agora. O resumo em texto continua: diga *pronto* quando terminar.');
      } else if (await responderPrevia(rodada, `Assim vai ficar no ${vocabulario(rodada.snapshot.segmento).lista} 👇`)) {
        responder(rodada, 'Quando terminar, diga *pronto* para revisar e salvar.');
      } else {
        responder(rodada, 'Ainda não tem nenhum item ou dado da loja anotado para mostrar. Me conta o que você quer mudar! 🙂');
      }
      return;
    case 'MUDAR_TIPO':
      comecarTrocaDeTipo(rodada);
      return;
    case 'CONECTAR_MELHOR_ENVIO':
      responder(rodada, await textoDeConexaoDoMelhorEnvio(rodada));
      return;
    case 'NAO_LEMBRAR':
      await rodada.deps.gestaoRepo.registrarLembreteOpcionais(rodada.empreendedorId, { desligar: true });
      responder(rodada, 'Combinado, não lembro mais dos dados opcionais. Se quiser ver o que falta, mande *o que falta*. 🙂');
      return;
    case 'SIM':
      if (rodada.estado === 'CONFIRMANDO') {
        await salvar(rodada);
        return;
      }
      break;
    case 'NAO':
      if (rodada.estado === 'CONFIRMANDO') {
        rodada.estado = 'CONVERSANDO';
        registrarHistorico(rodada, 'Sem problemas! O que você quer ajustar?');
        responder(rodada, 'Sem problemas! O que você quer ajustar?');
        return;
      }
      break;
  }

  await conversarComIA(rodada);
}

/**
 * Assinatura antes de tudo: os comandos do plano funcionam em qualquer etapa e,
 * com a loja suspensa, são a única coisa que a gestão aceita.
 */
async function tratarPlano(rodada: Rodada): Promise<boolean> {
  const { planos } = rodada.deps;
  if (!planos) {
    return false;
  }
  const respostas = rodada.mensagem.imagemUrl
    ? undefined
    : await conversaDoPlano({
        planos,
        telefone: rodada.mensagem.telefone,
        texto: rodada.mensagem.texto,
        contexto: rodada.contexto,
        assinatura: rodada.assinatura,
      });
  if (respostas) {
    respostas.forEach((resposta) => responder(rodada, resposta));
    return true;
  }
  if (rodada.assinatura?.status === 'SUSPENSA') {
    responder(rodada, mensagemLojaSuspensa());
    return true;
  }
  return false;
}

/** Dados que a conversa das promoções precisa de uma rodada. */
function conversaDasPromocoesDa(rodada: Rodada, promocoes: PromocoesDeps): ConversaDasPromocoes {
  return {
    promocoes,
    telefone: rodada.mensagem.telefone,
    texto: rodada.mensagem.texto,
    contexto: rodada.contexto,
    snapshot: rodada.snapshot,
    plano: rodada.assinatura,
    linkDosPlanos: rodada.deps.planos?.linkDosPlanos,
    previas: recursoLiberado(rodada, 'PREVIA_IMAGEM') ? rodada.deps.previas : undefined,
  };
}

/** "minhas promoções", pausar/reativar/remover e o "sim" de uma promoção mostrada. */
async function tratarPromocoes(rodada: Rodada): Promise<boolean> {
  const { promocoes } = rodada.deps;
  if (!promocoes || rodada.mensagem.imagemUrl) {
    return false;
  }
  const respostas = await conversaDasPromocoes(conversaDasPromocoesDa(rodada, promocoes));
  respostas?.forEach((resposta) => rodada.respostas.push(resposta));
  return Boolean(respostas);
}

/** Mostra a tabela que a IA montou e guarda para o "sim". */
function proporGuia(
  rodada: Rodada,
  alvo: NonNullable<Contexto['guiaPendente']>['alvo'],
  guia: NonNullable<Contexto['guiaPendente']>['guia'],
): void {
  if (!rodada.deps.guias) {
    responder(rodada, 'O guia de medidas ainda não está disponível por aqui.');
    return;
  }
  const existe =
    alvo.tipo === 'ITEM'
      ? rodada.snapshot.itens.some((item) => item.id === alvo.id)
      : rodada.snapshot.categorias.some((categoria) => categoria.id === alvo.id);
  const problemas = existe ? problemasDoGuia(guia) : ['não achei o produto ou a categoria do guia'];
  if (problemas.length > 0) {
    responder(rodada, `Não consegui montar o guia de medidas: ${problemas.join('; ')}. Pode mandar de novo?`);
    return;
  }
  const nomeDoAlvo =
    alvo.tipo === 'ITEM'
      ? rodada.snapshot.itens.find((item) => item.id === alvo.id)?.nome
      : `categoria ${rodada.snapshot.categorias.find((categoria) => categoria.id === alvo.id)?.nome}`;
  rodada.contexto.guiaPendente = { alvo, guia };
  responder(rodada, [`📏 *${guia.nome}* (${nomeDoAlvo})`, tabelaEmTexto(guia), '', 'Confirma? (*sim*/*não*)'].join('\n'));
}

/** "sim" grava o guia mostrado; "não"/"cancelar" descarta; outra mensagem deixa de lado e segue a conversa. */
async function tratarGuiaPendente(rodada: Rodada): Promise<boolean> {
  const pendente = rodada.contexto.guiaPendente;
  if (!pendente || !rodada.deps.guias) {
    return false;
  }
  const comando = rodada.mensagem.imagemUrl ? undefined : reconhecerComando(rodada.mensagem.texto);
  rodada.contexto.guiaPendente = undefined;
  if (comando === 'NAO' || comando === 'CANCELAR') {
    responder(rodada, 'Ok, descartei o guia de medidas.');
    return true;
  }
  if (comando !== 'SIM') {
    return false;
  }
  await rodada.deps.guias.salvar(rodada.empreendedorId, pendente.alvo, pendente.guia);
  logger.info({ telefone: rodada.mensagem.telefone, alvo: pendente.alvo.tipo }, '📏 guia de medidas salvo');
  responder(rodada, '✅ Guia de medidas salvo! Na vitrine, aparece o link *Guia de medidas* ao lado dos tamanhos.');
  return true;
}

/** "relatório", "vendas de hoje"… e o liga/desliga do relatório diário. */
async function tratarRelatorios(rodada: Rodada): Promise<boolean> {
  const { relatorios } = rodada.deps;
  if (!relatorios || rodada.mensagem.imagemUrl) {
    return false;
  }
  const respostas = await conversaDosRelatorios({
    relatorios,
    telefone: rodada.mensagem.telefone,
    texto: rodada.mensagem.texto,
    plano: rodada.assinatura,
    linkDosPlanos: rodada.deps.planos?.linkDosPlanos,
  });
  respostas?.forEach((resposta) => responder(rodada, resposta));
  return Boolean(respostas);
}

/** "2026-10-27 (terça)", para a IA calcular datas como "até domingo". */
function hojeParaIA(agora = new Date()): string {
  const fuso = 'America/Sao_Paulo';
  return `${diaNoFuso(agora, fuso)} (${NOMES_DOS_DIAS[diaEMinutoNoFuso(agora, fuso).dia]})`;
}

/** Fotos seguidas sem legenda, até este tempo depois da anterior, vão para o mesmo produto. */
const JANELA_FOTOS_EM_SEQUENCIA_MS = 3 * 60_000;

/**
 * Na loja, é comum mandar várias fotos do produto de uma vez: a primeira (com
 * legenda) a IA liga ao produto; as seguintes, sem legenda e logo depois, vão
 * para a mesma galeria sem chamar a IA. Devolve true quando tratou a mensagem.
 */
function fotoDaSequencia(rodada: Rodada): boolean {
  const { imagemUrl, texto } = rodada.mensagem;
  const ultima = rodada.contexto.ultimaFoto;
  if (rodada.snapshot.segmento !== 'VAREJO' || !imagemUrl || texto.trim() || !ultima) {
    return false;
  }
  if (Date.now() - new Date(ultima.em).getTime() > JANELA_FOTOS_EM_SEQUENCIA_MS) {
    return false;
  }
  const { rascunho } = rodada.contexto;
  const novo = ultima.ref ? rascunho.novosItens.find((item) => item.ref === ultima.ref) : undefined;
  const existente = ultima.itemId ? rodada.snapshot.itens.find((item) => item.id === ultima.itemId) : undefined;
  if (!novo && !existente) {
    return false;
  }
  aplicarOperacoes(
    { contexto: rodada.contexto, snapshot: rodada.snapshot, fotoAtual: imagemUrl, segmento: 'VAREJO' },
    [{ tipo: 'ANEXAR_FOTO', ref: novo?.ref, itemId: novo ? undefined : existente?.id }],
  );
  const fotos = novo?.fotos?.length ?? rascunho.edicoes.find((edicao) => edicao.itemId === existente?.id)?.fotos?.length ?? 1;
  rodada.estado = 'CONVERSANDO';
  falar(rodada, `📷 Mais uma foto de *${novo?.nome ?? existente?.nome ?? 'produto'}* anotada (${fotos} ${fotos === 1 ? 'foto' : 'fotos'}).`);
  return true;
}

// ---------------------------------------------------------------------------
// Tipo da loja
// ---------------------------------------------------------------------------

function perguntarTipo(rodada: Rodada): void {
  responder(rodada, TEXTO_PERGUNTA_TIPO);
  rodada.respostas.push({ enquete: { pergunta: PERGUNTA_TIPO, opcoes: [...OPCOES_TIPO] } });
}

/**
 * Primeira pergunta de uma loja nova: cardápio ou loja. A resposta é lida sem
 * IA (enquete, "1"/"2" ou palavra) e gravada na hora; até lá, nada mais anda.
 */
async function escolherTipoNoCadastro(rodada: Rodada): Promise<void> {
  const tipo = rodada.mensagem.imagemUrl ? undefined : tipoDaResposta(rodada.mensagem.texto);
  if (!tipo) {
    perguntarTipo(rodada);
    return;
  }
  await rodada.deps.gestaoRepo.definirSegmento(rodada.empreendedorId, tipo);
  rodada.snapshot = await rodada.deps.gestaoRepo.carregarSnapshot(rodada.empreendedorId);
  rodada.estado = 'CONVERSANDO';
  const { tipo: nome, lista } = vocabulario(tipo);
  falar(rodada, `Combinado: sua loja é um *${nome}* ${tipo === 'VAREJO' ? '🛍️' : '🍔'}. Vou te ajudar a montar o ${lista}.`);
}

/** "mudar tipo da loja": mostra o tipo atual e pergunta o novo. Com alterações anotadas, pede para resolver antes. */
function comecarTrocaDeTipo(rodada: Rodada): void {
  if (!estaVazio(rodada.contexto.rascunho)) {
    responder(
      rodada,
      'Antes de trocar o tipo da loja, salve as alterações anotadas (diga *pronto*) ou descarte (mande *cancelar*).',
    );
    return;
  }
  rodada.contexto.trocaDeTipo = {};
  responder(
    rodada,
    `Hoje sua loja é *${vocabulario(rodada.snapshot.segmento).tipo}*. Para qual tipo você quer mudar? Responda *1* (Cardápio) ou *2* (Loja), ou *cancelar*.`,
  );
  rodada.respostas.push({ enquete: { pergunta: PERGUNTA_TIPO, opcoes: [...OPCOES_TIPO] } });
}

/** Escolha do novo tipo e depois o "sim": tudo sem IA. Só grava com a confirmação. */
async function continuarTrocaDeTipo(rodada: Rodada): Promise<void> {
  const troca = rodada.contexto.trocaDeTipo!;
  const comando = rodada.mensagem.imagemUrl ? undefined : reconhecerComando(rodada.mensagem.texto);
  const atual = rodada.snapshot.segmento === 'VAREJO' ? 'VAREJO' : 'COMIDA';
  const manter = () => {
    rodada.contexto.trocaDeTipo = undefined;
    responder(rodada, `Ok, sua loja continua como *${vocabulario(atual).tipo}*.`);
  };

  if (comando === 'CANCELAR' || (troca.para && comando === 'NAO')) {
    manter();
    return;
  }
  if (!troca.para) {
    const tipo = rodada.mensagem.imagemUrl ? undefined : tipoDaResposta(rodada.mensagem.texto);
    if (!tipo) {
      responder(rodada, 'Não entendi o tipo. Responda *1* (Cardápio) ou *2* (Loja), ou *cancelar* para manter como está.');
      return;
    }
    if (tipo === atual) {
      rodada.contexto.trocaDeTipo = undefined;
      responder(rodada, `Sua loja já é *${vocabulario(tipo).tipo}*. Nada mudou.`);
      return;
    }
    rodada.contexto.trocaDeTipo = { para: tipo };
    responder(rodada, `${oQueMudaNaTroca(tipo)}

Confirma a troca para *${vocabulario(tipo).tipo}*? (*sim*/*não*)`);
    return;
  }
  if (comando !== 'SIM') {
    responder(rodada, `Responda *sim* para trocar para *${vocabulario(troca.para).tipo}* ou *não* para manter como está.`);
    return;
  }
  await rodada.deps.gestaoRepo.definirSegmento(rodada.empreendedorId, troca.para);
  rodada.snapshot = await rodada.deps.gestaoRepo.carregarSnapshot(rodada.empreendedorId);
  rodada.contexto.trocaDeTipo = undefined;
  logger.info({ telefone: rodada.mensagem.telefone, segmento: troca.para }, '🔀 tipo da loja trocado');
  const { tipo, lista } = vocabulario(troca.para);
  responder(rodada, `✅ Pronto! Sua loja agora é *${tipo}*. Me conta o que quer mudar no ${lista}.`);
}

async function conversarComIA(rodada: Rodada): Promise<void> {
  const { interpretador } = rodada.deps;
  if (!interpretador) {
    responder(
      rodada,
      'A conversa livre está desativada (IA não configurada). Por enquanto só entendo *cardápio* e *cancelar*.',
    );
    return;
  }

  const estadoAnterior = rodada.estado;
  let saida: RespostaConversa;
  try {
    saida = await interpretador.conversar({
      estado: rodada.estado,
      historico: rodada.contexto.historico.map((item) => ({ ...item, texto: limitar(item.texto) })),
      mensagem: limitar(rodada.mensagem.texto),
      fotoRecebida: Boolean(rodada.mensagem.imagemUrl),
      fotoPendente: Boolean(rodada.contexto.fotoPendente),
      rascunho: rodada.contexto.rascunho,
      endereco: {
        consultaEndereco: rodada.contexto.consultaEndereco,
        enderecoPendente: rodada.contexto.enderecoPendente,
      },
      snapshot: rodada.snapshot,
      cadastroPendente: obrigatoriosDaLoja(lojaParaCadastro(rodada, rodada.contexto.rascunho.loja))
        .filter((item) => !item.ok)
        .map((item) => `${item.rotulo}: ${item.comoPedir}`),
      segmento: rodada.snapshot.segmento,
      entregaPorDistancia: entregaPorDistancia(rodada),
      hoje: hojeParaIA(),
    });
  } catch (erro) {
    logger.warn({ err: erro }, 'falha ao conversar com a IA');
    if (rodada.mensagem.imagemUrl) {
      // Não perde a foto: a IA pode anexá-la quando a pessoa repetir o pedido.
      rodada.contexto.fotoPendente = rodada.mensagem.imagemUrl;
    }
    responder(rodada, 'Tive um problema para entender agora 😕 Pode mandar de novo? Suas alterações anotadas continuam guardadas.');
    return;
  }

  logger.info(
    {
      mensagem: trecho(rodada.mensagem.texto),
      resposta: trecho(saida.resposta),
      operacoes: saida.operacoes.map((operacao) => operacao.tipo),
      finalizou: saida.finalizou,
      mostrarCardapio: saida.mostrarCardapio || undefined,
      decisao: saida.decisao,
      malformadas: saida.operacoesMalformadas.length || undefined,
    },
    '🧠 IA',
  );
  if (saida.operacoesMalformadas.length > 0) {
    logger.warn({ operacoes: saida.operacoesMalformadas }, 'operações da IA fora do formato foram ignoradas');
  }

  // O tipo da loja fecha o que a IA pode fazer: o que for do outro tipo é descartado com aviso.
  const doTipo = filtrarPorTipo(rodada.snapshot.segmento, saida.operacoes);
  if (doTipo.avisos.length > 0) {
    logger.info({ segmento: rodada.snapshot.segmento ?? 'COMIDA' }, 'operações de outro tipo de loja foram descartadas');
  }
  // O plano tira o que ele não inclui (entrega por distância, cor e capa) e os produtos acima do limite.
  const doPlano = filtrarPorPlano(
    rodada.assinatura,
    doTipo.operacoes,
    { salvos: rodada.snapshot.itens.length, noRascunho: rodada.contexto.rascunho.novosItens.length },
    rodada.deps.planos?.linkDosPlanos,
  );
  // Promoção não entra no rascunho: tem resumo e "sim" próprios.
  const promocoesPropostas = doPlano.operacoes.flatMap((operacao) => (operacao.tipo === 'NOVA_PROMOCAO' ? [operacao.promocao] : []));
  const guiaProposto = doPlano.operacoes.find((operacao) => operacao.tipo === 'DEFINIR_GUIA_MEDIDAS');
  const paraORascunho = doPlano.operacoes.filter(
    (operacao) => operacao.tipo !== 'NOVA_PROMOCAO' && operacao.tipo !== 'DEFINIR_GUIA_MEDIDAS',
  );
  const avisos = [
    ...doTipo.avisos,
    ...doPlano.avisos,
    ...aplicarOperacoes(
      {
        contexto: rodada.contexto,
        snapshot: rodada.snapshot,
        fotoAtual: rodada.mensagem.imagemUrl,
        segmento: rodada.snapshot.segmento,
      },
      paraORascunho,
    ),
  ];
  if (saida.operacoesMalformadas.length > 0) {
    avisos.push('⚠️ Não consegui entender parte do que você pediu. Pode explicar de outro jeito?');
  }

  registrarHistorico(rodada, saida.resposta);
  if (saida.resposta) {
    responder(rodada, saida.resposta);
  }
  if (saida.mostrarCardapio) {
    responder(rodada, descreverCardapio(rodada.snapshot, entregaPorDistancia(rodada)));
    const pendentes = contarAlteracoes(rodada.contexto.rascunho);
    if (pendentes > 0) {
      responder(rodada, avisoAlteracoesPendentes(pendentes, vocabulario(rodada.snapshot.segmento).lista));
    }
  }
  for (const aviso of avisos) {
    responder(rodada, aviso);
  }
  if (saida.operacoes.some((operacao) => operacao.tipo === 'DEFINIR_ENDERECO')) {
    await procurarEndereco(rodada);
  }

  const proposta = promocoesPropostas[0];
  if (proposta) {
    if (rodada.deps.promocoes) {
      const respostas = await proporPromocao(conversaDasPromocoesDa(rodada, rodada.deps.promocoes), proposta);
      respostas.forEach((resposta) => rodada.respostas.push(resposta));
    } else {
      responder(rodada, 'As promoções ainda não estão disponíveis por aqui.');
    }
  }

  if (guiaProposto?.tipo === 'DEFINIR_GUIA_MEDIDAS') {
    proporGuia(rodada, guiaProposto.alvo, guiaProposto.guia);
  }

  const mudouRascunho = paraORascunho.length > 0;
  if (estadoAnterior === 'CONFIRMANDO' && !mudouRascunho) {
    if (saida.decisao === 'CONFIRMAR') {
      await salvar(rodada);
      return;
    }
    if (saida.decisao === 'RECUSAR') {
      rodada.estado = 'CONVERSANDO';
      return;
    }
  }

  rodada.estado = 'CONVERSANDO';
  // Com um endereço acabando de ser encontrado, a pergunta "é aqui?" vem antes do resumo.
  // Com uma promoção esperando o "sim", o resumo dela vem antes do resumo do rascunho.
  if (saida.finalizou && !rodada.contexto.enderecoPendente && !rodada.contexto.promocaoPendente && !rodada.contexto.guiaPendente) {
    await finalizar(rodada);
  }
}

// ---------------------------------------------------------------------------
// Endereço
// ---------------------------------------------------------------------------

/** Busca no mapa o que a pessoa informou e pergunta "é aqui?". Só o código fala do resultado. */
async function procurarEndereco(rodada: Rodada): Promise<void> {
  const consulta = rodada.contexto.consultaEndereco;
  if (!consulta) {
    return;
  }
  if (!rodada.deps.endereco) {
    falar(rodada, 'Não consigo verificar endereços agora (o serviço de mapas não está configurado). O resto das alterações continua anotado.');
    return;
  }

  const resultado = await buscarEndereco(consulta, rodada.deps.endereco);
  logger.info({ telefone: rodada.mensagem.telefone, resultado: resultado.tipo }, '📍 busca de endereço');

  switch (resultado.tipo) {
    case 'ENCONTRADO':
      rodada.contexto.enderecoPendente = { endereco: resultado.endereco, avisos: resultado.avisos };
      falar(
        rodada,
        [
          'Encontrei este endereço:',
          `📍 *${resultado.endereco.enderecoFormatado}*`,
          linkMapa(resultado.endereco),
          ...resultado.avisos,
          '',
          'É aqui? (*sim*/*não*)',
        ].join('\n'),
      );
      return;
    case 'CEP_INVALIDO':
      falar(rodada, `O CEP ${resultado.cep} tem ${normalizarCep(resultado.cep).length} dígitos (o certo são 8). Confere pra mim?`);
      return;
    case 'CEP_NAO_ENCONTRADO':
      falar(
        rodada,
        `Não achei o CEP ${resultado.cep}. Confere o número ou me manda o endereço por extenso (rua, número, bairro e cidade).`,
      );
      return;
    case 'FALTA_NUMERO':
      falar(rodada, 'Qual é o número da loja? Se não tiver número, é só dizer *sem número*.');
      return;
    case 'DADOS_INSUFICIENTES':
      falar(
        rodada,
        'Pra achar a loja no mapa preciso do *CEP e do número*. Se não souber o CEP, me manda rua, número, bairro e cidade.',
      );
      return;
    case 'NAO_ENCONTRADO':
      falar(rodada, 'Não encontrei esse endereço no mapa. Confere o CEP e o número, ou me manda o endereço por extenso.');
      return;
    case 'INDISPONIVEL':
      falar(rodada, 'Não consegui verificar o endereço agora. Tente de novo em alguns minutos; o resto das alterações continua anotado.');
      return;
  }
}

/** "sim"/"não" para o endereço encontrado, sem passar pela IA. */
function responderSobreEndereco(rodada: Rodada, confirmou: boolean): void {
  rodada.estado = 'CONVERSANDO';
  let texto: string;
  if (confirmou) {
    confirmarEndereco(rodada.contexto);
    const { loja: lojaRascunho } = rodada.contexto.rascunho;
    const loja = { ...rodada.snapshot.loja, ...lojaRascunho };
    const exemplo = entregaPorDistancia(rodada) ? '_até 1 km grátis, até 3 km R$ 5_ ou um valor só' : '_R$ 5 até 4 km_';
    texto =
      loja.fazEntrega && !entregaConfigurada(loja, entregaPorDistancia(rodada))
        ? `📍 Endereço anotado! Agora me diz como você cobra a entrega. Exemplo: ${exemplo}.`
        : '📍 Endereço anotado! Mais alguma coisa?';
  } else {
    recusarEndereco(rodada.contexto);
    texto = 'Sem problemas! Me manda o endereço de novo, ou só o que estiver errado (ex.: _o número é 132_).';
  }
  registrarHistorico(rodada, texto);
  responder(rodada, texto);
}

/** Loja que entregava com a taxa fixa antiga: a entrega fica parada até configurar endereço e faixas. */
/** Loja como o cadastro vê: a salva, mais o que está anotado no rascunho. */
function lojaParaCadastro(rodada: Rodada, rascunho?: DadosLoja): LojaParaCadastro {
  const { snapshot } = rodada;
  const definidosDoRascunho = Object.fromEntries(Object.entries(rascunho ?? {}).filter(([, valor]) => valor !== undefined));
  const loja: DadosLoja = { ...snapshot.loja, ...definidosDoRascunho };
  return {
    nome: loja.nome,
    slug: loja.slug,
    aceitaRetirada: loja.aceitaRetirada,
    fazEntrega: loja.fazEntrega,
    usaMelhorEnvio: loja.usaMelhorEnvio,
    enderecoConfirmado: Boolean(loja.enderecoVerificado),
    faixasEntrega: loja.faixasEntrega,
    taxaEntrega: loja.taxaEntrega,
    modoEntrega: loja.modoEntrega,
    entregaPorDistancia: entregaPorDistancia(rodada),
    horarios: loja.horarios,
    descricao: loja.descricao,
    temLogo: snapshot.lojaSalva.temLogo || Boolean(rascunho?.logoUrl),
    temCapa: snapshot.lojaSalva.temCapa || Boolean(rascunho?.capaUrl),
    corDestaque: loja.corDestaque,
    pedidoMinimo: loja.pedidoMinimo,
    segmento: snapshot.segmento,
    politicaTroca: loja.politicaTroca,
    instagram: loja.instagram,
  };
}

/** Resposta ao "o que falta?": obrigatórios com ✅/⬜ e, com a loja no ar, os opcionais. */
function descreverPendencias(rodada: Rodada): string {
  const loja = lojaParaCadastro(rodada, rodada.contexto.rascunho.loja);
  const proximo = obrigatoriosDaLoja(loja).find((item) => !item.ok);
  if (proximo) {
    return `${descreverObrigatorios(loja)}\n\nVamos lá: ${proximo.comoPedir}`;
  }
  return [descreverObrigatorios(loja), '', textoDosOpcionais(rodada) ?? '✨ Sua loja está completa! 🎉'].join('\n');
}

/** Lista dos opcionais que faltam, com como mandar cada um, e a situação do pagamento na entrega. */
function textoDosOpcionais(rodada: Rodada): string | undefined {
  const loja = lojaParaCadastro(rodada);
  const faltando = opcionaisDaLoja(loja).filter((item) => !item.ok);
  if (faltando.length === 0) {
    return undefined;
  }
  const pagamento = rodada.snapshot.loja.aceitaPagamentoNaEntrega === false ? 'desligado' : 'ligado';
  return [
    '✨ Para sua loja ficar mais completa, você ainda pode adicionar:',
    ...faltando.map((item) => `• ${item.rotulo} — ${item.comoPedir}`),
    `💵 Pagamento na entrega (dinheiro ou cartão) está *${pagamento}*: me diga se quiser mudar.`,
  ].join('\n');
}

/** No máximo 1 vez por semana, com a loja no ar, até ela completar ou pedir para parar. */
async function lembrarOpcionaisSeDevido(rodada: Rodada): Promise<void> {
  const { lembreteOpcionaisEm, naoLembrarOpcionais } = rodada.snapshot.lojaSalva;
  const recente = lembreteOpcionaisEm && Date.now() - new Date(lembreteOpcionaisEm).getTime() < LEMBRETE_OPCIONAIS_MS;
  const texto = textoDosOpcionais(rodada);
  if (naoLembrarOpcionais || recente || !texto) {
    return;
  }
  responder(rodada, `${texto}\n\nSe não quiser mais este lembrete, responda *não lembrar mais*.`);
  await rodada.deps.gestaoRepo.registrarLembreteOpcionais(rodada.empreendedorId, { em: new Date() });
}

/** Depois de salvar: comemora quando a loja entra no ar, ou mostra o que ainda falta. */
async function avisarSituacaoDoCadastro(rodada: Rodada, completoAntes: boolean): Promise<void> {
  rodada.snapshot = await rodada.deps.gestaoRepo.carregarSnapshot(rodada.empreendedorId);
  const loja = lojaParaCadastro(rodada);
  if (!cadastroCompleto(loja)) {
    responder(rodada, `Para a loja entrar no ar ainda falta:\n${descreverObrigatorios(loja)}`);
    return;
  }
  if (completoAntes) {
    return;
  }
  const { slug } = rodada.snapshot.loja;
  const link = slug && rodada.deps.urlDoCardapio ? rodada.deps.urlDoCardapio(slug) : slug;
  const fala = vocabulario(rodada.snapshot.segmento);
  responder(
    rodada,
    [
      '🎉 *Sua loja está no ar!*',
      link ? `Link do ${fala.lista} para divulgar: ${link}` : '',
      '',
      `Próximo passo: me mande os ${fala.itens} do ${fala.lista} — nome, preço e, se quiser, uma foto. Ex.: _${fala.exemploItem}_`,
    ]
      .filter((linha, indice) => linha || indice !== 1)
      .join('\n'),
  );
  const opcionais = textoDosOpcionais(rodada);
  if (opcionais) {
    responder(rodada, opcionais);
    await rodada.deps.gestaoRepo.registrarLembreteOpcionais(rodada.empreendedorId, { em: new Date() });
  }
}

/**
 * Loja que diz entregar mas não tem como cobrar: a que caiu para o Básico
 * usando a distância (pede a taxa fixa) e a antiga sem endereço ou faixas.
 * Até a loja responder, só retirada; nada do que estava configurado é apagado.
 */
export const AVISO_FIM_DO_FRETE_FIXO =
  '📦 Mudou o envio: o frete fixo por estado saiu. Agora você pode entregar com *envio próprio* (um valor só ou por distância, com raio máximo) e, no plano Profissional, *por transportadora com o Melhor Envio*. Seu envio está desligado até você configurar: é só me dizer como quer entregar.';

/** Loja que usava o frete fixo por região (removido): avisa uma vez. */
async function avisarFimDoFreteFixo(rodada: Rodada): Promise<void> {
  if (!rodada.snapshot.lojaSalva.avisarFimDoFreteFixo) {
    return;
  }
  responder(rodada, AVISO_FIM_DO_FRETE_FIXO);
  await rodada.deps.gestaoRepo.limparAvisoDoFreteFixo(rodada.empreendedorId);
}

function avisarEntregaPorConfigurar(rodada: Rodada): void {
  const loja = { ...rodada.snapshot.loja, ...rodada.contexto.rascunho.loja };
  const distancia = entregaPorDistancia(rodada);
  if (!loja.fazEntrega || entregaConfigurada(loja, distancia)) {
    return;
  }
  if (!distancia) {
    responder(
      rodada,
      '🛵 No seu plano a entrega é com *taxa fixa* (a entrega por distância é do plano *Profissional*). Por enquanto sua loja está só com retirada: me diga quanto cobra de entrega e, se quiser, até quantos km entrega (ex.: _R$ 5 até 4 km_). Suas faixas de distância continuam guardadas.',
    );
    return;
  }
  responder(
    rodada,
    '🛵 Para voltar a entregar, me manda o *CEP e o número* da loja e como você cobra a entrega: um valor só (ex.: _R$ 5 até 4 km_) ou por distância (ex.: _até 1 km grátis, até 3 km R$ 5_).',
  );
}

/** A pessoa terminou: mostra o resumo (ou o que falta) e pede confirmação. */
async function finalizar(rodada: Rodada): Promise<void> {
  const { rascunho } = rodada.contexto;
  if (estaVazio(rascunho)) {
    reiniciar(rodada);
    responder(rodada, 'Não há nenhuma alteração anotada para salvar. Quando quiser mudar algo, é só me falar! 🙂');
    return;
  }
  const pendencias = pendenciasParaSalvar(rodada.contexto, rodada.snapshot, entregaPorDistancia(rodada));
  if (pendencias.length > 0) {
    rodada.estado = 'CONVERSANDO';
    responder(rodada, `Antes de salvar, preciso saber:\n${pendencias.map((pendencia) => `• ${pendencia}`).join('\n')}`);
    return;
  }
  rodada.estado = 'CONFIRMANDO';
  await responderPrevia(rodada, `Assim vai ficar no ${vocabulario(rodada.snapshot.segmento).lista} 👇`);
  responder(rodada, montarResumo(rascunho, rodada.snapshot));
}

/** Validade da prévia guardada: o link da imagem funciona por 1 h. */
const VALIDADE_PREVIA_MS = 60 * 60_000;

/**
 * Guarda a prévia do rascunho e põe a imagem nas respostas. Devolve false
 * quando não há o que mostrar. Falha aqui nunca impede o resumo: só não vai a imagem.
 */
async function responderPrevia(rodada: Rodada, legenda: string): Promise<boolean> {
  const { previas } = rodada.deps;
  if (!recursoLiberado(rodada, 'PREVIA_IMAGEM')) {
    return false;
  }
  const previa = previas && montarPrevia(rodada.contexto.rascunho, rodada.snapshot);
  if (!previas || !previa) {
    return false;
  }
  try {
    const id = await previas.repo.guardar(previa, VALIDADE_PREVIA_MS);
    rodada.respostas.push({ imagemUrl: previas.urlDaImagem(id), legenda });
    return true;
  } catch (erro) {
    logger.warn({ err: erro }, 'não foi possível guardar a prévia; vai só o resumo');
    return false;
  }
}

async function salvar(rodada: Rodada): Promise<void> {
  const { rascunho } = rodada.contexto;
  const pendencias = pendenciasParaSalvar(rodada.contexto, rodada.snapshot, entregaPorDistancia(rodada));
  if (estaVazio(rascunho) || pendencias.length > 0) {
    await finalizar(rodada);
    return;
  }

  const total = contarAlteracoes(rascunho);
  try {
    await rodada.deps.gestaoRepo.salvarRascunho(rodada.empreendedorId, rascunho);
  } catch (erro) {
    if (erro instanceof DomainError && erro.code === 'SLUG_EM_USO') {
      // Volta para a conversa sem o link, para a pessoa escolher outro.
      delete rascunho.loja?.slug;
      rodada.estado = 'CONVERSANDO';
      responder(rodada, `😕 ${erro.message} Me diga outro link para o cardápio e depois *pronto* para salvar.`);
      return;
    }
    if (erro instanceof DomainError) {
      // Erro com motivo (item que sumiu, item sem preço): repetir o "sim" não resolve, então volta a conversar.
      logger.warn({ err: erro }, 'rascunho recusado ao salvar');
      rodada.estado = 'CONVERSANDO';
      responder(
        rodada,
        `😕 Não consegui salvar: ${erro.message} Nada foi alterado. Me diga o que ajustar e depois *pronto* para revisar de novo.`,
      );
      return;
    }
    logger.error({ err: erro }, '💥 falha ao salvar o rascunho');
    responder(rodada, '😕 Deu um erro ao salvar e nada foi alterado. Tente responder *sim* de novo em instantes.');
    return;
  }

  logger.info({ telefone: rodada.mensagem.telefone, alteracoes: total }, '💾 rascunho salvo no cardápio');
  const completoAntes = cadastroCompleto(lojaParaCadastro(rodada));
  reiniciar(rodada);
  responder(
    rodada,
    `✅ Pronto! ${total === 1 ? '1 alteração salva' : `${total} alterações salvas`} no ${vocabulario(rodada.snapshot.segmento).lista}.`,
  );
  await avisarSituacaoDoCadastro(rodada, completoAntes);
  // Ligou o envio por transportadora sem a conta conectada: manda o link.
  if (rascunho.loja?.usaMelhorEnvio && rodada.deps.melhorEnvio && !(await rodada.deps.melhorEnvio.conectada(rodada.empreendedorId))) {
    responder(rodada, await textoDeConexaoDoMelhorEnvio(rodada));
  }
}

/** Link para conectar a conta do Melhor Envio (Profissional, tipo Loja). */
async function textoDeConexaoDoMelhorEnvio(rodada: Rodada): Promise<string> {
  if (!recursoLiberado(rodada, 'MELHOR_ENVIO')) {
    return mensagemRecursoDoPlano('MELHOR_ENVIO', rodada.deps.planos?.linkDosPlanos);
  }
  if (rodada.snapshot.segmento !== 'VAREJO') {
    return 'O envio por transportadora é do tipo *Loja*. Para trocar, mande *mudar tipo da loja*.';
  }
  const link = rodada.deps.melhorEnvio && (await rodada.deps.melhorEnvio.linkParaConectar(rodada.empreendedorId));
  if (!link) {
    return 'O envio pelo Melhor Envio ainda não está disponível por aqui.';
  }
  return `📦 Para enviar por transportadora, conecte sua conta do Melhor Envio (é grátis criar): ${link}\nDepois de autorizar, eu aviso aqui. As etiquetas são pagas com o saldo da sua conta.`;
}

function reiniciar(rodada: Rodada): void {
  rodada.estado = 'OCIOSO';
  rodada.contexto = contextoInicial();
}

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------

function registrarHistorico(rodada: Rodada, respostaBot: string): void {
  const { texto, imagemUrl } = rodada.mensagem;
  const textoUsuario = imagemUrl ? `[foto]${texto.trim() ? ` ${texto.trim()}` : ''}` : texto.trim();
  rodada.contexto.historico.push({ papel: 'usuario', texto: limitar(textoUsuario) });
  if (respostaBot) {
    rodada.contexto.historico.push({ papel: 'bot', texto: limitar(respostaBot) });
  }
  rodada.contexto.historico = rodada.contexto.historico.slice(-MAX_HISTORICO);
}

function limitar(texto: string): string {
  return texto.length > MAX_CARACTERES_HISTORICO ? `${texto.slice(0, MAX_CARACTERES_HISTORICO)}…` : texto;
}

/** O plano inclui a entrega por distância (sem planos configurados, sim). */
function entregaPorDistancia(rodada: Rodada): boolean {
  return recursoLiberado(rodada, 'ENTREGA_POR_DISTANCIA');
}

/** Sem planos configurados, tudo fica liberado. */
function recursoLiberado(rodada: Rodada, recurso: Parameters<typeof podeUsar>[1]): boolean {
  return !rodada.assinatura || podeUsar(rodada.assinatura, recurso);
}

function responder(rodada: Rodada, texto: string): void {
  rodada.respostas.push(texto);
}

/** Resposta escrita pelo código no meio da conversa: entra no histórico para a IA saber o que foi dito. */
function falar(rodada: Rodada, texto: string): void {
  responder(rodada, texto);
  rodada.contexto.historico.push({ papel: 'bot', texto: limitar(texto) });
  rodada.contexto.historico = rodada.contexto.historico.slice(-MAX_HISTORICO);
}

/** Cardápio (ou catálogo) atual agrupado por categoria, com a numeração usada pela IA. */
function descreverCardapio(snapshot: SnapshotCardapio, distanciaLiberada = true): string {
  const fala = vocabulario(snapshot.segmento);
  if (snapshot.itens.length === 0) {
    return `Seu ${fala.lista} ainda está vazio. Me conta o primeiro ${fala.item}, por exemplo: _${fala.exemploItem}_`;
  }
  const grupos = new Map<string, string[]>();
  snapshot.itens.forEach((item, indice) => {
    const grupo = item.categoriaNome ?? 'Outros';
    const linha = `${indice + 1}. ${item.nome} — ${formatarPreco(item.precoBase)}${item.ativo ? '' : ' ⏸️ _pausado_'}`;
    const grade = snapshot.segmento === 'VAREJO' && item.grade?.length ? [`   ${descreverGrade(item.grade)}`] : [];
    grupos.set(grupo, [...(grupos.get(grupo) ?? []), linha, ...grade]);
  });

  const linhas = [`📋 *Seu ${fala.lista}*`];
  // Categorias na ordem cadastrada; "Outros" por último.
  for (const nome of [...snapshot.categorias.map((categoria) => categoria.nome), 'Outros']) {
    const itens = grupos.get(nome);
    if (itens) {
      linhas.push('', `*${nome}*`, ...itens);
    }
  }
  const { loja } = snapshot;
  if (loja.horarios?.length) {
    linhas.push('', `🕒 ${formatarHorarios(loja.horarios)}`);
  }
  if (loja.endereco) {
    linhas.push(`📍 ${loja.endereco}`);
  }
  if (loja.slug) {
    linhas.push(`🔗 Link do ${fala.lista}: ${loja.slug}`);
  }
  if (loja.fazEntrega) {
    const entrega = entregaEmUso(loja, distanciaLiberada);
    linhas.push(
      entrega?.tipo === 'DISTANCIA'
        ? `🛵 ${descreverFaixas(entrega.faixas)}`
        : entrega
          ? `🛵 Entrega com taxa fixa: ${descreverTaxaFixa(entrega)}`
          : '🛵 Entrega parada: falta informar quanto você cobra de entrega.',
    );
  }
  linhas.push(
    '',
    snapshot.segmento === 'VAREJO'
      ? 'Para mudar algo, é só me dizer — ex.: _a camiseta agora é 49,90_, _chegaram mais 3 M azul_.'
      : 'Para mudar algo, é só me dizer — ex.: _a coca agora é 15_, _acabou a pizza de frango_.',
  );
  return linhas.join('\n');
}

/** O cardápio mostrado é o salvo; sem isso parece que a alteração anotada se perdeu. */
export function avisoAlteracoesPendentes(total: number, lista = 'cardápio'): string {
  const alteracoes = total === 1 ? '1 alteração anotada que ainda não foi salva' : `${total} alterações anotadas que ainda não foram salvas`;
  return `✏️ Esse é o ${lista} salvo. Você tem ${alteracoes}: quando terminar, diga *pronto* para revisar e salvar.`;
}
