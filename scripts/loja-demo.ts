/**
 * Monta as lojas de exemplo para testar o app do cliente sem passar pela
 * conversa de gestão. São as mesmas que o botão "Ver exemplo" da landing abre:
 *
 *   npm run loja-demo                              cria (ou completa) as duas
 *   npm run loja-demo -- restaurante               só o restaurante (Pizzaria do Zé)
 *   npm run loja-demo -- loja                      só a loja de produtos (Casa Alecrim)
 *   npm run loja-demo -- --telefone 55119…         dono do restaurante
 *   npm run loja-demo -- --telefone-loja 55119…    dono da loja
 *   npm run loja-demo -- apagar [restaurante|loja] remove as duas (ou só uma) e tudo delas
 *
 * Os donos também podem vir em LOJA_DEMO_TELEFONE (restaurante) e
 * LOJA_DEMO_TELEFONE_LOJA (loja). É para o dono que vão o resumo do pedido e a
 * enquete de aceite; com os números fictícios padrão, o modo autoteste bloqueia
 * esses envios. Use o número exatamente como aparece no log ("telefone": …).
 * Cada loja precisa de um dono diferente.
 *
 * Se o telefone já for de um empreendedor sem loja (ex.: quem já conversou com
 * a gestão), a loja de exemplo passa para ele. Se ele já tiver outra loja, nada
 * é alterado.
 *
 * Depois abra http://localhost:3001/pizzaria-do-ze e http://localhost:3001/casa-alecrim
 * com o front rodando. Só mexe nas lojas de exemplo e nos seus donos; o resto
 * do banco fica intacto.
 */
import type { Prisma } from '@prisma/client';
import { getPrismaClient } from '../src/shared/db/prisma-client.js';

// Fotos desenhadas em SVG para não depender de arquivos nem da internet. Os
// desenhos são os mesmos do celular da landing (zapmenu-front,
// src/features/landing/fotos-de-exemplo.ts): mudou aqui, mude lá.

function svg(largura: number, altura: number, fundo: string, desenho: string): string {
  const conteudo = `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}"><rect width="${largura}" height="${altura}" fill="${fundo}"/>${desenho}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(conteudo)}`;
}

/** Mistura a cor com preto (peso > 0) ou branco (peso < 0), para sombra e brilho. */
function tom(hex: string, peso: number): string {
  const alvo = peso > 0 ? 0 : 255;
  const canais = [1, 3, 5].map((inicio) => parseInt(hex.slice(inicio, inicio + 2), 16));
  return `#${canais.map((canal) => Math.round(canal + (alvo - canal) * Math.abs(peso)).toString(16).padStart(2, '0')).join('')}`;
}

const CHAO = '<ellipse cx="200" cy="398" rx="130" ry="16" fill="#000" opacity=".08"/>';

