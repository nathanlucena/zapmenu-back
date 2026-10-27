# Como testar as Sprints 16 a 19

Roteiro para testar à mão, pelo WhatsApp, os planos, as promoções, os relatórios, o áudio, as descrições com IA, a capa/logo e o envio do varejo. Tudo na branch `expansao-varejo`, no banco local.

## 1. Subir o back e o front

```bash
# zapmenu-back
npm install
npx prisma migrate status   # tem que dizer "Database schema is up to date"
npx prisma generate
npm run dev                 # porta 3000 (PORT no .env)

# zapmenu-front (outro terminal)
npm install
npm run dev                 # porta 3001
```

- Só um `npm run dev` de cada por vez: um segundo back dá `EADDRINUSE` na porta 3000, e um segundo `next dev` na mesma pasta se recusa a subir.
- No boot, o back avisa em `WARN` cada integração sem credencial (veja a seção 2). Esses avisos são esperados.
- Com `WPP_MODO_AUTOTESTE=true`, o bot só responde ao chat consigo mesmo e aos `WPP_NUMEROS_PERMITIDOS`. Se gestão e pedidos usam o mesmo número, mensagens com `PED-XXXX` vão para pedidos e o resto vai para a gestão.
- Para links que precisam ser públicos (retorno do Mercado Pago e do Melhor Envio, webhooks), use `npm run tunel` no front (ngrok) e ponha o domínio em `FRONTEND_URL_PUBLICA`.

## 2. Variáveis do `.env` por recurso

Use só credenciais de **teste/sandbox**. Nada aqui pode cobrar de verdade.

| Recurso | Variáveis | Sem elas |
|---|---|---|
| IA da gestão (tudo que é conversa livre, promoções, descrições, guia de medidas) | `DEEPSEEK_API_KEY` (já preenchida) | Só os comandos fixos funcionam |
| Assinatura (Mercado Pago Assinaturas) | `MERCADO_PAGO_ASSINATURAS_ACCESS_TOKEN` (token de **usuário de teste**), `MERCADO_PAGO_ASSINATURAS_WEBHOOK_SECRET`, `MERCADO_PAGO_ASSINATURAS_SANDBOX=true`; opcional `ASSINATURA_URL_RETORNO` | *assinar* responde que está indisponível. O teste de 14 dias, os limites, o selo e os bloqueios por plano funcionam do mesmo jeito |
| Transcrição de áudio | `TRANSCRICAO_API_KEY` (+ `TRANSCRICAO_API_URL` e `TRANSCRICAO_MODELO`: OpenAI `whisper-1` ou Groq `https://api.groq.com/openai/v1` + `whisper-large-v3`) | O bot pede para escrever em vez de ouvir |
| Melhor Envio | `MELHOR_ENVIO_CLIENT_ID`, `MELHOR_ENVIO_CLIENT_SECRET` do app criado em https://sandbox.melhorenvio.com.br, `MELHOR_ENVIO_SANDBOX=true`; opcional `MELHOR_ENVIO_URL_RETORNO` (vazio: `FRONTEND_URL_PUBLICA/api/melhor-envio/retorno`, que tem que estar cadastrada no app) | A opção transportadora fica desligada; o envio próprio e a retirada funcionam |
| Endereço e entrega por distância | `GOOGLE_MAPS_API_KEY` | O bot avisa que a confirmação de endereço está indisponível |

Funcionam sem nenhuma chave extra: planos e limites, selo, taxa fixa, mensagens seguidas, capa e logo, relatórios (precisa de pedidos pagos no período) e os comandos de promoção. Criar promoção, descrições e guia de medidas precisam do DeepSeek.

## 3. Trocar o plano de uma loja

Loja nova começa em `TESTE` por 14 dias, com tudo do Profissional. Para testar os dois planos sem o Mercado Pago, mude a assinatura direto no banco (troque o telefone):

```bash
psql "$DATABASE_URL"
```

```sql
-- Básico
UPDATE "Assinatura" SET plano = 'ESSENCIAL', status = 'ATIVA', "proximaCobranca" = now() + interval '1 year'
WHERE "empreendedorId" = (SELECT id FROM "Empreendedor" WHERE telefone = '5519999999999');

-- Profissional
UPDATE "Assinatura" SET plano = 'PROFISSIONAL', status = 'ATIVA', "proximaCobranca" = now() + interval '1 year'
WHERE "empreendedorId" = (SELECT id FROM "Empreendedor" WHERE telefone = '5519999999999');

-- De volta ao teste (14 dias)
UPDATE "Assinatura" SET plano = 'PROFISSIONAL', status = 'TESTE', "fimTeste" = now() + interval '14 days'
WHERE "empreendedorId" = (SELECT id FROM "Empreendedor" WHERE telefone = '5519999999999');

-- Ver como está
SELECT e.telefone, a.plano, a.status, a."fimTeste", a."proximaCobranca"
FROM "Assinatura" a JOIN "Empreendedor" e ON e.id = a."empreendedorId";
```

- A assinatura trocada assim não tem `mpPreapprovalId`. Por isso *mudar de plano* e *cancelar assinatura* pelo WhatsApp vão recusar. Para testar esses dois, assine pelo fluxo do Mercado Pago (sandbox).
- `status = 'SUSPENSA'` testa a vitrine fora do ar. Nesse estado, a gestão só aceita os comandos de plano.

## 4. Roteiro no WhatsApp

Mande as frases no chat da gestão (o número conectado no modo autoteste). Os itens marcados **(Pro)** só funcionam no Profissional ou no teste. No Básico, a resposta esperada é o 🔒 com o convite para o Profissional.

