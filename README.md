# zapmenu-back

Backend do app de cardápio + pedidos via WhatsApp. Monolito modular em Node.js/TypeScript que:

- deixa donos de loja cadastrarem e atualizarem o cardápio, os dados da loja e a entrega conversando livremente por WhatsApp com uma IA (nada é gravado antes de um resumo e um "sim");
- deixa clientes finais montarem carrinho num app de cardápio e confirmarem e pagarem via WhatsApp + PIX.

**Como tudo funciona, passo a passo:** [`docs/fluxos.md`](docs/fluxos.md).

Roda como processo de longa duração (não serverless) porque usa o WPPConnect, que precisa manter uma sessão de navegador (Puppeteer/Chromium) viva para falar com o WhatsApp Web.

## Stack

- **TypeScript** + Node.js
- **PostgreSQL + Prisma** (ORM e migrations)
- **Fastify** (API HTTP `/v1/...`, consumida pelo frontend Next.js)
- **WPPConnect** (automação do WhatsApp Web — não é a API oficial)
- **Mercado Pago** (geração de cobrança PIX + webhook de confirmação)
- **DeepSeek** via SDK `openai` (interpreta a conversa de gestão)
- **ViaCEP + Google Geocoding** (endereço da loja e coordenada para a entrega por distância)
- **Vitest** (testes)

## O que já existe

| Módulo | O que faz |
|---|---|
| [`prisma/schema.prisma`](prisma/schema.prisma) | Empreendedor, Loja, Cardápio, Categoria, Item, Variação, Pedido, Pagamento, EstadoConversa, EventoProcessado (idempotência) |
| [`src/menu/gestao/`](src/menu/gestao) | Conversa de gestão: a IA propõe operações sobre um rascunho (`OCIOSO → CONVERSANDO → CONFIRMANDO`), o código valida, mostra o resumo e grava numa transação depois do "sim" |
| [`src/menu/endereco/`](src/menu/endereco), [`src/menu/entrega.ts`](src/menu/entrega.ts) | Endereço da loja (CEP + número → ViaCEP → Google → confirmação) e entrega por faixas de distância em linha reta |
| [`src/menu/`](src/menu) | Cardápio público agrupado por categoria, preço calculado no servidor com variações |
| [`src/orders/`](src/orders) | Carrinho → pedido com código curto (`PED-XXXX`), transições de status, expiração por prazo |
| [`src/payments/`](src/payments) | Cobrança PIX no Mercado Pago, webhook e polling de reserva, reaproveitando a mesma rotina de confirmação (idempotente) |
| [`src/whatsapp/`](src/whatsapp) | Interface `WhatsAppClient` (com fake para testes), routers das duas sessões, implementação WPPConnect com reconexão e modo autoteste |
| [`src/http/`](src/http) | API Fastify: `GET /v1/menu/:empreendedorId`, `POST /v1/orders`, `POST /v1/webhooks/mercado-pago` |
| [`src/orders/order-expiration.job.ts`](src/orders/order-expiration.job.ts), [`src/payments/payment-status-poller.job.ts`](src/payments/payment-status-poller.job.ts) | Jobs de fundo: expira pedidos não confirmados e consulta pagamentos pendentes |
| [`src/main.ts`](src/main.ts) | Ponto de entrada: sobe as duas sessões WhatsApp, o servidor HTTP e os jobs |
| [`test/integration/`](test/integration) | Fluxo de compra ponta a ponta, com WhatsApp e Mercado Pago mockados |

**Estado dos testes:** 2 testes de pedidos estão desatualizados e falham (`src/http/app.test.ts` e `test/integration/fluxo2-compra-cliente.e2e.test.ts`): eles mandam um item que não existe no cardápio fake, e o pedido agora exige que o item exista. O resto da suíte passa.

**O que ainda não foi validado de verdade:** a conexão real com o WPPConnect (QR code, sessão de navegador) e as chamadas reais ao DeepSeek, ao ViaCEP e ao Google. Isso precisa ser testado localmente.

