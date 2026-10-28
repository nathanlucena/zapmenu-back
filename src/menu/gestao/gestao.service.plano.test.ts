import { describe, expect, it } from 'vitest';
import type { ConversaPersistida, ConversationRepository } from '../conversation/conversation.repository.js';
import { contextoInicial } from '../conversation/conversation-state.types.js';
import { criarGestaoRepositoryFake } from './__mocks__/gestao.repository.fake.js';
import { criarPreviasRepositoryFake } from './__mocks__/previas.repository.fake.js';
import { criarCadastroPorLista } from './cadastro-empreendedores.js';
import { processarMensagemGestao, type GestaoDeps, type RespostaGestao } from './gestao.service.js';
import type { ItemSnapshot } from './gestao.repository.js';
import type { RespostaConversa } from './interpretador.js';
import { criarInterpretadorRoteiroFake } from './__mocks__/interpretador.roteiro.fake.js';
import { criarAssinaturasRepositoryFake } from '../../planos/__mocks__/assinaturas.repository.fake.js';
import type { Assinatura } from '../../planos/domain/assinatura.js';

const TELEFONE = '5581999990000';
const LINK_PLANOS = 'https://zapmenu.test/#planos';
const LOJA_COMPLETA = {
  nome: 'Pizzaria do Zé',
  aceitaRetirada: true,
  enderecoVerificado: { numero: '1', enderecoFormatado: 'Rua A, 1', latitude: 0, longitude: 0, precisao: 'ROOFTOP' },
  horarios: [{ dia: 'seg' as const, abre: '18:00', fecha: '23:00' }],
};

function item(indice: number): ItemSnapshot {
  return { id: `item-${indice}`, nome: `Produto ${indice}`, precoBase: 10, ativo: true, temFoto: false, variacoes: [] };
}

/** Loja no ar com o plano pedido; `assinatura: null` = loja ainda sem assinatura gravada. */
function criarCenario(assinatura: Partial<Assinatura> | null, itens: ItemSnapshot[] = []) {
  let conversa: ConversaPersistida = { telefone: TELEFONE, estado: 'OCIOSO', contexto: contextoInicial() };
  const conversationRepo: ConversationRepository = {
    async obterOuCriar() {
      return structuredClone(conversa);
    },
    async salvar(nova) {
      conversa = structuredClone(nova);
    },
  };
  const ia = criarInterpretadorRoteiroFake();
  const assinaturas = criarAssinaturasRepositoryFake();
  assinaturas.definirLoja({ empreendedorId: 'emp-1', telefone: TELEFONE }, assinatura ?? undefined);
  const gestaoRepo = criarGestaoRepositoryFake({
    loja: LOJA_COMPLETA,
    itens,
    lojaSalva: { existe: true, temLogo: false, temCapa: false, naoLembrarOpcionais: true },
  });
  const previas = criarPreviasRepositoryFake();
  const enviados: { telefone: string; texto: string }[] = [];
  const deps: GestaoDeps = {
    conversationRepo,
    gestaoRepo,
    interpretador: ia,
    cadastro: criarCadastroPorLista([]),
    previas: { repo: previas, urlDaImagem: (id) => `http://front.test/api/previa/${id}` },
    planos: {
      repo: assinaturas,
      mensageiro: { enviarTexto: async (telefone, texto) => void enviados.push({ telefone, texto }) },
      linkDosPlanos: LINK_PLANOS,
    },
  };
  const enviar = (texto: string, imagemUrl?: string) => processarMensagemGestao({ telefone: TELEFONE, texto, imagemUrl }, deps);
  return { ia, enviar, assinaturas, gestaoRepo, deps, conversa: () => conversa };
}

const BASICO = { plano: 'ESSENCIAL', status: 'ATIVA' } as const;
const PROFISSIONAL = { plano: 'PROFISSIONAL', status: 'ATIVA' } as const;

const textos = (respostas: RespostaGestao[]) => respostas.filter((r): r is string => typeof r === 'string').join('\n---\n');
const imagens = (respostas: RespostaGestao[]) => respostas.filter((r) => typeof r === 'object' && 'imagemUrl' in r);

function ia(parcial: Partial<RespostaConversa>): Partial<RespostaConversa> {
  return { resposta: 'Anotado!', ...parcial };
}