/** Desenhos de produto num quadro de 400 x 500. */
const DESENHOS = {
  caneca: (cor: string) =>
    `${CHAO}<path d="M292 225h20a42 42 0 0 1 0 84h-20" fill="none" stroke="${tom(cor, 0.12)}" stroke-width="22"/>` +
    `<rect x="105" y="175" width="195" height="222" rx="28" fill="${cor}" stroke="${tom(cor, 0.12)}" stroke-width="3"/>` +
    `<ellipse cx="202" cy="178" rx="96" ry="14" fill="${tom(cor, 0.25)}"/>` +
    `<rect x="126" y="200" width="16" height="170" rx="8" fill="#fff" opacity=".2"/>`,
  vela: (cor: string) =>
    `${CHAO}<rect x="128" y="200" width="144" height="198" rx="20" fill="#fff" opacity=".6" stroke="#c9c1b6" stroke-width="3"/>` +
    `<rect x="138" y="245" width="124" height="143" rx="14" fill="${cor}"/>` +
    `<rect x="152" y="300" width="96" height="46" rx="6" fill="#fff" opacity=".85"/>` +
    `<path d="M168 318h64M178 330h44" stroke="#8a7f72" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M200 246v-24" stroke="#3b3027" stroke-width="4"/>` +
    `<path d="M200 160c20 24 20 44 0 58c-20-14-20-34 0-58Z" fill="#f2a93b"/>` +
    `<path d="M200 186c8 10 8 21 0 27c-8-6-8-17 0-27Z" fill="#fde6a8"/>`,
  almofada: (cor: string) =>
    `${CHAO}<path d="M105 165Q200 145 295 165Q318 270 295 375Q200 395 105 375Q82 270 105 165Z" fill="${cor}"/>` +
    `<path d="M122 182Q200 166 278 182Q296 270 278 358Q200 374 122 358Q104 270 122 182Z" fill="none" stroke="${tom(cor, 0.3)}" stroke-width="3" stroke-dasharray="7 7" opacity=".6"/>` +
    `<path d="M150 200Q200 190 250 200" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".18" fill="none"/>`,
  manta: (cor: string) =>
    `${CHAO}<rect x="75" y="300" width="250" height="92" rx="24" fill="${tom(cor, 0.18)}"/>` +
    `<rect x="75" y="232" width="250" height="92" rx="24" fill="${tom(cor, 0.08)}"/>` +
    `<rect x="75" y="164" width="250" height="92" rx="24" fill="${cor}"/>` +
    `<path d="M115 180v60M150 180v60M185 180v60M220 180v60M255 180v60M290 180v60" stroke="${tom(cor, 0.35)}" stroke-width="5" stroke-dasharray="9 7" opacity=".45"/>` +
    `<path d="M95 392v16M115 392v16M135 392v16M155 392v16M175 392v16M195 392v16M215 392v16M235 392v16M255 392v16M275 392v16M295 392v16" stroke="${tom(cor, 0.18)}" stroke-width="5" stroke-linecap="round"/>`,
  vaso: (cor: string) =>
    `${CHAO}<path d="M200 182c-8-60 10-110 46-140" stroke="#5f6b3a" stroke-width="5" fill="none"/>` +
    `<ellipse cx="236" cy="70" rx="12" ry="24" transform="rotate(40 236 70)" fill="#6f7337"/>` +
    `<ellipse cx="212" cy="112" rx="11" ry="22" transform="rotate(-35 212 112)" fill="#7d8443"/>` +
    `<ellipse cx="222" cy="150" rx="10" ry="20" transform="rotate(45 222 150)" fill="#6f7337"/>` +
    `<path d="M162 168h76v28c52 30 72 92 56 150c-10 38-46 52-94 52s-84-14-94-52c-16-58 4-120 56-150Z" fill="${cor}" stroke="${tom(cor, 0.12)}" stroke-width="3"/>` +
    `<ellipse cx="200" cy="170" rx="38" ry="8" fill="${tom(cor, 0.3)}"/>`,
  prato: (cor: string) =>
    `${CHAO}<circle cx="200" cy="270" r="150" fill="${cor}" stroke="${tom(cor, 0.12)}" stroke-width="3"/>` +
    `<circle cx="200" cy="270" r="100" fill="${tom(cor, -0.18)}"/>` +
    `<circle cx="200" cy="270" r="122" fill="none" stroke="${tom(cor, 0.2)}" stroke-width="3" opacity=".5"/>`,
  jogoAmericano: (cor: string) =>
    `${CHAO}<rect x="80" y="160" width="240" height="230" rx="8" fill="${cor}"/>` +
    `<path d="M80 190h240M80 225h240M80 260h240M80 295h240M80 330h240M80 365h240" stroke="#fff" stroke-width="3" opacity=".18"/>` +
    `<path d="M80 165v220M320 165v220" stroke="${tom(cor, 0.25)}" stroke-width="8" stroke-dasharray="3 6"/>` +
    `<circle cx="200" cy="275" r="72" fill="#f6f2ea" stroke="#d8d0c4" stroke-width="3"/>`,
  kit: (cor: string) =>
    `${CHAO}<rect x="100" y="215" width="200" height="180" rx="10" fill="${cor}"/>` +
    `<rect x="88" y="190" width="224" height="52" rx="8" fill="${tom(cor, 0.15)}"/>` +
    `<rect x="188" y="190" width="24" height="205" fill="#f2eee6"/>` +
    `<path d="M200 190c-30-46-82-36-62-6c10 14 40 10 62 6Zm0 0c30-46 82-36 62-6c-10 14-40 10-62 6Z" fill="#f2eee6" stroke="#d8cfc0" stroke-width="3"/>`,
};

type Desenho = keyof typeof DESENHOS;

