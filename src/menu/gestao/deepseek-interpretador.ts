import OpenAI from 'openai';
import { logger } from '../../shared/logger/logger.js';
import { z } from 'zod';
import { DIAS_SEMANA, type DadosLoja, type Variacao } from '../conversation/conversation-state.types.js';
import type { SegmentoLoja } from '../menu.types.js';
import { listaDaPaleta } from '../vitrine.js';
import type {
  DadosItemOperacao,
  EntradaConversa,
  InterpretadorMensagem,
  Operacao,
  RespostaConversa,
} from './interpretador.js';

export interface DeepSeekConfig {
  apiKey: string;
  modelo: string;
  baseURL: string;
}

export class RespostaInvalidaDaIA extends Error {}

// O prompt precisa conter a palavra "json" para o modo JSON do DeepSeek.
const PROMPT_BASE = `Você é o assistente de WhatsApp que ajuda donos de pequenos negócios a atualizar o próprio cardápio ou catálogo e os dados da loja, conversando de forma natural. O TIPO DA LOJA (no fim) diz o que existe para esta loja: nunca proponha nada fora dele.

COMO FUNCIONA
- Você NÃO salva nada. Você monta um rascunho de alterações por meio de "operacoes". Quando a pessoa disser que terminou, o sistema mostra um resumo e só grava se ela responder "sim".
- Nunca diga que salvou, publicou ou atualizou o cardápio. Diga que anotou.
- Responda em português do Brasil, curto (1 a 3 frases), simpático, no estilo WhatsApp (*negrito* com asteriscos). Não repita a lista inteira do rascunho a cada mensagem.
- Nunca invente preço, nome ou dado que a pessoa não disse. Se faltar algo importante (ex.: preço de um item novo), pergunte.

ENTRADA (json): etapa ("conversando" ou "confirmando"), historico (mensagens anteriores), mensagem (a atual), foto_recebida (a mensagem atual trouxe uma foto), foto_pendente (há uma foto recebida antes ainda sem item), rascunho (alterações já anotadas), endereco_em_andamento (partes do endereço já informadas), endereco_pendente (endereço encontrado no mapa esperando a pessoa confirmar), cardapio (categorias e itens atuais, numerados; na loja, cada produto traz a grade atual), loja (dados atuais), tipo_da_loja ("cardapio" ou "loja"), cadastro_pendente (dados obrigatórios que ainda faltam para a loja entrar no ar, na ordem, com a pergunta sugerida).

SAÍDA: responda SOMENTE com um objeto json:
{"resposta": "texto para a pessoa", "operacoes": [...], "finalizou": false, "mostrar_cardapio": false, "decisao": null}

VER O CARDÁPIO
- Você não consegue enviar a lista do cardápio por conta própria. Quando a pessoa pedir para ver o cardápio (ou os itens, preços, o que tem cadastrado), use "mostrar_cardapio": true e o sistema envia a lista completa logo depois da sua resposta.
- Nesse caso a resposta deve ser curta e apontar para baixo (ex.: "Claro! Aqui está 👇"). Nunca diga que mostrou o cardápio sem usar "mostrar_cardapio": true.

OPERAÇÕES (cada uma é um objeto com "tipo"):
- {"tipo": "novo_item", "ref": "n1", "nome": "...", "descricao": "...", "preco": 39.9, "categoria": "Pizzas", "variacoes": [...]} — item que ainda não existe. "ref" é um apelido único no formato n + número, que não exista em rascunho.novos_itens.
- {"tipo": "corrigir_novo_item", "ref": "n1", ...campos que mudam} — corrige um item de rascunho.novos_itens.
- {"tipo": "descartar_novo_item", "ref": "n1"}
- {"tipo": "editar_item", "item_id": "...", ...campos que mudam} — item que já existe em cardapio.itens. "categoria": null tira o item da categoria.
- {"tipo": "pausar_item", "item_id": "..."} — tirar do ar temporariamente (acabou, sem estoque).
- {"tipo": "reativar_item", "item_id": "..."} — voltar com um item pausado.
- {"tipo": "remover_item", "item_id": "..."} — apagar de vez.
- {"tipo": "desfazer_item", "item_id": "..."} — desfaz o que estava anotado para um item existente.
- {"tipo": "anexar_foto", "ref": "n1"} ou {"tipo": "anexar_foto", "item_id": "..."} — usa a foto recebida (ou a pendente).
- {"tipo": "anexar_foto_loja", "destino": "logo"} ou {"tipo": "anexar_foto_loja", "destino": "capa"} — usa a foto recebida (ou a pendente) como logo ou foto de capa da loja.
- {"tipo": "nova_categoria", "nome": "Bebidas"}
- {"tipo": "renomear_categoria", "categoria_id": "...", "novo_nome": "..."}
- {"tipo": "remover_categoria", "categoria_id": "..."} — os itens dela ficam sem categoria.
- {"tipo": "atualizar_loja", "nome": "...", "descricao": "...", "aceita_retirada": true, "faz_entrega": true, "faixas_entrega": [...], "pedido_minimo": 30, "horarios": [...], "link": "pizzaria-do-ze", "cor_destaque": "laranja", "aceita_pagamento_na_entrega": true} — só os campos que mudam (campos extras do tipo da loja no fim). Endereço NÃO vai aqui. aceita_pagamento_na_entrega: se o cliente pode pagar em dinheiro ou cartão na entrega/no balcão, além do PIX ("não aceito dinheiro", "só PIX" → false).
- {"tipo": "definir_endereco", "cep": "50050000", "numero": "123", "complemento": "loja 2"} — endereço da loja. Também aceita "rua", "bairro", "cidade", "uf" e "sem_numero": true.
- {"tipo": "confirmar_endereco"} / {"tipo": "recusar_endereco"} — resposta da pessoa quando endereco_pendente existe ("é aí mesmo" / "não é aí").
- {"tipo": "descartar_tudo"} — a pessoa quer jogar fora todas as alterações anotadas.

FORMATOS
- preco, pedido_minimo, taxa (das faixas), frete_envio, os valores de frete_por_uf e preco_adicional: número em reais com ponto decimal ("39,90" → 39.9; "42 reais" → 42).
- nome: nome do produto com iniciais maiúsculas, sem verbos ("coloca uma pizza calabresa" → "Pizza Calabresa"). descricao: detalhes (ingredientes, tamanho), sem o preço.
- faixas_entrega: lista COMPLETA (substitui a anterior), uma faixa por distância: [{"ate_km": 1, "taxa": 0}, {"ate_km": 3, "taxa": 5}]. "grátis", "de graça", "sem taxa" → taxa 0. "500 metros" → ate_km 0.5. A maior distância é o limite de entrega.
- horarios: lista COMPLETA da semana (substitui a anterior), um objeto por dia aberto: [{"dia": "seg", "abre": "18:00", "fecha": "23:00"}]. Dias: dom, seg, ter, qua, qui, sex, sab. Dias fechados não aparecem.
- link: endereço curto do cardápio, só letras minúsculas, números e hífens ("Pizzaria do Zé" → "pizzaria-do-ze"). Só quando a pessoa pedir para mudar o link.
- cor_destaque: a cor da loja (botões, destaques e a faixa da capa quando não há foto). Só existem estas cores: ${listaDaPaleta()}. Mande o nome da cor como a pessoa disse ("laranja", "3"), ou o código hex se ela mandar um; o sistema escolhe a cor mais parecida da lista. Se a pessoa não souber qual escolher ou perguntar as opções, mostre a lista numerada e sugira uma que combine com o tipo de loja, sem mandar cor_destaque até ela escolher.
- item_id e categoria_id: SOMENTE ids que existem em cardapio. A pessoa pode citar um item pelo nome ou pelo número da lista.

FOTOS
- Se foto_recebida for true e der para saber de qual item é (pela legenda ou pela conversa), use anexar_foto. Se não der, pergunte de qual item é — a foto fica pendente e você anexa depois.
- Se a pessoa manda uma foto junto com um item novo, crie o novo_item e o anexar_foto com a mesma ref na mesma resposta.
- Se a pessoa disser que a foto é o logo ou a capa da loja ("essa é a logo", "foto para a capa"), use anexar_foto_loja. Na dúvida entre item, logo e capa, pergunte.

CADASTRO DA LOJA
- Se cadastro_pendente não estiver vazio, a loja ainda NÃO está no ar e os clientes não conseguem pedir. Depois de responder o que a pessoa disse, peça o PRIMEIRO item de cadastro_pendente (um de cada vez, com a pergunta sugerida). Não peça itens do cardápio enquanto faltar cadastro, mas aceite se a pessoa mandar.
- Quando a pessoa responder um item do cadastro, gere a operação correspondente e peça o próximo. Quando o último for respondido, peça para ela dizer *pronto* para revisar e salvar.

ENDEREÇO E ENTREGA
- A entrega é cobrada por distância: precisa do endereço da loja e das faixas. Quando a pessoa quiser começar a entregar, peça o CEP e o número da loja (e o complemento, se tiver) e como ela cobra em cada faixa.
- definir_endereco leva SOMENTE o que a pessoa escreveu. Nunca complete rua, bairro ou cidade por conta própria: o sistema completa pelo CEP e procura no mapa.
- Se a pessoa digitar o endereço de outro jeito (por extenso, sem CEP, com CEP errado), use definir_endereco com as partes que der para separar.
- Correção ("o número é 132", "o CEP certo é 50050-010") → definir_endereco só com o campo que mudou.
- Ao usar definir_endereco, a resposta deve ser curta ou vazia (ex.: "Vou procurar 🔎"): o sistema mostra o endereço encontrado e pergunta se está certo. Nunca diga que encontrou, achou no mapa ou salvou o endereço.
- Se endereco_pendente existir e a pessoa confirmar ou negar com outras palavras, use confirmar_endereco ou recusar_endereco.
- Nunca fale de coordenadas, latitude ou longitude.
- "acima de 3 km cobro 10" sem dizer até onde entrega: NÃO invente limite; pergunte até quantos km ela entrega.
- "não entrego mais" → atualizar_loja com "faz_entrega": false.

FIM DA CONVERSA
- Quando a pessoa sinalizar que terminou ("é isso", "pronto", "só isso", "pode salvar", "terminei", "não, obrigado" depois de você perguntar se tem mais algo), use "finalizou": true. A resposta pode ser curta (ex.: "Perfeito! Veja o resumo:"), pois o sistema mostra o resumo logo depois.
- Se ela disser que terminou mas ainda falta dado essencial, pergunte o que falta e mantenha "finalizou": false.

ETAPA "confirmando" (o resumo já foi mostrado)
- Se a pessoa aprova ("sim", "pode", "manda", "isso"), use "decisao": "confirmar".
- Se recusa ("não", "espera", "tá errado"), use "decisao": "recusar" e pergunte o que ajustar.
- Se ela já pede uma correção, não use decisao: gere as operações e pergunte se tem mais algo.

`;

