import { logger as loggerRaiz } from '../../shared/logger/logger.js';
import type { ConsultaEndereco, EnderecoVerificado } from '../conversation/conversation-state.types.js';
import type { DadosCep, EnderecoDeps } from './endereco.types.js';

const logger = loggerRaiz.child({ modulo: 'endereco' });

/** O mapa não achou o número exato: o ponto é o centro da rua ou da região. */
const PRECISOES_BAIXAS = new Set(['GEOMETRIC_CENTER', 'APPROXIMATE']);

export type ResultadoBuscaEndereco =
  | { tipo: 'ENCONTRADO'; endereco: EnderecoVerificado; avisos: string[] }
  | { tipo: 'CEP_INVALIDO'; cep: string }
  | { tipo: 'CEP_NAO_ENCONTRADO'; cep: string }
  | { tipo: 'FALTA_NUMERO' }
  /** Sem CEP, e sem rua ou cidade: não dá para procurar. */
  | { tipo: 'DADOS_INSUFICIENTES' }
  | { tipo: 'NAO_ENCONTRADO' }
  /** ViaCEP/Google fora do ar ou recusando. */
  | { tipo: 'INDISPONIVEL' };

/** "50.050-000", "50050 000" → "50050000". */
export function normalizarCep(cep: string): string {
  return cep.replace(/\D/g, '');
}

/** "50050000" → "50050-000". */
export function formatarCep(cep: string): string {
  return cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
}

/** Soma uma correção parcial ao que já foi informado; campos ausentes não apagam nada. */
export function mesclarConsulta(atual: ConsultaEndereco = {}, nova: ConsultaEndereco): ConsultaEndereco {
  const resultado: ConsultaEndereco = { ...atual };
  for (const [chave, valor] of Object.entries(nova) as [keyof ConsultaEndereco, never][]) {
    if (valor !== undefined) {
      resultado[chave] = valor;
    }
  }
  // Informar um número desfaz o "sem número" (e vice-versa).
  if (nova.numero !== undefined) {
    delete resultado.semNumero;
  } else if (nova.semNumero) {
    delete resultado.numero;
  }
  return resultado;
}

/**
 * Transforma o que a pessoa digitou num endereço com coordenada: completa rua,
 * bairro e cidade pelo CEP (ViaCEP) e pede a coordenada ao Google. Não decide
 * nada sozinho: quem confirma é a pessoa.
 */
export async function buscarEndereco(consulta: ConsultaEndereco, deps: EnderecoDeps): Promise<ResultadoBuscaEndereco> {
  const cep = consulta.cep !== undefined ? normalizarCep(consulta.cep) : undefined;
  if (cep !== undefined && cep.length !== 8) {
    return { tipo: 'CEP_INVALIDO', cep: consulta.cep! };
  }
  if (!cep && !(consulta.logradouro && consulta.cidade)) {
    return { tipo: 'DADOS_INSUFICIENTES' };
  }
  if (!consulta.numero && !consulta.semNumero) {
    return { tipo: 'FALTA_NUMERO' };
  }

  let dadosCep: DadosCep | null = null;
  if (cep) {
    try {
      dadosCep = await deps.consultaCep.buscarCep(cep);
    } catch (erro) {
      // Sem ViaCEP ainda dá para tentar no Google com o CEP no texto.
      logger.warn({ err: erro }, 'ViaCEP indisponível, seguindo só com o Google');
    }
    if (dadosCep === null && !(consulta.logradouro && consulta.cidade)) {
      return { tipo: 'CEP_NAO_ENCONTRADO', cep: formatarCep(cep) };
    }
  }

  // Os dados do CEP valem mais que o digitado (menos erro de digitação).
  const logradouro = dadosCep?.logradouro ?? consulta.logradouro;
  const bairro = dadosCep?.bairro ?? consulta.bairro;
  const cidade = dadosCep?.cidade ?? consulta.cidade;
  const uf = dadosCep?.uf ?? consulta.uf;
  const numero = consulta.numero ?? 's/n';

  const textoBusca = [
    logradouro,
    consulta.numero,
    bairro,
    [cidade, uf].filter(Boolean).join(' - '),
    cep && formatarCep(cep),
    'Brasil',
  ]
    .filter(Boolean)
    .join(', ');

  let geo;
  try {
    geo = await deps.geocodificador.geocodificar(textoBusca);
  } catch (erro) {
    logger.warn({ err: erro }, 'geocodificação indisponível');
    return { tipo: 'INDISPONIVEL' };
  }
  if (!geo) {
    return { tipo: 'NAO_ENCONTRADO' };
  }

  const avisos: string[] = [];
  if (consulta.semNumero || PRECISOES_BAIXAS.has(geo.precisao)) {
    avisos.push('⚠️ Achei a rua, mas não o número exato. O ponto pode estar até algumas quadras de distância.');
  } else if (geo.correspondenciaParcial) {
    avisos.push('⚠️ O mapa achou um endereço parecido, mas não idêntico ao que você mandou. Confira com atenção.');
  }
  if (cep && geo.cep && geo.cep !== cep) {
    avisos.push(`⚠️ O mapa indica o CEP ${formatarCep(geo.cep)}, diferente do que você mandou (${formatarCep(cep)}).`);
  }

  const endereco: EnderecoVerificado = {
    cep: cep ?? geo.cep,
    logradouro: geo.logradouro ?? logradouro,
    numero,
    complemento: consulta.complemento,
    bairro: geo.bairro ?? bairro,
    cidade: geo.cidade ?? cidade,
    uf: geo.uf ?? uf,
    enderecoFormatado: consulta.complemento ? `${geo.enderecoFormatado} (${consulta.complemento})` : geo.enderecoFormatado,
    latitude: geo.latitude,
    longitude: geo.longitude,
    precisao: geo.precisao,
  };
  return { tipo: 'ENCONTRADO', endereco, avisos };
}

export function linkMapa(endereco: Pick<EnderecoVerificado, 'latitude' | 'longitude'>): string {
  return `https://maps.google.com/?q=${endereco.latitude.toFixed(6)},${endereco.longitude.toFixed(6)}`;
}