describe('gestão: recursos por plano', () => {
  it('Básico: entrega por distância é recusada com o convite para o Profissional e o pedido da taxa fixa', async () => {
    const cenario = criarCenario(BASICO);
    cenario.ia.responder(
      ia({ operacoes: [{ tipo: 'ATUALIZAR_LOJA', dados: { fazEntrega: true, faixasEntrega: [{ ateKm: 1, taxa: 0 }, { ateKm: 3, taxa: 5 }] } }] }),
    );

    const respostas = await cenario.enviar('até 1 km grátis, até 3 km 5 reais');

    const texto = textos(respostas);
    expect(texto).toContain('Isso faz parte do plano *Profissional*');
    expect(texto).toContain(LINK_PLANOS);
    expect(texto).toContain('*assinar profissional*');
    expect(texto).toContain('No seu plano a entrega é com *taxa fixa*');
    expect(cenario.conversa().contexto.rascunho.loja?.faixasEntrega).toBeUndefined();
  });

  it('Básico: entrega com taxa fixa e raio é anotada e salva', async () => {
    const cenario = criarCenario(BASICO);
    cenario.ia.responder(
      ia({ operacoes: [{ tipo: 'ATUALIZAR_LOJA', dados: { taxaEntrega: 5, raioEntregaKm: 4 } }], finalizou: true }),
    );

    const resumo = textos(await cenario.enviar('entrego por 5 reais até 4 km, é isso'));

    expect(resumo).not.toContain('Isso faz parte do plano');
    expect(resumo).toContain('Entrega com taxa fixa: *R$ 5,00 até 4 km*');
    expect(cenario.conversa().contexto.rascunho.loja).toMatchObject({
      fazEntrega: true,
      taxaEntrega: 5,
      raioEntregaKm: 4,
      modoEntrega: 'FIXA',
    });
    await cenario.enviar('sim');
    expect(cenario.gestaoRepo.salvos[0]?.rascunho.loja).toMatchObject({ taxaEntrega: 5, modoEntrega: 'FIXA' });
  });

  it('Básico: "faço entrega" sem valor pede a taxa fixa antes de salvar (não as faixas)', async () => {
    const cenario = criarCenario(BASICO);
    cenario.ia.responder(ia({ operacoes: [{ tipo: 'ATUALIZAR_LOJA', dados: { fazEntrega: true } }], finalizou: true }));

    const texto = textos(await cenario.enviar('agora faço entrega, é isso'));

    expect(texto).toContain('quanto você cobra de entrega (um valor só)');
    expect(texto).not.toContain('até 1 km grátis');
  });

  it('caiu do Profissional para o Básico usando a distância: avisa e pede a taxa fixa, sem apagar as faixas', async () => {
    const cenario = criarCenario(BASICO);
    cenario.gestaoRepo.snapshot.loja = {
      ...cenario.gestaoRepo.snapshot.loja,
      fazEntrega: true,
      modoEntrega: 'DISTANCIA',
      faixasEntrega: [{ ateKm: 3, taxa: 5 }],
    };
    cenario.ia.responder(ia({ resposta: 'Oi!' }));

    const texto = textos(await cenario.enviar('oi'));

    expect(texto).toContain('No seu plano a entrega é com *taxa fixa*');
    expect(texto).toContain('só com retirada');
    expect(texto).toContain('faixas de distância continuam guardadas');
    expect(cenario.gestaoRepo.snapshot.loja.faixasEntrega).toEqual([{ ateKm: 3, taxa: 5 }]);
  });

  it('Profissional escolhe a taxa fixa ou a distância', async () => {
    const cenario = criarCenario(PROFISSIONAL);
    cenario.ia.responder(ia({ operacoes: [{ tipo: 'ATUALIZAR_LOJA', dados: { fazEntrega: true, taxaEntrega: 6 } }] }));
    await cenario.enviar('entrega é 6 reais');
    expect(cenario.conversa().contexto.rascunho.loja).toMatchObject({ taxaEntrega: 6, modoEntrega: 'FIXA' });

    cenario.ia.responder(ia({ operacoes: [{ tipo: 'ATUALIZAR_LOJA', dados: { faixasEntrega: [{ ateKm: 3, taxa: 5 }] } }] }));
    const texto = textos(await cenario.enviar('melhor por distância: até 3 km 5 reais'));
    expect(texto).not.toContain('Isso faz parte do plano');
    expect(cenario.conversa().contexto.rascunho.loja).toMatchObject({ modoEntrega: 'DISTANCIA', faixasEntrega: [{ ateKm: 3, taxa: 5 }] });
  });

  it('Básico: Melhor Envio é do Profissional', async () => {
    const cenario = criarCenario(BASICO);
    cenario.gestaoRepo.snapshot.segmento = 'VAREJO';
    cenario.ia.responder(ia({ operacoes: [{ tipo: 'ATUALIZAR_LOJA', dados: { usaMelhorEnvio: true } }] }));
    expect(textos(await cenario.enviar('quero enviar pelo melhor envio'))).toContain('Isso faz parte do plano *Profissional*');
    expect(cenario.conversa().contexto.rascunho.loja?.usaMelhorEnvio).toBeUndefined();
  });

  it('Profissional: "conectar melhor envio" manda o link de autorização', async () => {
    const cenario = criarCenario(PROFISSIONAL);
    cenario.gestaoRepo.snapshot.segmento = 'VAREJO';
    cenario.deps.melhorEnvio = { linkParaConectar: async () => 'https://sandbox.melhorenvio.test/oauth', conectada: async () => false };
    expect(textos(await cenario.enviar('conectar melhor envio'))).toContain('https://sandbox.melhorenvio.test/oauth');
  });

  it('guia de medidas (loja, Profissional): mostra a tabela e grava com o "sim"; no Básico, convite', async () => {
    const guia = { nome: 'Camisetas', colunas: ['Busto'], linhas: [{ tamanho: 'P', medidas: [96] }] };
    const operacao = { tipo: 'DEFINIR_GUIA_MEDIDAS' as const, alvo: { tipo: 'ITEM' as const, id: 'item-1' }, guia };

    const profissional = criarCenario(PROFISSIONAL, [item(1)]);
    profissional.gestaoRepo.snapshot.segmento = 'VAREJO';
    const salvos: unknown[] = [];
    profissional.deps.guias = { salvar: async (...args) => void salvos.push(args), remover: async () => true };
    profissional.ia.responder(ia({ operacoes: [operacao] }));
    const tabela = textos(await profissional.enviar('o guia da camiseta: P busto 96'));
    expect(tabela).toContain('📏 *Camisetas* (Produto 1)');
    expect(tabela).toContain('P     96');
    expect(salvos).toHaveLength(0);
    expect(textos(await profissional.enviar('sim'))).toContain('Guia de medidas salvo');
    expect(salvos).toEqual([[TELEFONE, operacao.alvo, guia]]);

    const basico = criarCenario(BASICO, [item(1)]);
    basico.gestaoRepo.snapshot.segmento = 'VAREJO';
    basico.deps.guias = { salvar: async () => undefined, remover: async () => true };
    basico.ia.responder(ia({ operacoes: [operacao] }));
    expect(textos(await basico.enviar('o guia da camiseta: P busto 96'))).toContain('Isso faz parte do plano *Profissional*');
    expect(basico.conversa().contexto.guiaPendente).toBeUndefined();
  });

  it('Básico: desligar a entrega continua liberado', async () => {
    const cenario = criarCenario(BASICO);
    cenario.ia.responder(ia({ operacoes: [{ tipo: 'ATUALIZAR_LOJA', dados: { fazEntrega: false } }] }));

    const respostas = await cenario.enviar('não faço mais entrega');

    expect(textos(respostas)).not.toContain('plano *Profissional*');
    expect(cenario.conversa().contexto.rascunho.loja?.fazEntrega).toBe(false);
  });

  it('Básico: cor e capa ficam de fora, o resto da mesma mensagem entra', async () => {
    const cenario = criarCenario(BASICO);
    cenario.ia.responder(
      ia({
        operacoes: [
          { tipo: 'ATUALIZAR_LOJA', dados: { corDestaque: '#C62828', descricao: 'A melhor pizza' } },
          { tipo: 'ANEXAR_FOTO_LOJA', destino: 'CAPA' },
        ],
      }),
    );

    const respostas = await cenario.enviar('cor vermelha, essa é a capa e a descrição é a melhor pizza', 'data:image/png;base64,AAA');

    // Um aviso só, mesmo com dois recursos de cor/capa barrados.
    expect(textos(respostas).match(/Isso faz parte do plano/g)).toHaveLength(1);
    const loja = cenario.conversa().contexto.rascunho.loja;
    expect(loja?.descricao).toBe('A melhor pizza');
    expect(loja?.corDestaque).toBeUndefined();
    expect(loja?.capaUrl).toBeUndefined();
  });

  it('Básico: sem prévia em imagem; o comando explica o plano', async () => {
    const cenario = criarCenario(BASICO);
    cenario.ia.responder(
      ia({ operacoes: [{ tipo: 'NOVO_ITEM', ref: 'n1', dados: { nome: 'Calabresa', precoBase: 50 } }], finalizou: true }),
    );

    const resumo = await cenario.enviar('entrou calabresa 50, é isso');
    expect(imagens(resumo)).toHaveLength(0);
    expect(textos(resumo)).toContain('Confirma');

    const previa = await cenario.enviar('como vai ficar?');
    expect(textos(previa)).toContain('Isso faz parte do plano *Profissional*');
    expect(imagens(previa)).toHaveLength(0);
  });

  it('Básico: recusa produtos acima de 30 e explica o upgrade', async () => {
    const cenario = criarCenario(BASICO, Array.from({ length: 29 }, (_, i) => item(i + 1)));
    cenario.ia.responder(
      ia({
        operacoes: [
          { tipo: 'NOVO_ITEM', ref: 'n1', dados: { nome: 'Trigésimo', precoBase: 10 } },
          { tipo: 'NOVO_ITEM', ref: 'n2', dados: { nome: 'Trigésimo primeiro', precoBase: 10 } },
          { tipo: 'ANEXAR_FOTO', ref: 'n2' },
        ],
      }),
    );

    const respostas = await cenario.enviar('entraram dois produtos');

    const texto = textos(respostas);
    expect(texto).toContain('permite até 30 produtos');
    expect(texto).toContain('No plano *Profissional* os produtos são ilimitados');
    expect(cenario.conversa().contexto.rascunho.novosItens.map((novo) => novo.nome)).toEqual(['Trigésimo']);
  });

  it('Profissional: entrega, cor e prévia liberadas e produtos sem limite', async () => {
    const cenario = criarCenario(PROFISSIONAL, Array.from({ length: 40 }, (_, i) => item(i + 1)));
    cenario.ia.responder(
      ia({
        operacoes: [
          { tipo: 'ATUALIZAR_LOJA', dados: { corDestaque: '#C62828', fazEntrega: true, faixasEntrega: [{ ateKm: 3, taxa: 5 }] } },
          { tipo: 'NOVO_ITEM', ref: 'n1', dados: { nome: 'Calabresa', precoBase: 50 } },
        ],
        finalizou: true,
      }),
    );

    const respostas = await cenario.enviar('cor vermelha, entrego até 3 km por 5, entrou calabresa 50');

    expect(textos(respostas)).not.toContain('Isso faz parte do plano');
    expect(imagens(respostas)).toHaveLength(1);
    const { rascunho } = cenario.conversa().contexto;
    expect(rascunho.loja).toMatchObject({ corDestaque: '#C62828', fazEntrega: true });
    expect(rascunho.novosItens).toHaveLength(1);
  });

  it('loja sem assinatura começa o TESTE na primeira conversa, com tudo do Profissional', async () => {
    const cenario = criarCenario(null, Array.from({ length: 35 }, (_, i) => item(i + 1)));
    cenario.ia.responder(
      ia({ operacoes: [{ tipo: 'ATUALIZAR_LOJA', dados: { fazEntrega: true, faixasEntrega: [{ ateKm: 2, taxa: 0 }] } }] }),
    );

    const respostas = await cenario.enviar('entrego até 2 km de graça');

    expect(textos(respostas)).not.toContain('Isso faz parte do plano');
    expect(cenario.assinaturas.assinaturaDe('emp-1')).toMatchObject({ status: 'TESTE', plano: 'PROFISSIONAL' });
    expect(cenario.conversa().contexto.rascunho.loja?.fazEntrega).toBe(true);
  });

  it('TESTE gravado também libera tudo', async () => {
    const cenario = criarCenario({ status: 'TESTE', plano: 'PROFISSIONAL' });
    cenario.ia.responder(ia({ operacoes: [{ tipo: 'ATUALIZAR_LOJA', dados: { corDestaque: '#1D4ED8' } }] }));

    const respostas = await cenario.enviar('quero a cor azul');

    expect(textos(respostas)).not.toContain('Isso faz parte do plano');
    expect(cenario.conversa().contexto.rascunho.loja?.corDestaque).toBe('#1D4ED8');
  });
});