/** O que só existe no cardápio (comida). */
const BLOCO_CARDAPIO = `
TIPO DA LOJA: CARDÁPIO (comida)
- Fale em *cardápio* e *itens*.
- variacoes (adicionais, tamanhos com preço): lista COMPLETA de variações do item (substitui as anteriores): [{"nome": "Tamanho", "opcoes": [{"nome": "P", "preco_adicional": 0}, {"nome": "G", "preco_adicional": 15}]}]. O preço do item é o da opção mais barata; preco_adicional é a diferença.
- NÃO EXISTE neste tipo: grade de tamanhos e cores com estoque, envio pelos Correios e política de troca. Nunca use definir_grade, aceita_envio, frete_envio, frete_por_uf ou politica_troca. Se a pessoa pedir algo assim, explique numa frase que isso é do tipo *Loja* e que ela pode mandar *mudar tipo da loja*.

EXEMPLO
mensagem: "entrou pizza calabresa 39,90 e a coca agora é 15" (com a Coca 2L no cardápio com id "abc")
{"resposta": "Anotei a *Pizza Calabresa* e o novo preço da *Coca 2L*! Tem foto da pizza?", "operacoes": [{"tipo": "novo_item", "ref": "n1", "nome": "Pizza Calabresa", "preco": 39.9}, {"tipo": "editar_item", "item_id": "abc", "preco": 15}], "finalizou": false, "decisao": null}`;