/** Foto de produto em retrato (4:5), como pede o cartão da loja. */
function fotoDeProduto(desenho: Desenho, cor: string, fundo = '#EEE8DF'): string {
  return svg(400, 500, fundo, DESENHOS[desenho](cor));
}

/** Capa da loja: prateleira com alguns produtos. */
function capaDaLoja(): string {
  const produto = (desenho: Desenho, cor: string, x: number, y: number, escala: number) =>
    `<g transform="translate(${x} ${y}) scale(${escala})">${DESENHOS[desenho](cor)}</g>`;
  return svg(
    800,
    600,
    '#E9E1D5',
    '<rect y="482" width="800" height="118" fill="#D9CBB7"/><rect y="470" width="800" height="18" fill="#A5622B"/>' +
      produto('vaso', '#B4532A', 110, 294, 0.42) +
      produto('caneca', '#4D8B31', 310, 246, 0.55) +
      produto('vela', '#EFE6D2', 520, 266, 0.5),
  );
}

/** Foto de pizza (paisagem). */
function fotoDePizza(fundo: string, recheio: string): string {
  return svg(
    400,
    300,
    fundo,
    '<circle cx="200" cy="150" r="105" fill="#E9B872"/><circle cx="200" cy="150" r="88" fill="#F3C27A"/>' +
      `<circle cx="165" cy="120" r="14" fill="${recheio}"/><circle cx="232" cy="168" r="14" fill="${recheio}"/>` +
      `<circle cx="218" cy="110" r="12" fill="${recheio}"/><circle cx="172" cy="182" r="12" fill="${recheio}"/>`,
  );
}

// Amostras com os mesmos tons das bolinhas de cor da vitrine (front, lib/cores-de-roupa.ts).
const COR = {
  Branco: '#FAFAF9',
  Creme: '#EFE6D2',
  Bege: '#D9C7A7',
  Cinza: '#8A8F94',
  Azul: '#2557D6',
  Verde: '#4D8B31',
  Oliva: '#6F7337',
  Mostarda: '#C9952B',
  Terracota: '#B4532A',
} as const;

type NomeDaCor = keyof typeof COR;

const TAMANHO = {
  nome: 'Tamanho',
  opcoes: [
    { nome: 'Pequena (P)', precoAdicional: 0 },
    { nome: 'Média (M)', precoAdicional: 8 },
    { nome: 'Grande (G)', precoAdicional: 15 },
  ],
};
const BORDA = {
  nome: 'Borda',
  opcoes: [
    { nome: 'Tradicional', precoAdicional: 0 },
    { nome: 'Catupiry', precoAdicional: 6 },
    { nome: 'Cheddar', precoAdicional: 7 },
  ],
};

interface ItemDemo {
  nome: string;
  descricao?: string;
  preco: number;
  imagemUrl?: string;
  variacoes?: { nome: string; opcoes: { nome: string; precoAdicional: number }[] }[];
  /** Loja (varejo): galeria, a primeira é a capa do produto. */
  fotos?: { url: string; cor?: string }[];
  /** Loja (varejo): tamanho e/ou cor com estoque próprio. */
  skus?: { tamanho?: string; cor?: string; estoque: number; preco?: number }[];
}

/** Produto com uma foto por cor e um SKU por cor, cada um com seu estoque. */
function porCor(
  desenho: Desenho,
  estoques: Partial<Record<NomeDaCor, number>>,
): Pick<ItemDemo, 'fotos' | 'skus'> {
  const cores = Object.entries(estoques) as [NomeDaCor, number][];
  return {
    fotos: cores.map(([cor]) => ({ url: fotoDeProduto(desenho, COR[cor]), cor })),
    skus: cores.map(([cor, estoque]) => ({ cor, estoque })),
  };
}

