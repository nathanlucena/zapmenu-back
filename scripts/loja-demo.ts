/**
 * Monta uma loja de exemplo para testar o app do cliente sem passar pela
 * conversa de gestão:
 *
 *   npm run loja-demo            cria (ou completa) a Pizzaria do Zé
 *   npm run loja-demo -- apagar  remove a loja de exemplo e tudo dela
 *
 * Depois abra http://localhost:3001/pizzaria-do-ze com o front rodando.
 * Só mexe no empreendedor de telefone TELEFONE_DEMO; o resto do banco fica intacto.
 */
import { getPrismaClient } from '../src/shared/db/prisma-client.js';

const TELEFONE_DEMO = '5519900000001';
const SLUG = 'pizzaria-do-ze';

// Fotos desenhadas em SVG para não depender de arquivos nem da internet.
function foto(fundo: string, recheio: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
<rect width="400" height="300" fill="${fundo}"/>
<circle cx="200" cy="150" r="105" fill="#E9B872"/><circle cx="200" cy="150" r="88" fill="#F3C27A"/>
<circle cx="165" cy="120" r="14" fill="${recheio}"/><circle cx="232" cy="168" r="14" fill="${recheio}"/>
<circle cx="218" cy="110" r="12" fill="${recheio}"/><circle cx="172" cy="182" r="12" fill="${recheio}"/>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

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
}

const CARDAPIO: { categoria: string; itens: ItemDemo[] }[] = [
  {
    categoria: 'Pizzas',
    itens: [
      { nome: 'Calabresa', descricao: 'Molho, calabresa, cebola roxa', preco: 28, imagemUrl: foto('#7A3B1D', '#B5462B'), variacoes: [TAMANHO, BORDA] },
      { nome: 'Margherita', descricao: 'Molho, muçarela, manjericão e azeite', preco: 30, imagemUrl: foto('#2F5D3A', '#C0392B'), variacoes: [TAMANHO, BORDA] },
      { nome: 'Portuguesa', descricao: 'Presunto, ovo, cebola, azeitona e muçarela', preco: 32, imagemUrl: foto('#5A3A1A', '#4A4A2A'), variacoes: [TAMANHO, BORDA] },
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
      { nome: 'Pizza de chocolate', descricao: 'Chocolate ao leite e morangos', preco: 36, imagemUrl: foto('#3B2416', '#8E2C48') },
      { nome: 'Pudim', descricao: 'Fatia do pudim de leite da casa', preco: 12 },
    ],
  },
];

const prisma = getPrismaClient(process.env.DATABASE_URL ?? '');

async function apagar(): Promise<void> {
  const empreendedor = await prisma.empreendedor.findUnique({ where: { telefone: TELEFONE_DEMO } });
  if (!empreendedor) {
    console.log('A loja de exemplo não existe.');
    return;
  }
  const pedidos = await prisma.pedido.findMany({ where: { empreendedorId: empreendedor.id }, select: { id: true } });
  const pedidoIds = pedidos.map((pedido) => pedido.id);
  await prisma.$transaction([
    prisma.pagamento.deleteMany({ where: { pedidoId: { in: pedidoIds } } }),
    prisma.itemPedido.deleteMany({ where: { pedidoId: { in: pedidoIds } } }),
    prisma.pedido.deleteMany({ where: { id: { in: pedidoIds } } }),
    prisma.variacao.deleteMany({ where: { item: { cardapio: { empreendedorId: empreendedor.id } } } }),
    prisma.itemCardapio.deleteMany({ where: { cardapio: { empreendedorId: empreendedor.id } } }),
    prisma.categoria.deleteMany({ where: { cardapio: { empreendedorId: empreendedor.id } } }),
    prisma.cardapio.deleteMany({ where: { empreendedorId: empreendedor.id } }),
    prisma.loja.deleteMany({ where: { empreendedorId: empreendedor.id } }),
    prisma.estadoConversa.deleteMany({ where: { empreendedorId: empreendedor.id } }),
    prisma.empreendedor.delete({ where: { id: empreendedor.id } }),
  ]);
  console.log(`Loja de exemplo apagada (${pedidoIds.length} pedidos de teste junto).`);
}

async function criar(): Promise<void> {
  const slugOcupado = await prisma.loja.findUnique({ where: { slug: SLUG }, include: { empreendedor: true } });
  if (slugOcupado && slugOcupado.empreendedor.telefone !== TELEFONE_DEMO) {
    throw new Error(`O link "${SLUG}" já é de outra loja (${slugOcupado.nome ?? 'sem nome'}). Nada foi alterado.`);
  }

  const empreendedor = await prisma.empreendedor.upsert({
    where: { telefone: TELEFONE_DEMO },
    update: {},
    create: { telefone: TELEFONE_DEMO, nome: 'Zé (exemplo)' },
  });

  const dadosLoja = {
    nome: 'Pizzaria do Zé',
    descricao: 'Pizzas de fermentação longa',
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
    // Sem horários = sempre aberta, para dar para testar a qualquer hora.
    // Troque por algo como [{ dia: 'ter', abre: '18:00', fecha: '23:00' }] para ver o "Fechado".
    horarios: [],
    slug: SLUG,
    capaUrl: foto('#5A2A14', '#B5462B'),
    corDestaque: '#C2410C',
  };
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

  let criados = 0;
  for (const [ordem, secao] of CARDAPIO.entries()) {
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
        },
      });
      criados++;
    }
  }

  console.log(`Pizzaria do Zé pronta (${criados} itens novos).`);
  console.log(`Abra http://localhost:3001/${SLUG} com o front rodando.`);
}

try {
  if (process.argv[2] === 'apagar') {
    await apagar();
  } else {
    await criar();
  }
} finally {
  await prisma.$disconnect();
}