/** O que só existe na loja (varejo). */
const BLOCO_LOJA = `
TIPO DA LOJA: LOJA (produtos: roupas, acessórios…)
- Fale em *catálogo* e *produtos*. Nunca diga cardápio, prato ou lanche. Os ids e operações continuam com os nomes "item" (novo_item, editar_item…).
- Tamanho e cor com estoque: {"tipo": "definir_grade", "ref": "n1"} (produto novo) ou {"tipo": "definir_grade", "item_id": "..."} (existente), com "grade": [{"tamanho": "P", "cor": "Azul", "estoque": 5}, ...]. É a lista COMPLETA (substitui a anterior). "P, M e G, azul e preto, 5 de cada" → 6 linhas. "preco" só na linha que custa diferente do produto. Produto sem cor ou sem tamanho: deixe o campo de fora.
- Estoque é número inteiro. Se a pessoa não disser quantas peças tem, PERGUNTE: nunca invente estoque. Para mudar só o estoque ("chegaram mais 3 M azul", "acabou o G preto"), mande a grade completa atual (cardapio.itens[].grade) com o número novo.
- Fotos: cada produto pode ter várias. Cada anexar_foto ACRESCENTA uma foto à galeria (não troca a anterior). Se a legenda disser a cor da peça na foto ("essa é a azul", "preta"), mande "cor": "Azul" no anexar_foto.
- NUNCA use variacoes (adicionais com preço) neste tipo. Se a pessoa pedir adicional, explique numa frase que adicionais são do tipo *Cardápio* e que ela pode mandar *mudar tipo da loja*.
- Envio pelos Correios em atualizar_loja: "aceita_envio": true, "frete_envio": 25 (frete fixo para o Brasil todo), "frete_por_uf": {"PE": 12} (só os estados com valor diferente). "envio pra todo o Brasil por 25, aqui em PE é 12" → aceita_envio true, frete_envio 25, frete_por_uf {"PE": 12}; "só envio pra PE e PB por 15" → frete_por_uf {"PE": 15, "PB": 15}, sem frete_envio.
- Política de troca em atualizar_loja: "politica_troca": texto curto e claro com o que a pessoa disse ("troco em 7 dias com etiqueta" → "Troca em até 7 dias, com a etiqueta."). Não invente prazo nem regra que ela não disse. Lembre que compra online tem 7 dias de arrependimento (CDC) se ela perguntar.

EXEMPLO
mensagem: "camiseta básica 59,90, tem P M e G na azul, 4 de cada"
{"resposta": "Anotei a *Camiseta Básica* com P, M e G na cor azul, 4 de cada! Tem foto?", "operacoes": [{"tipo": "novo_item", "ref": "n1", "nome": "Camiseta Básica", "preco": 59.9}, {"tipo": "definir_grade", "ref": "n1", "grade": [{"tamanho": "P", "cor": "Azul", "estoque": 4}, {"tamanho": "M", "cor": "Azul", "estoque": 4}, {"tamanho": "G", "cor": "Azul", "estoque": 4}]}], "finalizou": false, "decisao": null}`;

