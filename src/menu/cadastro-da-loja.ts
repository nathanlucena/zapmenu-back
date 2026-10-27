/** O que é preciso saber da loja para dizer o que falta no cadastro. */
export interface LojaParaCadastro {
  nome?: string;
  slug?: string;
  aceitaRetirada?: boolean;
  fazEntrega?: boolean;
  /** Envio pelos Correios (varejo) também conta como forma de entregar. */
  aceitaEnvio?: boolean;
  /** Endereço confirmado (CEP + número → mapa → "sim"). */
  enderecoConfirmado: boolean;
  faixasEntrega?: unknown[];
  /** Taxa fixa de entrega e o modo escolhido (FIXA ou DISTANCIA). */
  taxaEntrega?: number;
  modoEntrega?: 'FIXA' | 'DISTANCIA';
  /** O plano inclui a entrega por distância. Ausente = inclui. */
  entregaPorDistancia?: boolean;
  horarios?: unknown[];
  descricao?: string;
  temLogo?: boolean;
  temCapa?: boolean;
  corDestaque?: string;
  pedidoMinimo?: number;
  /** Só na loja (varejo): entra nos opcionais. */
  segmento?: 'COMIDA' | 'VAREJO' | 'SERVICOS';
  politicaTroca?: string;
  instagram?: string;
}

export interface ItemDoCadastro {
  rotulo: string;
  ok: boolean;
  /** Como pedir este dado na conversa. */
  comoPedir: string;
}

/**
 * Os 6 dados obrigatórios para a loja receber pedidos. Os itens do cardápio
 * ficam de fora: são cadastrados depois, na conversa livre.
 */
export function obrigatoriosDaLoja(loja: LojaParaCadastro | null | undefined): ItemDoCadastro[] {
  const l = loja ?? { enderecoConfirmado: false };
  return [
    { rotulo: 'Nome da loja', ok: Boolean(l.nome?.trim()), comoPedir: 'Qual é o nome da sua loja?' },
    // Sem link escolhido, um é gerado pelo nome ao salvar.
    {
      rotulo: 'Link do cardápio',
      ok: Boolean(l.slug || l.nome?.trim()),
      comoPedir: 'Que link você quer para o cardápio? Ex.: pizzaria-do-ze',
    },
    {
      rotulo: 'Como entrega (retirada, entrega ou os dois)',
      ok: l.aceitaRetirada === true || l.fazEntrega === true || l.aceitaEnvio === true,
      comoPedir: 'Você faz entrega, só retirada no local ou os dois?',
    },
    {
      rotulo: 'Endereço da loja confirmado',
      ok: l.enderecoConfirmado,
      comoPedir: 'Qual é o CEP e o número do endereço da loja?',
    },
    ...(l.fazEntrega ? [itemDaTaxaDeEntrega(l)] : []),
    {
      rotulo: 'Horário de funcionamento',
      ok: (l.horarios?.length ?? 0) > 0,
      comoPedir: 'Quais dias e horários a loja funciona? Ex.: terça a domingo, 18h às 23h',
    },
  ];
}

/** Os opcionais que deixam a loja mais completa. Pagamento na entrega já vem ligado. */
export function opcionaisDaLoja(loja: LojaParaCadastro): ItemDoCadastro[] {
  return [
    { rotulo: 'Descrição da loja', ok: Boolean(loja.descricao?.trim()), comoPedir: 'uma frase sobre a loja' },
    { rotulo: 'Logo', ok: Boolean(loja.temLogo), comoPedir: 'mande a foto do logo dizendo que é o logo' },
    { rotulo: 'Foto de capa', ok: Boolean(loja.temCapa), comoPedir: 'mande uma foto dizendo que é a capa' },
    { rotulo: 'Cor da loja', ok: Boolean(loja.corDestaque), comoPedir: 'escolha uma cor da paleta' },
    { rotulo: 'Pedido mínimo', ok: loja.pedidoMinimo !== undefined, comoPedir: 'diga o valor mínimo de um pedido' },
    { rotulo: 'Instagram', ok: Boolean(loja.instagram), comoPedir: 'mande o @ da loja no Instagram' },
    ...(loja.segmento === 'VAREJO'
      ? [
          {
            rotulo: 'Política de troca',
            ok: Boolean(loja.politicaTroca?.trim()),
            comoPedir: 'diga como funcionam as trocas (ex.: troca em até 7 dias com etiqueta)',
          },
        ]
      : []),
  ];
}

export function cadastroCompleto(loja: LojaParaCadastro | null | undefined): boolean {
  return obrigatoriosDaLoja(loja).every((item) => item.ok);
}

/** "📋 Cadastro da loja (3 de 6)" com ✅/⬜ por item. */
export function descreverObrigatorios(loja: LojaParaCadastro | null | undefined): string {
  const itens = obrigatoriosDaLoja(loja);
  const feitos = itens.filter((item) => item.ok).length;
  return [
    `📋 *Cadastro da loja* (${feitos} de ${itens.length})`,
    ...itens.map((item) => `${item.ok ? '✅' : '⬜'} ${item.rotulo}`),
  ].join('\n');
}

/** Por distância (com o recurso no plano e escolhida) pede as faixas; senão, a taxa fixa. */
function itemDaTaxaDeEntrega(loja: LojaParaCadastro): ItemDoCadastro {
  const porDistancia = loja.entregaPorDistancia !== false && (loja.modoEntrega ?? 'DISTANCIA') === 'DISTANCIA';
  return porDistancia
    ? {
        rotulo: 'Taxas de entrega por distância',
        ok: (loja.faixasEntrega?.length ?? 0) > 0,
        comoPedir: 'Quanto cobra de entrega por distância? Ex.: até 2 km R$ 5, até 5 km R$ 8',
      }
    : {
        rotulo: 'Taxa de entrega',
        ok: loja.taxaEntrega !== undefined,
        comoPedir: 'Quanto cobra de entrega? É um valor só, e você pode dizer até onde entrega. Ex.: R$ 5 até 4 km',
      };
}
