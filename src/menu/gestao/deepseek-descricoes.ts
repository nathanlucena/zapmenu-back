import OpenAI from 'openai';
import { z } from 'zod';
import { caberNaDescricao, type GeradorDeDescricoes, type ProdutoParaDescrever } from './gerador-de-descricoes.js';

/** As regras que impedem a IA de inventar: vale também para quem lê o código. */
export function promptDasDescricoes(produto: ProdutoParaDescrever): string {
  const tom =
    produto.segmento === 'VAREJO'
      ? 'de loja de roupas e produtos: direto, valorizando caimento, uso e combinação'
      : 'de cardápio de delivery: apetitoso, curto, falando do sabor e de como é servido';
  return `Você escreve descrições de produtos para uma vitrine no tom ${tom}.
Escreva 2 opções diferentes, em português do Brasil, com no máximo 200 caracteres cada.
REGRAS:
- Use SOMENTE as informações dadas (nome, descrição atual, categoria, detalhes). Não invente ingrediente, material, tecido, tamanho, peso, quantidade, origem, marca ou modo de preparo que não foi citado.
- Sem promessas ou superlativos ("o melhor da cidade", "imperdível", "o mais vendido"), sem preço, sem emojis, sem hashtags.
- Se houver pouca informação, escreva frases simples a partir do nome, sem completar com detalhes inventados.
Responda só com JSON: {"opcoes": ["primeira", "segunda"]}`;
}

const respostaSchema = z.object({ opcoes: z.array(z.string().min(1)).min(2) });

export interface ConfigDescricoesDeepSeek {
  apiKey: string;
  modelo: string;
  baseURL: string;
}

export function criarGeradorDeDescricoesDeepSeek(config: ConfigDescricoesDeepSeek): GeradorDeDescricoes {
  const cliente = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: 30_000, maxRetries: 1 });
  return {
    async sugerir(produto) {
      const resposta = await cliente.chat.completions.create({
        model: config.modelo,
        temperature: 0.7,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: promptDasDescricoes(produto) },
          {
            role: 'user',
            content: JSON.stringify({
              nome: produto.nome,
              descricao_atual: produto.descricaoAtual ?? null,
              categoria: produto.categoria ?? null,
              detalhes: produto.detalhes ?? [],
            }),
          },
        ],
      });
      const { opcoes } = respostaSchema.parse(JSON.parse(resposta.choices[0]?.message?.content ?? '{}'));
      return [caberNaDescricao(opcoes[0]!), caberNaDescricao(opcoes[1]!)];
    },
  };
}