/** Prompt do tipo da loja: a IA só conhece as ações daquele tipo. */
export function promptDoSistema(segmento: SegmentoLoja | undefined): string {
  return PROMPT_BASE + (segmento === 'VAREJO' ? BLOCO_LOJA : BLOCO_CARDAPIO);
}

// ---------------------------------------------------------------------------
// Validação da saída
// ---------------------------------------------------------------------------

const texto = z
  .string()
  .nullish()
  .transform((valor) => valor?.trim() || undefined);

const numero = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((valor, ctx) => {
    if (valor === null || valor === undefined || valor === '') {
      return undefined;
    }
    const convertido = typeof valor === 'number' ? valor : Number(valor.replace(/[^\d,.-]/g, '').replace(',', '.'));
    if (!Number.isFinite(convertido) || convertido < 0) {
      ctx.addIssue({ code: 'custom', message: `valor inválido: ${valor}` });
      return z.NEVER;
    }
    return convertido;
  });

/** Aceita negativos: a validação das faixas (no código) explica o problema para a pessoa. */
const numeroLivre = z.union([z.number(), z.string()]).transform((valor, ctx) => {
  const convertido = typeof valor === 'number' ? valor : Number(valor.replace(/[^\d,.-]/g, '').replace(',', '.'));
  if (!Number.isFinite(convertido)) {
    ctx.addIssue({ code: 'custom', message: `valor inválido: ${valor}` });
    return z.NEVER;
  }
  return convertido;
});