const CARDAPIO_RESTAURANTE: { categoria: string; itens: ItemDemo[] }[] = [
  {
    categoria: 'Pizzas',
    itens: [
      { nome: 'Calabresa', descricao: 'Molho, calabresa, cebola roxa', preco: 28, imagemUrl: fotoDePizza('#7A3B1D', '#B5462B'), variacoes: [TAMANHO, BORDA] },
      { nome: 'Margherita', descricao: 'Molho, muçarela, manjericão e azeite', preco: 30, imagemUrl: fotoDePizza('#2F5D3A', '#C0392B'), variacoes: [TAMANHO, BORDA] },
      { nome: 'Portuguesa', descricao: 'Presunto, ovo, cebola, azeitona e muçarela', preco: 32, imagemUrl: fotoDePizza('#5A3A1A', '#4A4A2A'), variacoes: [TAMANHO, BORDA] },
      { nome: 'Quatro queijos', descricao: 'Muçarela, provolone, parmesão e gorgonzola', preco: 34, variacoes: [TAMANHO, BORDA] },
      { nome: 'Frango com catupiry', descricao: 'Frango desfiado, catupiry e milho', preco: 33, variacoes: [TAMANHO, BORDA] },
    ],
  },
  {
    categoria: 'Bebidas',
    itens: [
      { nome: 'Coca-Cola 2L', preco: 14 },
      { nome: 'Guaraná lata', descricao: '350 ml', preco: 8 },
      {
        nome: 'Suco natural',
        descricao: '500 ml',
        preco: 10,
        variacoes: [{ nome: 'Sabor', opcoes: [{ nome: 'Laranja', precoAdicional: 0 }, { nome: 'Maracujá', precoAdicional: 0 }, { nome: 'Abacaxi com hortelã', precoAdicional: 1 }] }],
      },
    ],
  },
  {
    categoria: 'Sobremesas',
    itens: [
      { nome: 'Pizza de chocolate', descricao: 'Chocolate ao leite e morangos', preco: 36, imagemUrl: fotoDePizza('#3B2416', '#8E2C48') },
      { nome: 'Pudim', descricao: 'Fatia do pudim de leite da casa', preco: 12 },
    ],
  },
];

// Estoque variado de propósito: tem cor esgotada, "últimas peças" e um produto todo esgotado.
const CATALOGO_LOJA: { categoria: string; itens: ItemDemo[] }[] = [
  {
    categoria: 'Casa',
    itens: [
      {
        nome: 'Vela aromática de alecrim',
        descricao: 'Cera de soja e pavio de algodão, aroma de alecrim com lavanda. Queima por até 40 horas (P).',
        preco: 39.9,
        fotos: [{ url: fotoDeProduto('vela', COR.Creme) }],
        skus: [
          { tamanho: 'P', estoque: 12 },
          { tamanho: 'M', estoque: 6, preco: 54.9 },
          { tamanho: 'G', estoque: 2, preco: 69.9 },
        ],
      },
      {
        nome: 'Almofada de linho',
        descricao: 'Capa de linho com zíper e enchimento, 45 x 45 cm.',
        preco: 79.9,
        ...porCor('almofada', { Bege: 5, Terracota: 3, Verde: 0 }),
      },
      {
        nome: 'Manta de tricô',
        descricao: 'Algodão, 1,20 x 1,60 m. Para o sofá ou o pé da cama.',
        preco: 159.9,
        ...porCor('manta', { Creme: 4, Mostarda: 2, Cinza: 6 }),
      },
      {
        nome: 'Vaso de cerâmica',
        descricao: 'Feito à mão, 20 cm de altura. Cada peça sai um pouco diferente.',
        preco: 89.9,
        ...porCor('vaso', { Terracota: 0, Branco: 0 }),
      },
    ],
  },
  {
    categoria: 'Cozinha e mesa',
    itens: [
      {
        nome: 'Caneca de cerâmica',
        descricao: '300 ml, esmaltada à mão. Vai ao micro-ondas e à lava-louças.',
        preco: 49.9,
        ...porCor('caneca', { Branco: 8, Verde: 5, Terracota: 2, Azul: 0 }),
      },
      {
        nome: 'Prato raso artesanal',
        descricao: 'Cerâmica esmaltada, 27 cm.',
        preco: 39.9,
        ...porCor('prato', { Creme: 10, Azul: 4 }),
      },
      {
        nome: 'Jogo americano de linho',
        descricao: 'Kit com 2, 45 x 33 cm.',
        preco: 69.9,
        ...porCor('jogoAmericano', { Bege: 6, Oliva: 3 }),
      },
    ],
  },
  {
    categoria: 'Presentes',
    itens: [
      // Sem tamanho nem cor: vende como um item de comida, sem estoque.
      {
        nome: 'Kit presente',
        descricao: 'Caneca, vela P e um cartão escrito à mão, em caixa de presente.',
        preco: 99.9,
        imagemUrl: fotoDeProduto('kit', COR.Verde),
      },
      {
        nome: 'Kit mesa posta',
        descricao: '2 pratos rasos e 2 jogos americanos, em caixa de presente.',
        preco: 189.9,
        imagemUrl: fotoDeProduto('kit', COR.Terracota),
      },
    ],
  },
];

