import { afterEach, describe, expect, it, vi } from 'vitest';
import { criarAssinaturasRepositoryFake } from '../planos/__mocks__/assinaturas.repository.fake.js';
import { criarTranscritorFake } from './__mocks__/transcritor.fake.js';
import { AUDIO_DESLIGADO, AUDIO_LONGO, NAO_OUVI, ouvirAudio } from './application/ouvir-audio.js';
import { criarTranscritorOpenAiCompativel } from './infra/transcritor-openai-compativel.js';

const TELEFONE = '5581999990000';
const AUDIO = { dados: new Uint8Array([1, 2, 3]), mimetype: 'audio/ogg; codecs=opus', segundos: 20 };
const AGORA = new Date('2026-10-20T15:00:00Z');

function cenario(plano: 'ESSENCIAL' | 'PROFISSIONAL' = 'PROFISSIONAL', status: 'ATIVA' | 'TESTE' = 'ATIVA') {
  const cotas = criarAssinaturasRepositoryFake();
  cotas.definirLoja({ empreendedorId: 'emp-1', telefone: TELEFONE }, { plano, status });
  const transcritor = criarTranscritorFake();
  return { cotas, transcritor, deps: { transcritor, cotas, linkDosPlanos: 'https://zapmenu.test/#planos' } };
}

describe('transcrição de áudio', () => {
  afterEach(() => vi.useRealTimers());

  it('Profissional: transcreve e desconta os segundos da cota do mês', async () => {
    const { deps, cotas, transcritor } = cenario();
    expect(await ouvirAudio(deps, TELEFONE, AUDIO, 'LOJISTA', AGORA)).toEqual({ tipo: 'TEXTO', texto: 'entrou pizza de calabresa 40 reais' });
    expect(transcritor.recebidos[0]?.mimetype).toBe('audio/ogg; codecs=opus');
    expect(await cotas.usoDaCota('emp-1', 'minutosAudioMes', '2026-10')).toBe(20);
  });

  it('cota de 60 minutos: quando acaba, pede para escrever', async () => {
    const { deps, cotas } = cenario();
    await cotas.somarUsoDaCota('emp-1', 'minutosAudioMes', '2026-10', 60 * 60 - 10);
    const resultado = await ouvirAudio(deps, TELEFONE, AUDIO, 'LOJISTA', AGORA);
    expect(resultado).toEqual({ tipo: 'RESPOSTA', texto: expect.stringContaining('minutos de áudio do seu plano neste mês acabaram') });
  });

  it('Básico: convite para o Profissional ao lojista; ao cliente, só o pedido para escrever', async () => {
    const { deps, transcritor } = cenario('ESSENCIAL');
    expect((await ouvirAudio(deps, TELEFONE, AUDIO, 'LOJISTA', AGORA)).texto).toContain('Isso faz parte do plano *Profissional*');
    expect(await ouvirAudio(deps, TELEFONE, AUDIO, 'CLIENTE', AGORA)).toEqual({ tipo: 'RESPOSTA', texto: AUDIO_DESLIGADO });
    expect(transcritor.recebidos).toHaveLength(0);
  });

  it('teste grátis usa a cota do Profissional', async () => {
    const { deps } = cenario('ESSENCIAL', 'TESTE');
    expect((await ouvirAudio(deps, TELEFONE, AUDIO, 'LOJISTA', AGORA)).tipo).toBe('TEXTO');
  });

  it('sem chave configurada, mais de 2 min ou sem dados: pede para escrever', async () => {
    const { deps } = cenario();
    expect(await ouvirAudio({ ...deps, transcritor: undefined }, TELEFONE, AUDIO, 'LOJISTA')).toEqual({ tipo: 'RESPOSTA', texto: AUDIO_DESLIGADO });
    expect(await ouvirAudio(deps, TELEFONE, { ...AUDIO, segundos: 121 }, 'LOJISTA')).toEqual({ tipo: 'RESPOSTA', texto: AUDIO_LONGO });
    expect(await ouvirAudio(deps, TELEFONE, { mimetype: 'audio/ogg', segundos: 10 }, 'LOJISTA')).toEqual({ tipo: 'RESPOSTA', texto: NAO_OUVI });
  });

  it('falha ou mais de 15 s: "Não consegui ouvir o áudio" e a cota não é descontada', async () => {
    const { deps, cotas, transcritor } = cenario();
    transcritor.falhar = true;
    expect(await ouvirAudio(deps, TELEFONE, AUDIO, 'LOJISTA', AGORA)).toEqual({ tipo: 'RESPOSTA', texto: NAO_OUVI });

    vi.useFakeTimers();
    transcritor.falhar = false;
    transcritor.nuncaResponder = true;
    const promessa = ouvirAudio(deps, TELEFONE, AUDIO, 'LOJISTA', AGORA);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await promessa).toEqual({ tipo: 'RESPOSTA', texto: NAO_OUVI });
    expect(await cotas.usoDaCota('emp-1', 'minutosAudioMes', '2026-10')).toBe(0);
  });
});

describe('adaptador compatível com a OpenAI', () => {
  it('manda o arquivo, o modelo e o idioma para /audio/transcriptions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'oi' }), { status: 200 }));
    const transcritor = criarTranscritorOpenAiCompativel(
      { url: 'https://api.groq.com/openai/v1/', chave: 'gsk-teste', modelo: 'whisper-large-v3' },
      fetchMock as unknown as typeof fetch,
    );

    expect(await transcritor.transcrever(AUDIO)).toBe('oi');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(init.headers).toEqual({ Authorization: 'Bearer gsk-teste' });
    const corpo = init.body as FormData;
    expect(corpo.get('model')).toBe('whisper-large-v3');
    expect(corpo.get('language')).toBe('pt');
    expect((corpo.get('file') as File).name).toBe('audio.ogg');
  });

  it('erro HTTP vira falha', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    const transcritor = criarTranscritorOpenAiCompativel({ url: 'https://x', chave: 'k', modelo: 'm' }, fetchMock as unknown as typeof fetch);
    await expect(transcritor.transcrever(AUDIO)).rejects.toThrow('401');
  });
});