const faixasEntrega = z
  .array(z.object({ ate_km: numeroLivre, taxa: numeroLivre }))
  .nullish()
  .transform((valor) => valor?.map((faixa) => ({ ateKm: faixa.ate_km, taxa: faixa.taxa })));

/** { "pe": "12,50" } → { PE: 12.5 }; UF com 2 letras. */
const fretePorUf = z
  .record(z.string().trim().regex(/^[a-z]{2}$/i), numeroLivre.pipe(z.number().nonnegative()))
  .nullish()
  .transform((valor) =>
    valor ? Object.fromEntries(Object.entries(valor).map(([uf, frete]) => [uf.toUpperCase(), frete])) : undefined,
  );

/** CEP e número podem vir como número no json. */
const textoOuNumero = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((valor) => (valor === null || valor === undefined ? undefined : String(valor).trim() || undefined));

const booleano = z
  .boolean()
  .nullish()
  .transform((valor) => valor ?? undefined);

const variacoes = z
  .array(
    z.object({
      nome: z.string().trim().min(1),
      opcoes: z
        .array(z.object({ nome: z.string().trim().min(1), preco_adicional: numero }))
        .min(1)
        .transform((opcoes) =>
          opcoes.map((opcao) => ({
            nome: opcao.nome,
            precoAdicional: opcao.preco_adicional ?? 0,
          })),
        ),
    }),
  )
  .nullish()
  .transform((valor) => valor ?? undefined);

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const horarios = z
  .array(
    z.object({
      dia: z.enum(DIAS_SEMANA),
      abre: z.string().regex(HORA),
      fecha: z.string().regex(HORA),
    }),
  )
  .nullish()
  .transform((valor) => valor ?? undefined);

const camposItem = {
  nome: texto,
  descricao: texto,
  preco: numero,
  categoria: z.string().trim().nullish(),
  variacoes,
};

function dadosItem(campos: {
  nome?: string;
  descricao?: string;
  preco?: number;
  categoria?: string | null;
  variacoes?: Variacao[];
}): DadosItemOperacao {
  return {
    nome: campos.nome,
    descricao: campos.descricao,
    precoBase: campos.preco,
    categoria: campos.categoria === '' ? null : campos.categoria,
    variacoes: campos.variacoes,
  };
}

const idObrigatorio = z.string().trim().min(1);

const operacaoSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('novo_item'), ref: texto, ...camposItem }).transform((op): Operacao => ({
    tipo: 'NOVO_ITEM',
    ref: op.ref,
    dados: dadosItem(op),
  })),
  z
    .object({
      tipo: z.literal('corrigir_novo_item'),
      ref: idObrigatorio,
      ...camposItem,
    })
    .transform((op): Operacao => ({
      tipo: 'CORRIGIR_NOVO_ITEM',
      ref: op.ref,
      dados: dadosItem(op),
    })),
  z.object({ tipo: z.literal('descartar_novo_item'), ref: idObrigatorio }).transform((op): Operacao => ({
    tipo: 'DESCARTAR_NOVO_ITEM',
    ref: op.ref,
  })),
  z
    .object({
      tipo: z.literal('editar_item'),
      item_id: idObrigatorio,
      ...camposItem,
    })
    .transform((op): Operacao => ({
      tipo: 'EDITAR_ITEM',
      itemId: op.item_id,
      dados: dadosItem(op),
    })),
  ...(['pausar_item', 'reativar_item', 'remover_item', 'desfazer_item'] as const).map((tipo) =>
    z.object({ tipo: z.literal(tipo), item_id: idObrigatorio }).transform((op): Operacao => ({
      tipo: op.tipo.toUpperCase() as 'PAUSAR_ITEM' | 'REATIVAR_ITEM' | 'REMOVER_ITEM' | 'DESFAZER_ITEM',
      itemId: op.item_id,
    })),
  ),
  z.object({ tipo: z.literal('anexar_foto'), ref: texto, item_id: texto, cor: texto }).transform((op): Operacao => ({
    tipo: 'ANEXAR_FOTO',
    ref: op.ref,
    itemId: op.item_id,
    cor: op.cor,
  })),
  z
    .object({
      tipo: z.literal('definir_grade'),
      ref: texto,
      item_id: texto,
      grade: z
        .array(z.object({ tamanho: textoOuNumero, cor: texto, estoque: numero, preco: numero }))
        .transform((linhas) =>
          linhas.map((linha) => ({ tamanho: linha.tamanho, cor: linha.cor, estoque: linha.estoque ?? 0, preco: linha.preco })),
        ),
    })
    .refine((op) => op.ref || op.item_id, 'definir_grade precisa de ref ou item_id')
    .transform((op): Operacao => ({ tipo: 'DEFINIR_GRADE', ref: op.ref, itemId: op.item_id, grade: op.grade })),
  z
    .object({
      tipo: z.literal('nova_categoria'),
      nome: z.string().trim().min(1),
    })
    .transform((op): Operacao => ({ tipo: 'NOVA_CATEGORIA', nome: op.nome })),
  z
    .object({
      tipo: z.literal('renomear_categoria'),
      categoria_id: idObrigatorio,
      novo_nome: z.string().trim().min(1),
    })
    .transform((op): Operacao => ({
      tipo: 'RENOMEAR_CATEGORIA',
      categoriaId: op.categoria_id,
      novoNome: op.novo_nome,
    })),
  z
    .object({
      tipo: z.literal('remover_categoria'),
      categoria_id: idObrigatorio,
    })
    .transform((op): Operacao => ({
      tipo: 'REMOVER_CATEGORIA',
      categoriaId: op.categoria_id,
    })),
  z
    .object({
      tipo: z.literal('atualizar_loja'),
      nome: texto,
      descricao: texto,
      aceita_retirada: booleano,
      faz_entrega: booleano,
      faixas_entrega: faixasEntrega,
      pedido_minimo: numero,
      horarios,
      link: texto,
      cor_destaque: texto,
      aceita_pagamento_na_entrega: booleano,
      aceita_envio: booleano,
      frete_envio: numero,
      frete_por_uf: fretePorUf,
      politica_troca: texto,
    })
    .transform((op): Operacao => ({
      tipo: 'ATUALIZAR_LOJA',
      dados: {
        nome: op.nome,
        descricao: op.descricao,
        aceitaRetirada: op.aceita_retirada,
        fazEntrega: op.faz_entrega,
        faixasEntrega: op.faixas_entrega,
        pedidoMinimo: op.pedido_minimo,
        horarios: op.horarios,
        slug: op.link,
        corDestaque: op.cor_destaque,
        aceitaPagamentoNaEntrega: op.aceita_pagamento_na_entrega,
        aceitaEnvio: op.aceita_envio,
        freteEnvio: op.frete_envio,
        fretePorUf: op.frete_por_uf,
        politicaTroca: op.politica_troca,
      },
    })),
  z
    .object({ tipo: z.literal('anexar_foto_loja'), destino: z.enum(['logo', 'capa']) })
    .transform((op): Operacao => ({ tipo: 'ANEXAR_FOTO_LOJA', destino: op.destino === 'logo' ? 'LOGO' : 'CAPA' })),
  z
    .object({
      tipo: z.literal('definir_endereco'),
      cep: textoOuNumero,
      numero: textoOuNumero,
      sem_numero: booleano,
      complemento: texto,
      rua: texto,
      bairro: texto,
      cidade: texto,
      uf: texto,
    })
    .transform((op): Operacao => ({
      tipo: 'DEFINIR_ENDERECO',
      dados: {
        cep: op.cep,
        numero: op.numero,
        semNumero: op.sem_numero || undefined,
        complemento: op.complemento,
        logradouro: op.rua,
        bairro: op.bairro,
        cidade: op.cidade,
        uf: op.uf?.toUpperCase(),
      },
    })),
  z.object({ tipo: z.literal('confirmar_endereco') }).transform((): Operacao => ({ tipo: 'CONFIRMAR_ENDERECO' })),
  z.object({ tipo: z.literal('recusar_endereco') }).transform((): Operacao => ({ tipo: 'RECUSAR_ENDERECO' })),
  z.object({ tipo: z.literal('descartar_tudo') }).transform((): Operacao => ({ tipo: 'DESCARTAR_TUDO' })),
]);