// Aberta o dia todo, para dar para testar a qualquer hora (o horário é obrigatório no cadastro).
// Troque por algo como [{ dia: 'ter', abre: '18:00', fecha: '23:00' }] para ver o "Fechado".
const SEMPRE_ABERTA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'].map((dia) => ({ dia, abre: '00:00', fecha: '23:59' }));

interface Demo {
  /** Como a loja é chamada nos argumentos e no log. */
  tipo: 'restaurante' | 'loja';
  slug: string;
  telefoneFicticio: string;
  argumentoTelefone: string;
  variavelTelefone: string;
  nomeDoDono: string;
  dadosLoja: Omit<Prisma.LojaUncheckedCreateInput, 'empreendedorId' | 'slug'> & { nome: string };
  catalogo: { categoria: string; itens: ItemDemo[] }[];
}

const DEMOS: Demo[] = [
  {
    tipo: 'restaurante',
    slug: 'pizzaria-do-ze',
    telefoneFicticio: '5519900000001',
    argumentoTelefone: '--telefone',
    variavelTelefone: 'LOJA_DEMO_TELEFONE',
    nomeDoDono: 'Zé (exemplo)',
    dadosLoja: {
      nome: 'Pizzaria do Zé',
      descricao: 'Pizzas de fermentação longa',
      segmento: 'COMIDA',
      segmentoDefinido: true,
      endereco: 'Av. Brasil, 450 - Centro, Campinas - SP, 13010-000',
      logradouro: 'Avenida Brasil',
      numero: '450',
      bairro: 'Centro',
      cidade: 'Campinas',
      uf: 'SP',
      cep: '13010000',
      latitude: -22.9056,
      longitude: -47.0608,
      aceitaRetirada: true,
      fazEntrega: true,
      faixasEntrega: [
        { ateKm: 2, taxa: 5 },
        { ateKm: 4, taxa: 8 },
        { ateKm: 6, taxa: 12 },
      ],
      pedidoMinimo: 30,
      horarios: SEMPRE_ABERTA,
      capaUrl: fotoDePizza('#5A2A14', '#B5462B'),
      corDestaque: '#C2410C',
      instagram: 'pizzariadoze.demo',
    },
    catalogo: CARDAPIO_RESTAURANTE,
  },
  {
    tipo: 'loja',
    slug: 'casa-alecrim',
    telefoneFicticio: '5519900000002',
    argumentoTelefone: '--telefone-loja',
    variavelTelefone: 'LOJA_DEMO_TELEFONE_LOJA',
    nomeDoDono: 'Ana (exemplo)',
    dadosLoja: {
      nome: 'Casa Alecrim',
      descricao: 'Casa, mesa e presentes feitos à mão',
      segmento: 'VAREJO',
      segmentoDefinido: true,
      endereco: 'R. Barão de Jaguara, 1200 - Centro, Campinas - SP, 13015-002',
      logradouro: 'Rua Barão de Jaguara',
      numero: '1200',
      bairro: 'Centro',
      cidade: 'Campinas',
      uf: 'SP',
      cep: '13015002',
      latitude: -22.9035,
      longitude: -47.0573,
      aceitaRetirada: true,
      fazEntrega: false,
      faixasEntrega: [],
      aceitaEnvio: true,
      freteEnvio: 25,
      fretePorUf: { SP: 15 },
      cepOrigem: '13015002',
      horarios: SEMPRE_ABERTA,
      capaUrl: capaDaLoja(),
      corDestaque: '#1F7A4D',
      instagram: 'alecrim.demo',
      politicaTroca:
        'Troca em até 7 dias após o recebimento, com a peça sem uso e na embalagem.\n' +
        'Para trocar, fale com a gente no WhatsApp. O frete da troca por defeito é por nossa conta.',
    },
    catalogo: CATALOGO_LOJA,
  },
];

const prisma = getPrismaClient(process.env.DATABASE_URL ?? '');