### Planos e limites (Sprint 16)
- *meu plano*: mostra o plano, a situação, os pedidos do mês e os produtos.
- No Básico, cadastre o 31º produto: o bot recusa e explica o upgrade.
- No Básico, peça algo do Pro, por exemplo *quero a cor da loja azul* ou *mostra como fica*: recebe o 🔒.
- Limite de pedidos: perto de 80 e de 100 pedidos pagos no mês, a gestão manda um aviso, uma vez cada. Para testar sem fazer 80 pedidos, ajuste o plano no catálogo ou crie pedidos no banco.

### Assinatura (precisa do token de teste)
- *assinar profissional* ou *assinar básico anual*: o bot pede o e-mail da conta do Mercado Pago e manda o link do sandbox. Pague com o cartão de teste.
- *mudar para o básico* (o downgrade vale na próxima cobrança), *mudar de plano para profissional*, *cancelar assinatura* (o bot pede confirmação) e *regularizar*.

### Selo
- No Básico, a vitrine mostra o rodapé "Feito com ZapMenu". No Profissional e no teste, o rodapé não aparece.

### Taxa fixa (Sprint 16)
- *entrego com taxa de 7 reais*, ou *taxa fixa de 8 reais até 5 km*.
- No Básico, a loja que usava faixas por distância passa para a taxa fixa e recebe um aviso no começo da conversa.
- (Pro) *até 3 km 5 reais, até 6 km 9 reais*: vira entrega por distância.

### Promoções e desconto (Pro, Sprint 17)
- *toda quarta e quinta a calabresa sai por 39,90*: mostra o resumo, os exemplos e a prévia riscada; responda *sim*.
- *10% em todas as pizzas até domingo* (desconto percentual por categoria).
- *15% na loja toda das 18h às 20h*.
- Acima de 50%, o bot pede o *sim* duas vezes.
- *minhas promoções*, *pausar promoção 1*, *reativar promoção 1*, *remover promoção 2*.
- Na vitrine, o preço aparece riscado, com o rótulo "Promoção de quarta" ou "-10%".

### Relatório (Pro, Sprint 17)
- *relatório* (últimos 7 dias), *relatório do mês*, *vendas de hoje*, *vendas de ontem*.
- *parar relatório diário* e depois *voltar relatório diário*.
- Só contam pedidos pagos ou confirmados. Sem vendas no período, a resposta é curta.

### Mensagens seguidas (todos os planos, Sprint 18)
- Mande em sequência, rápido: *adiciona coxinha*, *8 reais*, *na categoria salgados*. Aparece o "digitando..." e o bot responde uma vez só, depois de uns 3 s de silêncio (no máximo 10 s).
- Um *sim* ou *cancelar* sozinho responde na hora.

### Áudio (Pro, precisa da chave de transcrição, Sprint 18)
- Grave *adiciona pastel de queijo por 9 reais*: a resposta começa com "🎤 Entendi: …".
- Áudio com mais de 2 min: o bot responde "Não consegui ouvir o áudio, pode escrever?".
- Um áudio do cliente no número de pedidos também é transcrito.

### Descrições com IA (Pro, Sprint 18)
- Salve um item sem descrição: o bot oferece escrever uma.
- *melhora a descrição da coxinha*, ou *melhora as descrições da categoria salgados*.
- Responda *1*, *2*, sua própria descrição, ou *pular*.

### Capa e logo (Sprint 18)
- Foto com a legenda *essa é a capa* (Pro) ou *esse é o logo* (todos os planos): mostra o resumo com a prévia do topo; responda *sim*.
- Foto sem legenda: vem uma enquete perguntando se é item, capa ou logo.
- *tirar a capa*, *tirar o logo*.

### Envio próprio (tipo Loja, Sprint 19)
- Se a loja for restaurante, mande *mudar tipo da loja* e escolha Loja.
- *faço envio próprio com taxa de 12 reais até 10 km*, e *também tem retirada*.
- No app, o cliente informa o CEP. Fora do raio e sem Melhor Envio, aparece "A loja não entrega no seu endereço" (com a retirada, se houver).

### Melhor Envio (Pro, tipo Loja, sandbox, Sprint 19)
- *conectar melhor envio*: abra o link, autorize com a conta do sandbox, e o retorno grava a conta.
- *também envio pelos correios / transportadora*: liga a opção.
- No checkout, com um CEP de outra cidade, aparecem PAC, SEDEX e transportadoras, com preço e prazo. O pagamento é só PIX.
- Com o pedido pago, mande *gerar etiqueta do PED-XXXX*. A etiqueta é comprada com o saldo **do sandbox** e o PDF chega pela gestão. O pedido vai para `ENVIADO` e o cliente recebe o rastreio.

### Guia de medidas (Pro, tipo Loja, Sprint 19)
- *guia de medidas das camisetas: P 50x70, M 53x72, G 56x74*: o bot mostra a tabela; responda *sim*.
- Pode ser de uma categoria ou de um produto. O do produto vale primeiro.
- A vitrine mostra a tabela no produto.

## 5. Decisões que ficam assim por enquanto

- **Etiqueta sem CPF/CNPJ:** a etiqueta do Melhor Envio é gerada sem o documento do remetente e do destinatário. Antes de ir para produção, é preciso pedir esses dados.
- **Medidas padrão:** produto sem peso e medidas (e sem padrão na categoria) é cotado com **300 g e 4 × 20 × 30 cm**.