const respostaSchema = z.object({
  resposta: z
    .string()
    .nullish()
    .transform((valor) => valor?.trim() ?? ''),
  operacoes: z
    .array(z.unknown())
    .nullish()
    .transform((valor) => valor ?? []),
  finalizou: z
    .boolean()
    .nullish()
    .transform((valor) => valor ?? false),
  mostrar_cardapio: z
    .boolean()
    .nullish()
    .transform((valor) => valor ?? false),
  decisao: z
    .string()
    .nullish()
    .transform((valor) => {
      const normalizado = valor?.toLowerCase();
      return normalizado === 'confirmar' ? 'CONFIRMAR' : normalizado === 'recusar' ? 'RECUSAR' : undefined;
    }),
});

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/** Loja como a IA vê: endereço em texto e faixas, sem coordenadas nem a taxa fixa antiga. */
function lojaParaIA(loja: DadosLoja | undefined) {
  if (!loja) {
    return null;
  }
  // Fotos de logo e capa são data URIs enormes: a IA só precisa saber se vieram.
  const { enderecoVerificado, taxaEntrega: _taxaEntrega, logoUrl, capaUrl, ...resto } = loja;
  return {
    ...resto,
    endereco: enderecoVerificado?.enderecoFormatado ?? loja.endereco,
    ...(logoUrl && { nova_logo: true }),
    ...(capaUrl && { nova_capa: true }),
  };
}

/** Visão do estado para a IA: só ids, nomes e valores — nunca as fotos em base64. */
export function montarEntrada(entrada: EntradaConversa) {
  const { snapshot, rascunho } = entrada;
  const nomeItem = (itemId: string) => snapshot.itens.find((item) => item.id === itemId)?.nome;

  return {
    etapa: entrada.estado === 'CONFIRMANDO' ? 'confirmando' : 'conversando',
    historico: entrada.historico,
    mensagem: entrada.mensagem,
    foto_recebida: entrada.fotoRecebida,
    foto_pendente: entrada.fotoPendente,
    rascunho: {
      novos_itens: rascunho.novosItens.map(({ imagemUrl, fotos, ...item }) => ({
        ...item,
        tem_foto: Boolean(imagemUrl),
        ...(fotos?.length && { fotos: fotos.map((foto) => ({ cor: foto.cor ?? null })) }),
      })),
      edicoes: rascunho.edicoes.map(({ imagemUrl, fotos, ...edicao }) => ({
        ...edicao,
        nome_atual: nomeItem(edicao.itemId),
        nova_foto: Boolean(imagemUrl) || Boolean(fotos?.length),
        ...(fotos?.length && { fotos_novas: fotos.map((foto) => ({ cor: foto.cor ?? null })) }),
      })),
      status: rascunho.status.map((status) => ({
        ...status,
        nome: nomeItem(status.itemId),
      })),
      novas_categorias: rascunho.novasCategorias,
      categorias_renomeadas: rascunho.categoriasRenomeadas,
      categorias_removidas: rascunho.categoriasRemovidas,
      loja: lojaParaIA(rascunho.loja),
    },
    endereco_em_andamento: entrada.endereco.consultaEndereco ?? null,
    endereco_pendente: entrada.endereco.enderecoPendente?.endereco.enderecoFormatado ?? null,
    cardapio: {
      categorias: snapshot.categorias,
      itens: snapshot.itens.map((item, indice) => ({
        numero: indice + 1,
        id: item.id,
        nome: item.nome,
        descricao: item.descricao,
        preco: item.precoBase,
        categoria: item.categoriaNome ?? null,
        pausado: !item.ativo,
        tem_foto: item.temFoto,
        ...(entrada.segmento === 'VAREJO' ? { grade: item.grade ?? [] } : { variacoes: item.variacoes }),
      })),
    },
    loja: lojaParaIA(snapshot.loja),
    tipo_da_loja: entrada.segmento === 'VAREJO' ? 'loja' : 'cardapio',
    cadastro_pendente: entrada.cadastroPendente ?? [],
  };
}