Problemas e ausências conhecidos estão em [`docs/fluxos.md` → Lacunas conhecidas](docs/fluxos.md#11-lacunas-conhecidas).

## Como inicializar

### 1. Pré-requisitos
- Node.js 20+ (testado com Node 24)
- PostgreSQL rodando localmente (ou acessível via `DATABASE_URL`)
- Conta no Mercado Pago com um *access token* de teste ou produção

### 2. Instalar dependências
```bash
npm install
```

### 3. Configurar variáveis de ambiente
```bash
cp .env.example .env
```
Edite o `.env` e preencha pelo menos:
- `DATABASE_URL` — string de conexão do Postgres
- `WPP_MENU_PHONE_NUMBER` / `WPP_ORDERS_PHONE_NUMBER` — os dois números fixos do produto
- `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` e `MERCADO_PAGO_NOTIFICATION_URL` (o segredo é obrigatório, mas a assinatura do webhook ainda não é verificada)
- `FRONTEND_ALLOWED_ORIGIN` — origem do seu app Next.js (para CORS)

Opcionais, mas sem eles parte da gestão fica desligada:
- `DEEPSEEK_API_KEY` — sem ela, a gestão só entende as palavras-chave (`cardápio`, `cancelar`, `sim`, `não`).
- `GOOGLE_MAPS_API_KEY` — Google Geocoding, para o cadastro do endereço da loja e a entrega por distância. Restrinja a chave à Geocoding API. Sem ela, o bot avisa que o cadastro de endereço está indisponível.

Para testar com um único celular, use `WPP_MODO_AUTOTESTE=true` (veja os comentários no `.env.example` e a seção 7 de [`docs/fluxos.md`](docs/fluxos.md#7-sessões-do-whatsapp)).

O boot da aplicação valida o `.env` com zod e falha cedo se faltar algo.

### 4. Rodar as migrations
```bash
npx prisma migrate dev
```

### 5. Subir em desenvolvimento
```bash
npm run dev
```
Na primeira execução, dois QR codes serão impressos no terminal (um por sessão WhatsApp) — escaneie cada um com o celular do número correspondente. As sessões ficam salvas em `WPP_MENU_TOKEN_STORE_PATH` / `WPP_ORDERS_TOKEN_STORE_PATH` para não pedir QR code de novo a cada reinício.

### 6. Rodar os testes
```bash
npm test              # roda tudo uma vez
npm run test:watch    # modo watch
npm run test:coverage # com relatório de cobertura
npm run typecheck     # só o TypeScript, sem rodar testes
```

## Scripts disponíveis

| Script | O que faz |
|---|---|
| `npm run dev` | Sobe o backend com hot-reload (`tsx watch`) |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Roda a build compilada (`dist/main.js`) |
| `npm test` | Roda a suíte de testes uma vez |
| `npm run prisma:generate` | Regenera o Prisma Client após mudar o schema |
| `npm run prisma:migrate` | Cria/aplica migrations em desenvolvimento |

## Estrutura de pastas

```
src/
├── config/       # validação de env (zod)
├── shared/       # db, logger, erros, ids, idempotência
├── menu/         # cardápio público, entrega por distância
│   ├── gestao/       # conversa de gestão com a IA (rascunho, resumo, gravação)
│   ├── endereco/     # ViaCEP + Google Geocoding
│   └── conversation/ # estado da conversa (EstadoConversa)
├── orders/       # pedidos, expiração
├── payments/     # Mercado Pago
├── whatsapp/     # interface WhatsAppClient, routers, WPPConnect
├── http/         # API Fastify v1 + webhook
└── main.ts       # bootstrap
test/
├── fixtures/     # payloads de exemplo
└── integration/  # testes e2e ponta a ponta (in-process, tudo mockado)
```

Mocks de dependências externas ficam em `src/<módulo>/__mocks__/`; testes unitários ficam colocados ao lado do arquivo testado (`*.test.ts`).

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/fluxos.md`](docs/fluxos.md) | Referência do sistema: os dois fluxos, ciclo de vida do pedido e do pagamento, jobs, sessões do WhatsApp, contrato da API, idempotência e lacunas conhecidas |
| [`docs/plano-gestao-conversacional.md`](docs/plano-gestao-conversacional.md) | Decisões e detalhes da gestão por conversa: formato da IA, operações, proteções, endereço e entrega (etapa 6) |
| `../docs/frontend-plano.md` (pasta `zapmenu/docs/`) | Planejamento e design do app do cliente |

O plano de arquitetura original (decisões iniciais e modelagem do banco) não está mais disponível; o que vale hoje está descrito nos documentos acima.