function telefoneDoDono(demo: Demo): string {
  const indice = process.argv.indexOf(demo.argumentoTelefone);
  const informado = indice >= 0 ? process.argv[indice + 1] : process.env[demo.variavelTelefone];
  const telefone = (informado ?? '').replace(/\D/g, '');
  return telefone || demo.telefoneFicticio;
}

/** Dono atual da loja de exemplo: quem tem o link dela, ou o número fictício. */
async function donoDaLojaDemo(demo: Demo) {
  const loja = await prisma.loja.findUnique({ where: { slug: demo.slug }, include: { empreendedor: true } });
  return loja?.empreendedor ?? (await prisma.empreendedor.findUnique({ where: { telefone: demo.telefoneFicticio } }));
}

async function apagar(demo: Demo): Promise<void> {
  const nome = demo.dadosLoja.nome;
  const empreendedor = await donoDaLojaDemo(demo);
  if (!empreendedor) {
    console.log(`${nome}: não existe.`);
    return;
  }
  // Um empreendedor de verdade (que recebeu a loja de exemplo) continua existindo, com a conversa dele.
  const apagaDono = empreendedor.telefone === demo.telefoneFicticio;
  const pedidos = await prisma.pedido.findMany({ where: { empreendedorId: empreendedor.id }, select: { id: true } });
  const pedidoIds = pedidos.map((pedido) => pedido.id);
  const doCardapio = { item: { cardapio: { empreendedorId: empreendedor.id } } };
  await prisma.$transaction([
    prisma.pagamento.deleteMany({ where: { pedidoId: { in: pedidoIds } } }),
    prisma.itemPedido.deleteMany({ where: { pedidoId: { in: pedidoIds } } }),
    prisma.pedido.deleteMany({ where: { id: { in: pedidoIds } } }),
    prisma.variacao.deleteMany({ where: doCardapio }),
    prisma.sku.deleteMany({ where: doCardapio }),
    prisma.fotoProduto.deleteMany({ where: doCardapio }),
    prisma.itemCardapio.deleteMany({ where: { cardapio: { empreendedorId: empreendedor.id } } }),
    prisma.categoria.deleteMany({ where: { cardapio: { empreendedorId: empreendedor.id } } }),
    prisma.cardapio.deleteMany({ where: { empreendedorId: empreendedor.id } }),
    prisma.loja.deleteMany({ where: { empreendedorId: empreendedor.id } }),
    ...(apagaDono
      ? [
          prisma.estadoConversa.deleteMany({ where: { empreendedorId: empreendedor.id } }),
          prisma.empreendedor.delete({ where: { id: empreendedor.id } }),
        ]
      : []),
  ]);
  console.log(`${nome}: apagada (${pedidoIds.length} pedidos de teste junto).`);
}

/**
 * Deixa a loja de exemplo (se já existir) com o dono pedido. Se o telefone já
 * é de outro empreendedor sem loja, a loja, o cardápio e os pedidos de teste
 * passam para ele e o dono fictício é apagado.
 */
async function trocarDono(demo: Demo, telefone: string): Promise<void> {
  const atual = await donoDaLojaDemo(demo);
  if (!atual || atual.telefone === telefone) {
    return;
  }
  const alvo = await prisma.empreendedor.findUnique({
    where: { telefone },
    include: { loja: true, cardapio: { include: { _count: { select: { itens: true, categorias: true } } } } },
  });
  if (!alvo) {
    await prisma.empreendedor.update({ where: { id: atual.id }, data: { telefone } });
    console.log(`${demo.dadosLoja.nome}: dono trocado de ${atual.telefone} para ${telefone}.`);
    return;
  }
  if (alvo.loja) {
    throw new Error(`O telefone ${telefone} já é dono da loja "${alvo.loja.nome ?? 'sem nome'}". Nada foi alterado.`);
  }
  const cardapioDoAlvoVazio = alvo.cardapio && alvo.cardapio._count.itens === 0 && alvo.cardapio._count.categorias === 0;
  if (alvo.cardapio && !cardapioDoAlvoVazio) {
    throw new Error(`O telefone ${telefone} já tem um cardápio com itens. Nada foi alterado.`);
  }

  await prisma.$transaction([
    ...(alvo.cardapio ? [prisma.cardapio.delete({ where: { id: alvo.cardapio.id } })] : []),
    prisma.loja.updateMany({ where: { empreendedorId: atual.id }, data: { empreendedorId: alvo.id } }),
    prisma.cardapio.updateMany({ where: { empreendedorId: atual.id }, data: { empreendedorId: alvo.id } }),
    prisma.pedido.updateMany({ where: { empreendedorId: atual.id }, data: { empreendedorId: alvo.id } }),
    ...(atual.telefone === demo.telefoneFicticio
      ? [
          prisma.estadoConversa.deleteMany({ where: { empreendedorId: atual.id } }),
          prisma.empreendedor.delete({ where: { id: atual.id } }),
        ]
      : []),
  ]);
  console.log(`${demo.dadosLoja.nome}: passada de ${atual.telefone} para ${telefone}.`);
}