/** Esperas antes de cada nova tentativa quando o DeepSeek recusa por sobrecarga. */
const ESPERAS_RETRY_MS = [1_500, 4_000];

/**
 * Sobrecarga (429/5xx) volta em ~1s, então vale tentar de novo. Timeout não:
 * a pessoa já esperou 45s e repetir dobraria a espera.
 */
function ehSobrecarga(erro: unknown): boolean {
  return (
    erro instanceof OpenAI.APIError &&
    !(erro instanceof OpenAI.APIConnectionTimeoutError) &&
    erro.status !== undefined &&
    (erro.status === 429 || erro.status >= 500)
  );
}

async function comRetryEmSobrecarga<T>(chamar: () => Promise<T>): Promise<T> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await chamar();
    } catch (erro) {
      const espera = ESPERAS_RETRY_MS[tentativa];
      if (espera === undefined || !ehSobrecarga(erro)) {
        throw erro;
      }
      logger.warn(
        {
          modulo: 'deepseek',
          status: (erro as InstanceType<typeof OpenAI.APIError>).status,
          esperaMs: espera,
        },
        '🔁 DeepSeek sobrecarregado, tentando de novo',
      );
      await new Promise((resolve) => setTimeout(resolve, espera));
    }
  }
}

/** Valida o JSON devolvido pela IA e o converte para o contrato da conversa. */
export function interpretarRespostaDaIA(conteudo: string | null | undefined): RespostaConversa {
  if (!conteudo) {
    // A documentação do DeepSeek avisa que o modo JSON às vezes devolve vazio.
    throw new RespostaInvalidaDaIA('DeepSeek devolveu uma resposta vazia.');
  }

  let json: unknown;
  try {
    json = JSON.parse(conteudo);
  } catch {
    throw new RespostaInvalidaDaIA(`DeepSeek devolveu JSON inválido: ${conteudo.slice(0, 200)}`);
  }

  const parsed = respostaSchema.safeParse(json);
  if (!parsed.success) {
    throw new RespostaInvalidaDaIA(`Resposta da IA fora do formato: ${parsed.error.message}`);
  }

  // Cada operação é validada sozinha: uma malformada não derruba as outras.
  const operacoes: Operacao[] = [];
  const operacoesMalformadas: string[] = [];
  for (const bruta of parsed.data.operacoes) {
    const operacao = operacaoSchema.safeParse(bruta);
    if (operacao.success) {
      operacoes.push(operacao.data);
    } else {
      operacoesMalformadas.push(JSON.stringify(bruta).slice(0, 200));
    }
  }

  return {
    resposta: parsed.data.resposta,
    operacoes,
    operacoesMalformadas,
    finalizou: parsed.data.finalizou,
    mostrarCardapio: parsed.data.mostrar_cardapio,
    decisao: parsed.data.decisao,
  };
}

export function criarInterpretadorDeepSeek(config: DeepSeekConfig): InterpretadorMensagem {
  const cliente = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    // A pessoa está esperando no WhatsApp: melhor falhar e pedir para repetir
    // do que esperar minutos. O retry do SDK também repetia timeouts, por isso
    // fica desligado e só sobrecarga é repetida (comRetryEmSobrecarga).
    timeout: 45_000,
    maxRetries: 0,
  });

  return {
    async conversar(entrada) {
      const inicio = Date.now();
      const resposta = await comRetryEmSobrecarga(() =>
        cliente.chat.completions.create({
          model: config.modelo,
          temperature: 0.3,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: promptDoSistema(entrada.segmento) },
            { role: 'user', content: JSON.stringify(montarEntrada(entrada)) },
          ],
        }),
      );

      logger.info(
        {
          modulo: 'deepseek',
          ms: Date.now() - inicio,
          tokensEntrada: resposta.usage?.prompt_tokens,
          tokensSaida: resposta.usage?.completion_tokens,
          tokensRaciocinio: resposta.usage?.completion_tokens_details?.reasoning_tokens,
        },
        '⏱️  chamada ao DeepSeek',
      );

      return interpretarRespostaDaIA(resposta.choices[0]?.message.content);
    },
  };
}
