import type { Promocao } from '../../domain/promocao.js';

export interface LojaDasPromocoes {
  lojaId: string;
  telefone: string;
  fuso: string;
}

export type NovaPromocao = Omit<Promocao, 'id' | 'lojaId' | 'criadaEm' | 'avisoFimEm' | 'ativa'>;

export interface PromocoesRepository {
  /** Pelo telefone do dono (gestão) ou id do empreendedor. null = ainda não tem loja. */
  lojaDe(identificador: string): Promise<LojaDasPromocoes | null>;
  /** Todas as promoções da loja (ativas e pausadas), das mais antigas para as mais novas. */
  listar(lojaId: string): Promise<Promocao[]>;
  criar(lojaId: string, nova: NovaPromocao): Promise<Promocao>;
  definirAtiva(lojaId: string, promocaoId: string, ativa: boolean): Promise<void>;
  remover(lojaId: string, promocaoId: string): Promise<void>;
  /** Com fim já passado e ainda ativas, ou desligadas sem o aviso do fim: o que o job olha. */
  listarVencidas(agora: Date): Promise<{ loja: LojaDasPromocoes; promocao: Promocao }[]>;
  marcarAvisoFim(promocaoId: string, em: Date): Promise<void>;
}
