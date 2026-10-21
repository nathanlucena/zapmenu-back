import type { HorarioFuncionamento } from '../../domain/horario-loja.js';
import type { EnderecoEntrega } from '../../domain/pedido.js';

export interface FaixaTaxaEntrega {
  ateKm: number;
  taxa: number;
}

/** O que a loja configurou e que vale para aceitar ou recusar um pedido. */
export interface RegrasDaLoja {
  aceitaRetirada: boolean;
  fazEntrega: boolean;
  /** Dinheiro ou cartão na entrega/balcão, além do PIX. */
  aceitaPagamentoNaEntrega: boolean;
  /** Todos os dados obrigatórios preenchidos (nome, endereço, horário…). Sem isso, não recebe pedidos. */
  cadastroCompleto: boolean;
  /** Coordenada do endereço verificado da loja; sem ela não há entrega. */
  origem?: { latitude: number; longitude: number };
  faixasEntrega: FaixaTaxaEntrega[];
  pedidoMinimo?: number;
  horarios: HorarioFuncionamento[];
  fuso?: string;
}

export interface LojaParaPedidos {
  /** null = loja não existe. */
  regrasDe(empreendedorId: string): Promise<RegrasDaLoja | null>;
}

/** Endereço como o cliente digitou no app. */
export interface EnderecoDigitado {
  cep?: string;
  logradouro?: string;
  numero?: string;
  semNumero?: boolean;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

export type ResultadoLocalizacao =
  | {
      tipo: 'ENCONTRADO';
      endereco: Omit<EnderecoEntrega, 'distanciaKm'>;
      avisos: string[];
    }
  | { tipo: 'INVALIDO'; motivo: string }
  | { tipo: 'NAO_ENCONTRADO' }
  | { tipo: 'INDISPONIVEL' };

/** Transforma o endereço digitado numa coordenada (ViaCEP + mapa). */
export interface LocalizadorEndereco {
  localizar(endereco: EnderecoDigitado): Promise<ResultadoLocalizacao>;
}
