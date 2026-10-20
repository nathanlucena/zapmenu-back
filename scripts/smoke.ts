/**
 * Smoke tests das integrações reais, um por adapter, usando os mesmos
 * `criar...Client` que o main.ts usa. Rodar só localmente (nunca no CI):
 *
 *   npm run smoke -- viacep
 *   npm run smoke -- google
 *   npm run smoke -- deepseek
 *   npm run smoke -- mercado-pago   (cria um PIX de R$ 1,00 no ambiente da chave)
 *   npm run smoke -- todos
 */
import { contextoInicial } from '../src/menu/conversation/conversation-state.types.js';
import { criarGoogleGeocodingClient } from '../src/menu/endereco/google-geocoding.client.js';
import { criarViaCepClient } from '../src/menu/endereco/viacep.client.js';
import { criarInterpretadorDeepSeek } from '../src/menu/gestao/deepseek-interpretador.js';
import { criarMercadoPagoClient } from '../src/payments/infra/mercado-pago.client.js';

const CEP_EXEMPLO = '01310100'; // Av. Paulista, São Paulo

function variavel(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(`Defina ${nome} no .env para rodar este smoke test.`);
  }
  return valor;
}

const smokes: Record<string, () => Promise<unknown>> = {
  async viacep() {
    const dados = await criarViaCepClient().buscarCep(CEP_EXEMPLO);
    if (!dados?.logradouro) throw new Error('ViaCEP não devolveu o logradouro.');
    return dados;
  },

  async google() {
    const geocodificador = criarGoogleGeocodingClient(variavel('GOOGLE_MAPS_API_KEY'));
    const resultado = await geocodificador.geocodificar('Avenida Paulista, 1000, São Paulo - SP, 01310-100');
    if (!resultado) throw new Error('Google Geocoding não encontrou o endereço de exemplo.');
    return resultado;
  },

  async deepseek() {
    const interpretador = criarInterpretadorDeepSeek({
      apiKey: variavel('DEEPSEEK_API_KEY'),
      modelo: process.env.DEEPSEEK_MODEL ?? 'deepseek-flash',
      baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    });
    const contexto = contextoInicial();
    const resposta = await interpretador.conversar({
      estado: 'OCIOSO',
      historico: [],
      mensagem: 'quero cadastrar pizza calabresa por 40 reais, tamanho M ou G com 10 a mais',
      fotoRecebida: false,
      fotoPendente: false,
      rascunho: contexto.rascunho,
      endereco: {},
      snapshot: { cardapioId: 'smoke', categorias: [], itens: [], loja: {} },
    });
    if (!resposta.operacoes.some((operacao) => operacao.tipo === 'NOVO_ITEM')) {
      throw new Error(`A IA não propôs NOVO_ITEM: ${JSON.stringify(resposta)}`);
    }
    return resposta;
  },

  async 'mercado-pago'() {
    const gateway = criarMercadoPagoClient(variavel('MERCADO_PAGO_ACCESS_TOKEN'));
    const cobranca = await gateway.criarCobrancaPix({
      valor: 1,
      descricao: 'Smoke test ZapMenu',
      referenciaExterna: `smoke-${Date.now()}`,
    });
    if (!cobranca.copiaCola) throw new Error('O Mercado Pago não devolveu o PIX copia e cola.');
    const consulta = await gateway.consultarPagamento(cobranca.idTransacaoExterno);
    return { idTransacaoExterno: cobranca.idTransacaoExterno, statusCriacao: cobranca.statusMp, statusConsulta: consulta.statusMp };
  },
};

async function rodar(nome: string): Promise<boolean> {
  const smoke = smokes[nome];
  if (!smoke) {
    console.error(`Smoke desconhecido: ${nome}. Opções: ${Object.keys(smokes).join(', ')}, todos.`);
    return false;
  }
  const inicio = Date.now();
  try {
    const resultado = await smoke();
    console.log(`✅ ${nome} (${Date.now() - inicio} ms)`);
    console.log(JSON.stringify(resultado, null, 2));
    return true;
  } catch (erro) {
    console.error(`❌ ${nome} (${Date.now() - inicio} ms): ${erro instanceof Error ? erro.message : String(erro)}`);
    return false;
  }
}

const alvo = process.argv[2] ?? 'todos';
const nomes = alvo === 'todos' ? Object.keys(smokes) : [alvo];
let tudoCerto = true;
for (const nome of nomes) {
  tudoCerto = (await rodar(nome)) && tudoCerto;
}
process.exit(tudoCerto ? 0 : 1);
