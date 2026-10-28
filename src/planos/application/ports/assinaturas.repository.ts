import type { Assinatura } from '../../domain/assinatura.js';

/** O que a assinatura precisa saber da loja: para quem avisar e em que fuso contar o mês. */
export interface LojaDaAssinatura {
  /** Id interno do empreendedor (o mesmo de Pedido.empreendedorId). */
  empreendedorId: string;
  telefone: string;
  fuso: string;
  nome?: string;
}

export interface AssinaturaDaLoja {
  loja: LojaDaAssinatura;
  /** Ausente: loja anterior aos planos, ainda sem assinatura gravada (tratada como em teste). */
  assinatura?: Assinatura;
}

export interface AssinaturasRepository {
  /**
   * Pelo id do empreendedor, telefone ou link da loja. null = empreendedor não existe.
   * Só lê: nada é criado.
   */
  obter(identificador: string): Promise<AssinaturaDaLoja | null>;
  /** Como `obter`, mas grava o TESTE se a loja ainda não tem assinatura. */
  obterOuIniciarTeste(identificador: string, agora: Date): Promise<(AssinaturaDaLoja & { assinatura: Assinatura }) | null>;
  porPreapproval(mpPreapprovalId: string): Promise<(AssinaturaDaLoja & { assinatura: Assinatura }) | null>;
  salvar(assinatura: Assinatura): Promise<void>;
  /** As que o job diário olha: em teste, pendentes e canceladas. */
  listarParaVerificar(): Promise<(AssinaturaDaLoja & { assinatura: Assinatura })[]>;
  /** Pedidos que viraram venda (PAGO ou CONFIRMADO) no intervalo [de, ate). */
  contarVendas(empreendedorId: string, de: Date, ate: Date): Promise<number>;
  /** Produtos no cardápio (ativos e pausados, sem os removidos). */
  contarProdutos(empreendedorId: string): Promise<number>;
  /** Quanto já foi usado da cota no mês ("2026-10"). Áudio em segundos. */
  usoDaCota(empreendedorId: string, chave: ChaveDeCota, mes: string): Promise<number>;
  somarUsoDaCota(empreendedorId: string, chave: ChaveDeCota, mes: string, quantidade: number): Promise<void>;
}

/** Cotas mensais do plano que o app consome. */
export type ChaveDeCota = 'minutosAudioMes' | 'sugestoesIaMes';
