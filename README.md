# zapmenu-back

Backend do app de cardápio + pedidos via WhatsApp. Monolito modular em Node.js/TypeScript que:

- deixa donos de loja cadastrarem e atualizarem o cardápio, os dados da loja e a entrega conversando livremente por WhatsApp com uma IA (nada é gravado antes de um resumo e um "sim");
- deixa clientes finais montarem carrinho num app de cardápio e confirmarem e pagarem via WhatsApp + PIX.

**Como tudo funciona, passo a passo:** [`docs/fluxos.md`](docs/fluxos.md).

Roda como processo de longa duração (não serverless) porque usa o Baileys, que mantém uma conexão aberta com o WhatsApp para cada número (sem navegador).

## Stack

- **TypeScript** + Node.js
- **PostgreSQL + Prisma** (ORM e migrations)
- **Fastify** (API HTTP `/v1/...`, consumida pelo frontend Next.js)
- **Baileys** (conexão direta com o WhatsApp, como um aparelho conectado — não é a API oficial)
- **Mercado Pago** (geração de cobrança PIX + webhook de confirmação; Mercado Pago Assinaturas para a mensalidade do ZapMenu)
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
| [`src/orders/`](src/orders) | Carrinho → pedido com código curto (`PED-XXXX`), transições de status, expiração por prazo, aviso de pedido pago. Em camadas: `domain/`, `application/` (use cases e ports) e `infra/` |
| [`src/payments/`](src/payments) | Cobrança PIX no Mercado Pago, webhook assinado e polling de reserva, reaproveitando a mesma rotina de confirmação (idempotente). Mesmas camadas de `orders/` |
| [`src/promocoes/`](src/promocoes) | Promoções da loja (preço fixo ou %, por dia da semana e horário, com fim opcional): regras de quando valem e do preço (o menor, sem acumular), resumo, lista e o job que desliga as vencidas. Mesmas camadas de `orders/` |
| [`src/relatorios/`](src/relatorios) | Relatório de vendas pelo WhatsApp: cálculos (total, pedidos, ticket, mais vendidos, divisões, pico, variação), períodos no fuso da loja e o envio semanal/diário. Mesmas camadas de `orders/` |
| [`src/planos/`](src/planos) | Planos do ZapMenu (Básico e Profissional): catálogo único de preços, limites e recursos ([`domain/catalogo.ts`](src/planos/domain/catalogo.ts)), `podeUsar`/`limite`, teste de 14 dias, assinatura no Mercado Pago Assinaturas (conta do ZapMenu), webhook, job diário e avisos de 80%/100% dos pedidos. Mesmas camadas de `orders/` |
| [`src/whatsapp/`](src/whatsapp) | Interface `WhatsAppClient` (com fake para testes), routers das duas sessões, implementação Baileys com reconexão e modo autoteste |
| [`src/http/`](src/http) | API Fastify: `GET /v1/menu/:empreendedorId`, `POST /v1/orders`, `POST /v1/webhooks/mercado-pago` |
| [`src/orders/infra/order-expiration.job.ts`](src/orders/infra/order-expiration.job.ts), [`src/payments/infra/payment-status-poller.job.ts`](src/payments/infra/payment-status-poller.job.ts) | Jobs de fundo: expira pedidos não confirmados e consulta pagamentos pendentes |
| [`src/main.ts`](src/main.ts) | Ponto de entrada: sobe as duas sessões WhatsApp, o servidor HTTP e os jobs |
| [`test/integration/`](test/integration) | Fluxos de gestão e de compra ponta a ponta, com WhatsApp, IA e Mercado Pago mockados |
| [`scripts/smoke.ts`](scripts/smoke.ts) | Smoke tests das integrações reais (ViaCEP, Google, DeepSeek, Mercado Pago), para rodar localmente |

**Estado dos testes:** a suíte inteira passa (`npm test`), o `npm run typecheck` checa também `test/` e `scripts/`, e o `npm run lint:deps` trava a regra de dependência das camadas.

**O que ainda não foi validado de verdade:** a conexão real com o WhatsApp pelo Baileys (QR code e sessão salva) e as chamadas reais ao DeepSeek, ao ViaCEP, ao Google e ao Mercado Pago. Os adapters HTTP podem ser testados um a um com `npm run smoke -- <nome>`; o WhatsApp, subindo com `WPP_MODO_AUTOTESTE=true`.

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
- `WPP_MENU_PHONE_NUMBER` / `WPP_ORDERS_PHONE_NUMBER` — os dois números fixos do produto. Para testar com um número só, coloque o mesmo nos dois: sobe uma sessão só, e as mensagens com `PED-XXXX` vão para o fluxo de pedidos enquanto as outras vão para a gestão
- `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` e `MERCADO_PAGO_NOTIFICATION_URL` (o segredo é a "assinatura secreta" do painel de webhooks do Mercado Pago; notificações sem assinatura válida recebem `401`)
- `GESTAO_TELEFONES_PERMITIDOS` — telefones que podem usar o número de gestão. Vazia, qualquer número pode cadastrar cardápio (o boot avisa)
- `FRONTEND_ALLOWED_ORIGIN` — origem do seu app Next.js (para CORS)
- `FRONTEND_URL_PUBLICA` (opcional) — endereço público do app, usado nos links mandados no WhatsApp. Para testar no celular com o ngrok, coloque o domínio do túnel aqui e aponte o `MERCADO_PAGO_NOTIFICATION_URL` para `https://<dominio>/api/webhooks/mercado-pago` (passo a passo no README do `zapmenu-front`, "Testar no celular")

