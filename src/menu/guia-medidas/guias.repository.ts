import type { AlvoDoGuia, GuiaMedidas } from './guia-medidas.js';

export interface GuiasRepository {
  /** Grava o guia do alvo (substitui o que havia). Telefone do dono identifica a loja. */
  salvar(telefone: string, alvo: AlvoDoGuia, guia: GuiaMedidas): Promise<void>;
  remover(telefone: string, alvo: AlvoDoGuia): Promise<boolean>;
}
