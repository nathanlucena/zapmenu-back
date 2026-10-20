import { chaveTelefone } from '../../shared/telefone/telefone.js';

/** Quem pode usar o número de gestão. */
export interface CadastroEmpreendedores {
  /** Id do empreendedor dono deste telefone, ou null se o número não tem acesso. */
  empreendedorIdDoTelefone(telefone: string): Promise<string | null>;
}

/**
 * Cadastro por lista de telefones permitidos. Lista vazia libera qualquer
 * número (o comportamento antigo), para não travar quem ainda não configurou.
 * Hoje o id do empreendedor é o próprio telefone.
 */
export function criarCadastroPorLista(telefonesPermitidos: string[]): CadastroEmpreendedores {
  const permitidos = new Set(telefonesPermitidos.map(chaveTelefone));
  return {
    async empreendedorIdDoTelefone(telefone) {
      if (permitidos.size === 0 || permitidos.has(chaveTelefone(telefone))) {
        return telefone;
      }
      return null;
    },
  };
}