Opcionais, mas sem eles parte da gestão fica desligada:
- `DEEPSEEK_API_KEY` — sem ela, a gestão só entende as palavras-chave (`cardápio`, `cancelar`, `sim`, `não`).
- `MERCADO_PAGO_ASSINATURAS_ACCESS_TOKEN` e `MERCADO_PAGO_ASSINATURAS_WEBHOOK_SECRET` — a assinatura do ZapMenu pelas lojas, na conta do **próprio ZapMenu** (credenciais separadas das que cobram os PIX). **Use só credenciais de teste.** Sem o token, o comando *assinar* responde que está indisponível; o teste de 14 dias e os limites dos planos funcionam igual. Opcionais: `MERCADO_PAGO_ASSINATURAS_SANDBOX` (padrão `true`, manda o link do sandbox), `ASSINATURA_URL_RETORNO` (para onde a loja volta depois do cartão) e `ASSINATURAS_VERIFICACAO_INTERVALO_MINUTOS` (padrão 60).
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
| `npm run typecheck` | Checa os tipos de `src/`, `test/` e `scripts/` |
| `npm run lint:deps` | Verifica a regra de dependência das camadas (`.dependency-cruiser.cjs`) |
| `npm run smoke -- <viacep\|google\|deepseek\|mercado-pago\|todos>` | Chama as integrações reais com as chaves do `.env` |
| `npm run loja-demo [-- restaurante\|loja] [-- --telefone <número>] [-- --telefone-loja <número>]` | Cria as lojas de exemplo que a landing abre no "Ver exemplo": o restaurante Pizzaria do Zé (`/pizzaria-do-ze`) e a loja de produtos Casa Alecrim (`/casa-alecrim`, com tamanhos, cores, estoque, fotos por cor, envio pelos Correios e política de troca). Sem `restaurante` ou `loja`, cria as duas. `--telefone` (ou `LOJA_DEMO_TELEFONE`) é o dono do restaurante e `--telefone-loja` (ou `LOJA_DEMO_TELEFONE_LOJA`) o da loja: quem recebe o resumo e a enquete de aceite dos pedidos; sem eles, os donos são números fictícios que o modo autoteste bloqueia. Se o telefone já for de um empreendedor sem loja, a loja passa para ele; se ele tiver outra loja, nada muda. `-- apagar [restaurante\|loja]` remove as lojas de exemplo |
| `npm run prisma:generate` | Regenera o Prisma Client após mudar o schema |
| `npm run prisma:migrate` | Cria/aplica migrations em desenvolvimento |

## Estrutura de pastas

```
src/
├── config/       # validação de env (zod)
├── shared/       # db, logger, erros, ids, idempotência, telefone
├── menu/         # cardápio público, entrega por distância
│   ├── gestao/       # conversa de gestão com a IA (rascunho, resumo, gravação)
│   ├── endereco/     # ViaCEP + Google Geocoding
│   └── conversation/ # estado da conversa (EstadoConversa)
├── orders/       # pedidos, expiração, aviso de pedido pago
│   ├── domain/       # Pedido e regras puras (transições, código, total)
│   ├── application/  # use cases + ports/ (interfaces de I/O)
│   └── infra/        # Prisma e job de expiração
├── payments/     # cobrança PIX (mesmas camadas de orders/)
├── planos/       # planos, assinatura do ZapMenu e limites (mesmas camadas de orders/)
├── promocoes/    # promoções e descontos (mesmas camadas de orders/)
├── relatorios/   # relatório de vendas (mesmas camadas de orders/)
├── whatsapp/     # interface WhatsAppClient, routers, Baileys
├── http/         # API Fastify v1 + webhook
└── main.ts       # bootstrap
test/
├── fixtures/     # payloads de exemplo
└── integration/  # testes e2e ponta a ponta (in-process, tudo mockado)
```

Mocks de dependências externas ficam em `src/<módulo>/__mocks__/`; testes unitários ficam colocados ao lado do arquivo testado (`*.test.ts`).

**Camadas (clean architecture):** `orders/`, `payments/` e `planos/` já estão separados em `domain/` (sem dependências de fora), `application/` (use cases que falam com o mundo só por ports) e `infra/` (Prisma, Mercado Pago, jobs). `http/` e `whatsapp/` são as bordas: validam a entrada, chamam um use case e traduzem a resposta. Os outros módulos ganham camadas quando forem mexidos. O `npm run lint:deps` falha se `domain/` ou `application/` importarem infraestrutura, framework ou o `main.ts`.

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/fluxos.md`](docs/fluxos.md) | Referência do sistema: os dois fluxos, ciclo de vida do pedido e do pagamento, jobs, sessões do WhatsApp, contrato da API, idempotência e lacunas conhecidas |
| [`docs/plano-gestao-conversacional.md`](docs/plano-gestao-conversacional.md) | Decisões e detalhes da gestão por conversa: formato da IA, operações, proteções, endereço e entrega (etapa 6) |
| `../docs/frontend-plano.md` (pasta `zapmenu/docs/`) | Planejamento e design do app do cliente |

O plano de arquitetura original (decisões iniciais e modelagem do banco) não está mais disponível; o que vale hoje está descrito nos documentos acima.
