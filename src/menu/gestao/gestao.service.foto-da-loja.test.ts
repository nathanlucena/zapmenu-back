import { describe, expect, it } from 'vitest';
import type { ConversaPersistida, ConversationRepository } from '../conversation/conversation.repository.js';
import { contextoInicial } from '../conversation/conversation-state.types.js';
import { criarGestaoRepositoryFake } from './__mocks__/gestao.repository.fake.js';
import { criarInterpretadorRoteiroFake } from './__mocks__/interpretador.roteiro.fake.js';
import { criarPreviasRepositoryFake } from './__mocks__/previas.repository.fake.js';
import { criarCadastroPorLista } from './cadastro-empreendedores.js';
import { destinoDaLegenda, OPCOES_DESTINO_FOTO } from './foto-da-loja.js';
import { processarMensagemGestao, type GestaoDeps, type RespostaGestao } from './gestao.service.js';
import { criarAssinaturasRepositoryFake } from '../../planos/__mocks__/assinaturas.repository.fake.js';

const TELEFONE = '5581999990000';
const FOTO = 'data:image/jpeg;base64,FOTO';
const LOJA_COMPLETA = {
  nome: 'Pizzaria do Zé',
  slug: 'pizzaria-do-ze',
  aceitaRetirada: true,
  enderecoVerificado: { numero: '1', enderecoFormatado: 'Rua A, 1', latitude: 0, longitude: 0, precisao: 'ROOFTOP' },
  horarios: [{ dia: 'seg' as const, abre: '18:00', fecha: '23:00' }],
};

function criarCenario(plano: 'ESSENCIAL' | 'PROFISSIONAL' = 'PROFISSIONAL', temLogo = false) {
  let conversa: ConversaPersistida = { telefone: TELEFONE, estado: 'OCIOSO', contexto: contextoInicial() };
  const conversationRepo: ConversationRepository = {
    async obterOuCriar() {
      return structuredClone(conversa);
    },
    async salvar(nova) {
      conversa = structuredClone(nova);
    },
  };
  const assinaturas = criarAssinaturasRepositoryFake();
  assinaturas.definirLoja({ empreendedorId: 'emp-1', telefone: TELEFONE }, { plano, status: 'ATIVA' });
  const ia = criarInterpretadorRoteiroFake();
  const gestaoRepo = criarGestaoRepositoryFake({
    loja: LOJA_COMPLETA,
    lojaSalva: { existe: true, temLogo, temCapa: false, naoLembrarOpcionais: true },
  });
  const recortes: string[] = [];
  const deps: GestaoDeps = {
    conversationRepo,
    gestaoRepo,
    interpretador: ia,
    cadastro: criarCadastroPorLista([]),
    previas: { repo: criarPreviasRepositoryFake(), urlDaImagem: (id) => `http://front.test/api/previa/${id}` },
    planos: { repo: assinaturas, mensageiro: { enviarTexto: async () => undefined }, linkDosPlanos: 'https://zapmenu.test/#planos' },
    imagens: {
      prepararCapa: async (foto) => (recortes.push(`capa:${foto}`), 'data:image/jpeg;base64,CAPA1200x400'),
      prepararLogo: async (foto) => (recortes.push(`logo:${foto}`), 'data:image/png;base64,LOGO400'),
    },
  };
  const enviar = (texto: string, imagemUrl?: string) => processarMensagemGestao({ telefone: TELEFONE, texto, imagemUrl }, deps);
  return { enviar, gestaoRepo, ia, recortes, conversa: () => conversa };
}

const textos = (respostas: RespostaGestao[]) => respostas.filter((r): r is string => typeof r === 'string').join('\n---\n');
const imagens = (respostas: RespostaGestao[]) => respostas.filter((r) => typeof r === 'object' && 'imagemUrl' in r);
const enquetes = (respostas: RespostaGestao[]) => respostas.filter((r) => typeof r === 'object' && 'enquete' in r);

describe('capa e logo pelo WhatsApp', () => {
  it('lê a legenda', () => {
    expect(destinoDaLegenda('essa é a capa')).toBe('CAPA');
    expect(destinoDaLegenda('Esse é o logo')).toBe('LOGO');
    expect(destinoDaLegenda('pizza de calabresa')).toBeUndefined();
  });

  it('"essa é a capa": recorta, mostra a prévia do topo e só salva depois do "sim"', async () => {
    const cenario = criarCenario();
    const respostas = await cenario.enviar('essa é a capa', FOTO);

    expect(cenario.recortes).toEqual([`capa:${FOTO}`]);
    expect(imagens(respostas)).toHaveLength(1);
    expect(textos(respostas)).toContain('Foto de capa nova');
    expect(textos(respostas)).toContain('Confirma');
    expect(cenario.ia.entradas).toHaveLength(0);
    expect(cenario.gestaoRepo.salvos).toHaveLength(0);

    await cenario.enviar('sim');
    expect(cenario.gestaoRepo.salvos[0]?.rascunho.loja?.capaUrl).toBe('data:image/jpeg;base64,CAPA1200x400');
  });

  it('Básico: o logo vale, a capa é do Profissional', async () => {
    const capa = criarCenario('ESSENCIAL');
    expect(textos(await capa.enviar('essa é a capa', FOTO))).toContain('Isso faz parte do plano *Profissional*');
    expect(capa.recortes).toEqual([]);

    const logo = criarCenario('ESSENCIAL');
    expect(textos(await logo.enviar('esse é o logo', FOTO))).toContain('Logo nova');
    expect(logo.recortes).toEqual([`logo:${FOTO}`]);
  });

  it('foto sem legenda, sem item esperando foto: pergunta para quê ela é', async () => {
    const cenario = criarCenario();
    const pergunta = await cenario.enviar('', FOTO);
    expect(textos(pergunta)).toContain('Ela é de um item, a capa ou o logo da loja?');
    expect(enquetes(pergunta)).toHaveLength(1);

    const respostas = await cenario.enviar(OPCOES_DESTINO_FOTO[2]);
    expect(cenario.recortes).toEqual([`logo:${FOTO}`]);
    expect(textos(respostas)).toContain('Logo nova');
  });

  it('respondeu "item": a foto fica esperando o nome do item', async () => {
    const cenario = criarCenario();
    await cenario.enviar('', FOTO);
    expect(textos(await cenario.enviar(OPCOES_DESTINO_FOTO[0]))).toContain('De qual item é essa foto?');
    expect(cenario.conversa().contexto.fotoPendente).toBe(FOTO);
  });

  it('"tirar o logo": resumo e "sim" tiram a foto', async () => {
    const cenario = criarCenario('PROFISSIONAL', true);
    expect(textos(await cenario.enviar('tirar o logo'))).toContain('Tirar o logo');
    await cenario.enviar('sim');
    expect(cenario.gestaoRepo.salvos[0]?.rascunho.loja?.logoUrl).toBe('');
  });

  it('"tirar a capa" sem capa: avisa', async () => {
    const cenario = criarCenario();
    expect(textos(await cenario.enviar('tirar a capa'))).toContain('não tem foto de capa');
  });
});
