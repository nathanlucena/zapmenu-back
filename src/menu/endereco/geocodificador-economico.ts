import { IntegracaoError } from '../../shared/errors/integracao-error.js';
import type { Geocodificador, ResultadoGeocodificacao } from './endereco.types.js';

/** Os termos do Google Maps permitem guardar a coordenada por até 30 dias. */
const VALIDADE_ENCONTRADO_MS = 30 * 24 * 60 * 60 * 1000;
/** "Não achei" pode mudar quando o mapa é atualizado; guarda por menos tempo. */
const VALIDADE_NAO_ENCONTRADO_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRADAS = 5_000;

export interface OpcoesGeocodificadorEconomico {
  /** Consultas ao Google por dia. 0 = sem limite interno (fica só a cota do Console). */
  limiteDiario: number;
  agora?: () => number;
}

interface Entrada {
  resultado: ResultadoGeocodificacao | null;
  expiraEm: number;
}

/** "R. da Aurora,  123" e "r. da aurora, 123" são a mesma busca. */
function chaveDaBusca(endereco: string): string {
  return endereco.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * O dia da cota do Google vira à meia-noite do horário do Pacífico; o limite
 * interno vira junto para os dois contarem o mesmo dia.
 */
function diaDaCota(agora: number): string {
  return new Date(agora).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/**
 * Guarda as respostas do Google em memória e para de consultar ao passar do
 * limite do dia, para o uso ficar dentro da faixa grátis. A cotação de entrega
 * e a criação do pedido buscam o mesmo endereço, e o cliente que volta à
 * sacola também: tudo isso sai do cache.
 *
 * O cache e o contador zeram quando o servidor reinicia, então a garantia de
 * verdade é a cota configurada no Console do Google; isto só evita gastá-la à toa.
 */
export function comCacheELimite(geocodificador: Geocodificador, opcoes: OpcoesGeocodificadorEconomico): Geocodificador & {
  /** Consultas feitas ao Google no dia atual (para log e testes). */
  consultasHoje(): number;
} {
  const agora = opcoes.agora ?? Date.now;
  // Map guarda a ordem de inserção: a primeira chave é a mais antiga.
  const cache = new Map<string, Entrada>();
  const emAndamento = new Map<string, Promise<ResultadoGeocodificacao | null>>();
  let dia = diaDaCota(agora());
  let consultas = 0;

  function virarDia() {
    const hoje = diaDaCota(agora());
    if (hoje !== dia) {
      dia = hoje;
      consultas = 0;
    }
  }

  function guardar(chave: string, resultado: ResultadoGeocodificacao | null) {
    cache.delete(chave);
    if (cache.size >= MAX_ENTRADAS) {
      cache.delete(cache.keys().next().value!);
    }
    const validade = resultado ? VALIDADE_ENCONTRADO_MS : VALIDADE_NAO_ENCONTRADO_MS;
    cache.set(chave, { resultado, expiraEm: agora() + validade });
  }

  async function consultarGoogle(chave: string, endereco: string) {
    virarDia();
    if (opcoes.limiteDiario > 0 && consultas >= opcoes.limiteDiario) {
      throw new IntegracaoError(
        'google',
        `Limite interno de ${opcoes.limiteDiario} consultas por dia ao Google Geocoding atingido.`,
        false,
      );
    }
    consultas += 1;
    const resultado = await geocodificador.geocodificar(endereco);
    guardar(chave, resultado);
    return resultado;
  }

  return {
    async geocodificar(endereco) {
      const chave = chaveDaBusca(endereco);
      const guardada = cache.get(chave);
      if (guardada && guardada.expiraEm > agora()) {
        return guardada.resultado;
      }
      cache.delete(chave);

      // Duas buscas iguais ao mesmo tempo (cotação + pedido) viram uma só consulta.
      const pendente = emAndamento.get(chave);
      if (pendente) {
        return pendente;
      }
      const consulta = consultarGoogle(chave, endereco).finally(() => emAndamento.delete(chave));
      emAndamento.set(chave, consulta);
      return consulta;
    },
    consultasHoje() {
      virarDia();
      return consultas;
    },
  };
}