async function criar(demo: Demo): Promise<void> {
  const telefone = telefoneDoDono(demo);
  const slugOcupado = await prisma.loja.findUnique({ where: { slug: demo.slug }, include: { empreendedor: true } });
  const dono = await donoDaLojaDemo(demo);
  if (slugOcupado && dono && slugOcupado.empreendedorId !== dono.id) {
    throw new Error(`O link "${demo.slug}" já é de outra loja (${slugOcupado.nome ?? 'sem nome'}). Nada foi alterado.`);
  }
  await trocarDono(demo, telefone);

  const empreendedor = await prisma.empreendedor.upsert({
    where: { telefone },
    update: {},
    create: { telefone, nome: demo.nomeDoDono },
  });
  const outraLoja = await prisma.loja.findUnique({ where: { empreendedorId: empreendedor.id } });
  if (outraLoja && outraLoja.slug !== demo.slug) {
    throw new Error(`O telefone ${telefone} já é dono da loja "${outraLoja.nome ?? 'sem nome'}". Nada foi alterado.`);
  }

  const dadosLoja = { ...demo.dadosLoja, slug: demo.slug };
  await prisma.loja.upsert({
    where: { empreendedorId: empreendedor.id },
    update: dadosLoja,
    create: { empreendedorId: empreendedor.id, ...dadosLoja },
  });

  const cardapio = await prisma.cardapio.upsert({
    where: { empreendedorId: empreendedor.id },
    update: {},
    create: { empreendedorId: empreendedor.id, publicadoEm: new Date() },
  });

  // Item que já existe (pelo nome) fica como está: o estoque mexido nos testes não volta.
  let criados = 0;
  for (const [ordem, secao] of demo.catalogo.entries()) {
    const categoria = await prisma.categoria.upsert({
      where: { cardapioId_nome: { cardapioId: cardapio.id, nome: secao.categoria } },
      update: { ordem },
      create: { cardapioId: cardapio.id, nome: secao.categoria, ordem },
    });
    for (const item of secao.itens) {
      const existe = await prisma.itemCardapio.findFirst({
        where: { cardapioId: cardapio.id, nome: item.nome, removidoEm: null },
      });
      if (existe) continue;
      await prisma.itemCardapio.create({
        data: {
          cardapioId: cardapio.id,
          categoriaId: categoria.id,
          nome: item.nome,
          descricao: item.descricao,
          precoBase: item.preco,
          imagemUrl: item.imagemUrl,
          variacoes: { create: item.variacoes ?? [] },
          fotos: { create: (item.fotos ?? []).map((foto, ordemDaFoto) => ({ ...foto, ordem: ordemDaFoto })) },
          skus: { create: item.skus ?? [] },
        },
      });
      criados++;
    }
  }

  console.log(`${demo.dadosLoja.nome} pronta (${criados} itens novos, dono ${telefone}).`);
  console.log(`  Abra http://localhost:3001/${demo.slug} com o front rodando.`);
}

const TIPOS = DEMOS.map((demo) => demo.tipo);
const apagando = process.argv[2] === 'apagar';
const tipoPedido = process.argv.slice(2).find((argumento) => (TIPOS as string[]).includes(argumento));
const escolhidas = DEMOS.filter((demo) => !tipoPedido || demo.tipo === tipoPedido);

try {
  for (const demo of escolhidas) {
    await (apagando ? apagar(demo) : criar(demo));
  }
} finally {
  await prisma.$disconnect();
}
