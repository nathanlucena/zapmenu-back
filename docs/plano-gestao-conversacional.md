# Plano v2 — Gestão do cardápio por conversa

> Status: **etapas 1–4 implementadas** (2026-10-14). Etapa 5 (testes automatizados) pendente.
> Etapa 6 (endereço e entrega por distância) **implementada** em 2026-10-16. Ver [Etapa 6](#etapa-6--endereço-e-entrega-por-distância).

## Ideia central

O empreendedor conversa livremente com o número de gestão no WhatsApp. Cada mensagem é interpretada por uma IA (DeepSeek), que vai montando um **rascunho de alterações** do cardápio — nada é gravado durante a conversa. Quando a IA percebe que a pessoa terminou ("é isso", "pronto", "só isso por hoje"), o **código** mostra um resumo de tudo que será salvo e pergunta **sim/não**. Só o "sim" grava.

```
👤 oi, quero atualizar o cardápio
🤖 Oi! Me conta o que você quer mudar 😊
👤 entrou pizza calabresa 39,90 e pizza frango com catupiry 42
🤖 Anotei as duas! Tem foto de alguma delas?
👤 [foto]  essa é a de frango
🤖 Foto anexada na Pizza Frango com Catupiry 👍
👤 ah e a coca agora é 15, e tira o suco de laranja que acabou
🤖 Beleza! Mais alguma coisa?
👤 a calabresa na verdade é 41
🤖 Corrigido. Algo mais?
👤 não, é isso
🤖 📋 *Vou salvar estas alterações:*
   ➕ Pizza Calabresa — R$ 41,00 (sem foto)
   ➕ Pizza Frango com Catupiry — R$ 42,00 📷
   ✏️ Coca 2L: R$ 14,00 → R$ 15,00
   ⏸️ Suco de Laranja — pausar
   Confirma? (*sim*/*não*)
👤 sim
🤖 ✅ Pronto! 4 alterações salvas no cardápio.
```

## Decisões tomadas

| Tema | Decisão |
|---|---|
| IA | DeepSeek (`deepseek-flash`, modo JSON), via SDK `openai` |
| Modelo da conversa | Rascunho de alterações acumulado; nada é gravado até a confirmação |
| Fim da conversa | A IA percebe que terminou → o **código** mostra o resumo → sim/não |
| "não" no resumo | Volta a conversar (rascunho mantido); `cancelar` descarta tudo |
| Rascunho abandonado | Ao voltar, o bot relembra o que está pendente; expira após 24h |
| Respostas do bot | Durante a conversa: escritas pela IA. Resumo, sucesso e erros: escritos pelo código |
| Categorias | Opcionais; item sem categoria fica em "Outros"; remover categoria move os itens para "Outros" |
| Dados da loja | Nome e descrição, horários de funcionamento, endereço/retirada, entrega (taxa e pedido mínimo) |

## Divisão de responsabilidades

| Quem | Faz |
|---|---|
| **IA (DeepSeek)** | Conversa de forma natural, transforma cada mensagem em **operações** sobre o rascunho e percebe quando a pessoa terminou |
| **Código** | Aplica e valida as operações, monta o **resumo final**, pede sim/não e grava tudo numa **transação** |

## Fluxo

```
OCIOSO ──mensagem──▶ CONVERSANDO ──IA percebe "terminei" + rascunho válido──▶ CONFIRMANDO
                         ▲                                                     │
                         └──────────── "não" / nova alteração ◀────────────────┤
OCIOSO ◀──── "sim" (grava tudo numa transação) ◀────────────────────────────────┘
"cancelar" em qualquer etapa → descarta o rascunho → OCIOSO
```

### A cada mensagem

1. **Palavras-chave (sem IA):** `cancelar` descarta o rascunho; `cardápio` mostra a lista atual; `sim` no resumo grava.
2. **Retomada:** se o rascunho está parado há mais de 30 min, o bot primeiro relembra ("você tinha 3 alterações pendentes: …, quer continuar?"). Depois de 24h, descarta e avisa.
3. **Chamada à IA** com: últimas ~20 mensagens da conversa, rascunho atual, cardápio (itens com ids, categorias, variações), dados da loja, a mensagem e se veio foto.
4. **A IA devolve** `{ resposta, operacoes[], finalizou, decisao }`.
5. **O código aplica cada operação validando.** Operação inválida (id inexistente, preço negativo, horário malformado) é descartada e o bot avisa "⚠️ não consegui aplicar: …".
6. **Se `finalizou`:**
   - falta algo (ex.: item novo sem preço) → o bot pergunta o que falta;
   - rascunho vazio → "nada para salvar";
   - tudo ok → o **código** monta o resumo e vai para `CONFIRMANDO`.
7. **Em `CONFIRMANDO`**, a IA classifica a resposta: confirmou / recusou / trouxe nova alteração (que volta para `CONVERSANDO`).

### Formato da resposta da IA

```json
{
  "resposta": "Anotei as duas! Tem foto de alguma delas?",
  "operacoes": [
    { "tipo": "novo_item", "ref": "n1", "nome": "Pizza Calabresa", "preco": 39.9 },
    { "tipo": "novo_item", "ref": "n2", "nome": "Pizza Frango com Catupiry", "preco": 42 }
  ],
  "finalizou": false,
  "decisao": null
}
```

### Operações

| Grupo | Operações |
|---|---|
| Itens novos (no rascunho) | `novo_item`, `corrigir_novo_item`, `descartar_novo_item` |
| Itens existentes | `editar_item`, `pausar_item`, `reativar_item`, `remover_item` |
| Fotos | `anexar_foto` (a IA indica de qual item; se não der para saber, o bot pergunta) |
| Variações | `definir_variacoes` (substitui as variações do item, ex.: Tamanho P +0 / M +8 / G +15) |
| Categorias | `nova_categoria`, `renomear_categoria`, `remover_categoria`; item referencia categoria pelo nome |
| Loja | `atualizar_loja` (nome, descrição, endereço, retirada, entrega, horários) |

### Resumo antes de salvar (gerado pelo código)

```
📋 *Vou salvar estas alterações:*
🏪 Loja: horário seg–sex 18:00–23:00
🗂️ Nova categoria: Bebidas
➕ Pizza Frango com Catupiry — R$ 42,00 (Pizzas) 📷
   Tamanho: P, M (+R$ 8,00), G (+R$ 15,00)
✏️ Coca 2L: R$ 14,00 → R$ 15,00 · categoria → Bebidas
⏸️ Suco de Laranja — pausar
Confirma? (*sim*/*não*)
```

## Proteções

1. **A IA nunca grava** — só mexe no rascunho (guardado em `EstadoConversa`).
2. **O resumo é montado pelo código a partir do rascunho**: o que a pessoa confirma é exatamente o que será salvo, mesmo que a IA tenha "falado" algo diferente.
3. **Validação antes do resumo**: dados incompletos impedem o resumo; o bot pergunta o que falta.
4. **Ids validados**: a IA só pode referenciar itens/categorias do cardápio daquela pessoa.
5. **A IA não pode dizer "salvei"**: proibido no prompt; mensagens de sucesso/erro são sempre do código.
6. **Memória curta**: só as últimas ~20 mensagens vão para a IA (custo e latência sob controle).
7. **IA fora do ar**: o rascunho é preservado e o bot pede para repetir.

## Mudanças no banco

```
EstadoConversaEnum: OCIOSO | CONVERSANDO | CONFIRMANDO          (etapa 1)
Categoria   { id, cardapioId, nome, ordem }                      (etapa 3)
ItemCardapio.categoriaId?  — opcional                            (etapa 3)
Dados da loja                                                    (etapa 4)
  nomeLoja, descricao, endereco, aceitaRetirada,
  fazEntrega, taxaEntrega, pedidoMinimo,
  horarios Json  — [{ "dia": "seg", "abre": "18:00", "fecha": "23:00" }]
```

## Etapas

| # | Entrega | Mudanças |
|---|---|---|
| **1** | **Núcleo conversacional com itens**: rascunho, operações, resumo, sim/não, retomada/expiração, gravação em transação | reescrita do `gestao.service`, novo prompt/formato da IA, novos estados (migration) |
| 2 | Variações | usa a tabela `Variacao` existente; `POST /v1/orders` passa a calcular o preço no servidor |
| 3 | Categorias | migration + `GET /v1/menu` agrupado por categoria |
| 4 | Dados da loja | migration + endpoint para o frontend |
| 5 | Testes automatizados | quando solicitado |
| 6 | Endereço e entrega por distância | migration (endereço estruturado, coordenada, `faixasEntrega`), ViaCEP + Google Geocoding com confirmação, operações `definir_endereco` e `faixas_entrega`, cálculo por raio |

Cada etapa termina testável pelo WhatsApp. A etapa 1 sozinha já entrega a experiência descrita acima.

### Reaproveitado da versão atual

Repositórios do cardápio (listar/editar/pausar/remover), cliente DeepSeek (com prompt e formato novos), logs e o modo autoteste.

## Riscos e pontos de atenção

- **Frontend**: as etapas 3 e 4 mudam o formato do `GET /v1/menu`; o app Next.js precisa acompanhar.
- **Preço nos pedidos**: hoje `POST /v1/orders` confia no `precoUnitario` enviado pelo cliente. Com variações isso piora — corrigir junto da etapa 2.
- **Fotos em base64 no banco**: funciona para teste, mas no futuro precisa de um storage de arquivos.
- **Custo/latência**: uma chamada ao DeepSeek por mensagem, com histórico limitado.

## Pontos que estavam em aberto (resolvidos com a recomendação)

1. Dados da loja: tabela `Loja` separada (1:1 com `Empreendedor` por enquanto).
2. Horários especiais: ficam para depois.
3. Ordem dos itens: ordem de criação (categorias pela ordem em que foram criadas; "Outros" por último).
4. Histórico enviado à IA: últimas 20 mensagens da sessão atual.
5. Gestão e pedidos continuam em dois números separados.

## Onde está no código

| Parte | Arquivo |
|---|---|
| Orquestração da conversa | `src/menu/gestao/gestao.service.ts` |
| Rascunho: aplicar operações, validar, resumo | `src/menu/gestao/rascunho.ts` |
| Contrato da IA | `src/menu/gestao/interpretador.ts` |
| DeepSeek (prompt + validação da saída) | `src/menu/gestao/deepseek-interpretador.ts` |
| Leitura do cardápio e gravação em transação | `src/menu/gestao/gestao.repository.prisma.ts` |
| Palavras-chave (`cancelar`, `cardápio`, `sim`, `não`) | `src/menu/gestao/comandos.ts` |
| Cardápio público (`GET /v1/menu`) | `src/menu/menu.repository.prisma.ts` → `obterCardapioPublico` |
| Preço calculado no servidor (`POST /v1/orders`) | `src/menu/menu.service.ts` → `calcularPrecoUnitario` |

---

## Etapa 6 — Endereço e entrega por distância

> Status: **implementada** (2026-10-16). Migration `entrega_por_distancia`. Precisa de `GOOGLE_MAPS_API_KEY` no `.env` para o cadastro de endereço funcionar.
>
> Diferenças em relação ao plano: além de `sim`/`não`, a IA pode confirmar ou recusar o endereço com outras palavras (operações `confirmar_endereco` / `recusar_endereco`). Configurar faixas liga `fazEntrega` automaticamente, a menos que a pessoa tenha dito que não entrega. O aviso para lojas antigas aparece quando uma conversa começa. Os testes do `deepseek-interpretador` (schema zod) ficaram de fora.

### Objetivo

Cada loja tem um endereço verificado (com coordenada) e uma tabela de faixas de entrega por distância, tudo configurado digitando na conversa do WhatsApp. Exemplo: até 1 km grátis, até 3 km R$ 5,00, acima de 3 km não entrega. Isso substitui a taxa de entrega fixa (`taxaEntrega`).

### Decisões

| Tema | Decisão |
|---|---|
| Como o dono informa | **Digitando**. O bot pede **CEP + número** (e complemento, se houver). Se a pessoa digitar diferente (endereço por extenso, CEP com erro, só rua e bairro), a IA interpreta o que veio. **Não usa o pin de localização do WhatsApp.** |
| CEP → rua, bairro, cidade | **ViaCEP** (grátis, sem chave) |
| Endereço → coordenada | **Google Geocoding API** (chave `GOOGLE_MAPS_API_KEY`) |
| Confirmação | **Sempre.** Assim que o endereço é encontrado, o bot mostra o endereço completo e o link do mapa e pergunta "é aqui?". Só depois do "sim" o endereço entra no rascunho. Ele aparece de novo no resumo final. |
| Distância | **Linha reta** (Haversine). Sem API de rota. |
| Modelo de preço | **Faixas livres**: "até X km → R$ Y". O maior raio é o limite de entrega. |
| Limites | Até **6 faixas** e raio máximo de **30 km** (valores de partida). |
| Pedido mínimo por faixa | **Fora** do escopo. |
| Lojas com `taxaEntrega` antiga | Entrega **indisponível** até o dono configurar endereço e faixas. |
| Quem define a coordenada | **Só o código**, a partir da resposta do Google. A IA nunca escreve latitude, longitude nem "endereço encontrado". |

### Conversa de exemplo

```
👤 quero começar a fazer entrega
🤖 Boa! Primeiro preciso do endereço da loja para calcular as distâncias.
   Me manda o CEP e o número (e o complemento, se tiver).
👤 50050-000, 123
🤖 Encontrei este endereço:
   📍 *Rua da Aurora, 123 – Boa Vista, Recife – PE, 50050-000*
   https://maps.google.com/?q=-8.059100,-34.879800
   É aqui? (*sim*/*não*)
👤 sim
🤖 Endereço anotado! Agora me diz como você cobra a entrega.
   Exemplo: até 1 km grátis, até 3 km R$ 5…
👤 até 1km de graça, até 3km 5 reais, mais longe que isso não entrego
🤖 Anotado! Mais alguma coisa?
👤 é isso
🤖 📋 *Vou salvar estas alterações:*
   📍 Endereço: *Rua da Aurora, 123 – Boa Vista, Recife – PE, 50050-000*
   🛵 Faz entrega: *sim*
   🛵 Entrega: *até 1 km grátis · até 3 km R$ 5,00 · acima de 3 km não entrega*
   Confirma? (*sim*/*não*)
👤 sim
🤖 ✅ Pronto! 3 alterações salvas.
```

#### Quando a pessoa digita errado ou diferente

| A pessoa manda | O que acontece |
|---|---|
| `rua da aurora 123 boa vista recife` | A IA separa rua, número, bairro e cidade. Sem CEP, o código vai direto ao Google com o texto montado. Confirma do mesmo jeito. |
| `5005000, 123` (CEP com 7 dígitos) | CEP inválido → o bot avisa *"O CEP 5005000 tem 7 dígitos. Confere pra mim?"* sem chamar nenhuma API. |
| CEP que não existe no ViaCEP | *"Não achei o CEP 50050-999. Confere o número ou me manda o endereço por extenso."* |
| `50050-000` sem número | O bot pergunta o número antes de buscar. "sem número" / "s/n" é aceito, com aviso de precisão menor. |
| Google acha só a rua ou o bairro (`location_type` = `GEOMETRIC_CENTER` ou `APPROXIMATE`, ou `partial_match`) | A confirmação vem com aviso: *"⚠️ Achei a rua, mas não o número exato. O ponto pode estar até algumas quadras de distância."* A pessoa pode aceitar ou corrigir. |
| CEP devolvido pelo Google diferente do digitado | Aviso na confirmação: *"⚠️ O mapa indica o CEP 50050-010, diferente do que você mandou."* |
| `não` na confirmação | *"Me manda de novo, ou só o que estiver errado (ex.: 'o número é 132')."* A IA aplica a correção sobre o endereço pendente e o código busca de novo. |
| Google fora do ar ou sem chave configurada | *"Não consegui verificar o endereço agora. Tente de novo em alguns minutos."* O resto do rascunho continua; o endereço não é salvo sem verificação. |

### Fluxo do endereço

```
IA: operação definir_endereco { cep?, numero?, complemento?, rua?, bairro?, cidade?, uf? }
        │
        ▼
código: normaliza CEP (só dígitos, precisa de 8)
        ├─ CEP inválido ──────────────▶ pergunta de novo (sem API)
        ├─ falta número ──────────────▶ pergunta o número
        ▼
ViaCEP (se tem CEP) ──▶ rua, bairro, cidade, UF
        ├─ CEP não encontrado ────────▶ pede conferir ou endereço por extenso
        ▼
Google Geocoding (address montado + components=country:BR, region=br)
        ├─ sem resultado ─────────────▶ pede para corrigir
        ▼
contexto.enderecoPendente = { campos, enderecoFormatado, latitude, longitude, precisao }
        ▼
bot: "Encontrei este endereço: … É aqui? (sim/não)"
        ├─ sim ──▶ rascunho.loja.endereco = enderecoPendente; limpa pendente
        └─ não ──▶ mantém pendente; aceita correção parcial e busca de novo
```

- **"sim"/"não" do endereço** é tratado pelo código enquanto existe `enderecoPendente`, antes de chamar a IA, igual à palavra-chave `sim` do resumo. Qualquer outra mensagem vai para a IA, que recebe `endereco_pendente` no contexto e pode emitir uma nova `definir_endereco` (correção).
- `enderecoPendente` não conta como alteração. Se a pessoa disser "é isso" com endereço pendente, o bot pergunta primeiro se o endereço está certo.
- `cancelar` descarta também o endereço pendente.
- O Google só é chamado quando o endereço muda: nenhuma consulta por pedido nem por mensagem comum. Custo perto de zero.

### Mudanças no banco

```
Loja
  cep                 String?
  logradouro          String?
  numero              String?        — texto: aceita "s/n", "123A"
  complemento         String?
  bairro              String?
  cidade              String?
  uf                  String?        @db.Char(2)
  latitude            Decimal(9,6)?  — vem só do Google
  longitude           Decimal(9,6)?
  precisaoEndereco    String?        — location_type do Google (ROOFTOP, RANGE_INTERPOLATED, …)
  faixasEntrega       Json  @default("[]")
                      — [{ "ateKm": 1, "taxa": 0 }, { "ateKm": 3, "taxa": 5 }], ordenada por ateKm
  endereco            — passa a ser o endereço formatado para exibir (gerado pelo código)
  taxaEntrega         — DEPRECIADA
```

`DadosLoja` (rascunho) ganha `enderecoVerificado?: EnderecoVerificado` (campos + coordenada + precisão) e `faixasEntrega?: FaixaEntrega[]`. `Contexto` ganha `enderecoPendente?: EnderecoVerificado`.

**Lojas antigas.**
- Com `fazEntrega = true` e sem faixas ou sem coordenada: a entrega fica **indisponível** para pedidos novos. Na próxima conversa o bot avisa: *"Agora a entrega é calculada pela distância. Para voltar a entregar, me manda o CEP e o número da loja e como você cobra em cada faixa."*
- Com `endereco` em texto livre e sem coordenada: o texto continua aparecendo no cardápio até o dono cadastrar o endereço novo.
- `taxaEntrega` sai do prompt e do resumo nesta etapa. A coluna é removida numa etapa futura.

### Operações da IA

```json
{ "tipo": "definir_endereco", "cep": "50050000", "numero": "123", "complemento": "loja 2" }
{ "tipo": "definir_endereco", "rua": "Rua da Aurora", "numero": "123", "bairro": "Boa Vista", "cidade": "Recife" }
{ "tipo": "atualizar_loja", "faz_entrega": true,
  "faixas_entrega": [ { "ate_km": 1, "taxa": 0 }, { "ate_km": 3, "taxa": 5 } ] }
```

Regras no prompt:
- `definir_endereco` traz **só o que a pessoa disse**. Nunca completar rua, bairro ou cidade "de cabeça" a partir do CEP; quem completa é o código.
- Correção parcial ("o número é 132") → `definir_endereco` só com o campo que mudou; o código mescla com o endereço pendente.
- `endereco` sai de `atualizar_loja`; endereço só por `definir_endereco`.
- Proibido dizer "encontrei", "achei no mapa" ou "endereço salvo". Essas mensagens são do código.
- `faixas_entrega` é a lista **completa** (substitui a anterior), como `horarios`. "grátis/de graça/sem taxa" → `taxa: 0`. "500 metros" → `ate_km: 0.5`.
- "acima de 3 km cobro R$ 10" sem dizer até onde: **perguntar** "até quantos km você entrega?", sem inventar limite.
- "não entrego mais" → `faz_entrega: false` (endereço e faixas ficam salvos).

### Validação (código)

| Regra | Se falhar |
|---|---|
| CEP com 8 dígitos depois de tirar pontos, traços e espaços | Pergunta de novo, sem chamar API |
| `0 < ateKm ≤ 30` | ⚠️ "Não consegui aplicar: raio de 45 km é maior que o limite de 30 km." |
| `taxa ≥ 0` | ⚠️ descarta a faixa |
| `ateKm` sem repetição; lista ordenada pelo código | repetição → ⚠️; a ordem é corrigida sem aviso |
| No máximo 6 faixas | ⚠️ |
| Taxa diminui com a distância | Só aviso no resumo; não bloqueia |

**Pendências que impedem o resumo** (rascunho + loja já salva):
- `enderecoPendente` existe → *"confirmar se o endereço está certo"*
- `fazEntrega` efetivo = sim e sem endereço verificado → *"o CEP e o número da loja"*
- `fazEntrega` efetivo = sim e sem faixas → *"até onde você entrega e quanto cobra"*

### Resumo antes de salvar

```
📍 Endereço: *Rua da Aurora, 123 – Boa Vista, Recife – PE, 50050-000*
🛵 Entrega: *até 1 km grátis · até 3 km R$ 5,00 · acima de 3 km não entrega*
```

Com valores já salvos, mostra antes → depois (`até 3 km R$ 5,00 → R$ 6,00`), seguindo o padrão das edições de preço.

### Integrações externas

| Serviço | Uso | Configuração | Falha |
|---|---|---|---|
| ViaCEP `https://viacep.com.br/ws/{cep}/json/` | CEP → logradouro, bairro, localidade, uf | nenhuma | Timeout de 5 s; sem resposta → segue para o Google com o que a pessoa digitou |
| Google Geocoding `https://maps.googleapis.com/maps/api/geocode/json` | Endereço → coordenada, `formatted_address`, `location_type`, `partial_match` | `GOOGLE_MAPS_API_KEY` (opcional no zod; sem chave, o cadastro de endereço avisa que está indisponível). Restringir a chave à Geocoding API e ao IP do servidor. | Timeout de 5 s; erro → mensagem de "tente de novo"; nada é salvo |

As duas ficam atrás de uma interface `Geocodificador` com fake em `__mocks__`, no mesmo padrão do cliente do Mercado Pago.

### Cálculo (função pura, preparada para o lado de pedidos)

Em `src/menu/entrega.ts`:

```
calcularEntrega(loja, destino: { latitude, longitude })
  → { disponivel: true,  distanciaKm, taxa }
  | { disponivel: false, distanciaKm, motivo: 'FORA_DA_AREA' }
  | { disponivel: false, motivo: 'LOJA_SEM_ENTREGA' | 'LOJA_SEM_ENDERECO' | 'SEM_FAIXAS' }
```

- Haversine com raio da Terra de 6.371 km.
- Limite **inclusivo**: "até 1 km" vale para distância ≤ 1,000 km.
- A taxa é a da primeira faixa com `distanciaKm ≤ ateKm`.
- Distância exibida arredondada para 0,1 km; a comparação usa o valor sem arredondar.

Esta etapa **só cria e testa a função**. Usá-la no pedido depende do endereço do cliente (que também pode passar pelo mesmo `Geocodificador`) e dos campos de modalidade e endereço no `Pedido`. Isso fica para a etapa de pedidos (lacunas B3/B4 do `docs/frontend-plano.md`).

### API pública

`GET /v1/menu` passa a devolver `loja.endereco` (formatado), `loja.faixasEntrega` e `loja.raioMaximoKm` (o maior `ateKm`), para o front mostrar "Entrega até 3 km". Entrega indisponível (loja antiga sem configuração) aparece como `fazEntrega: false` na resposta.

### Testes

| Arquivo | Casos |
|---|---|
| `entrega.test.ts` | Haversine com pares conhecidos; borda inclusiva (1,000 km); fora da área; loja sem endereço, sem faixas, sem entrega; loja antiga com `taxaEntrega` = indisponível |
| `endereco.test.ts` | Normalização de CEP; CEP inválido sem chamada de API; ViaCEP + Google ok; CEP não encontrado; ViaCEP fora do ar cai no Google; precisão baixa e `partial_match` geram aviso; CEP divergente gera aviso; Google fora do ar |
| `rascunho.test.ts` | Faixas ordenadas; raio inválido, taxa negativa, repetição, mais de 6; pendências (endereço pendente, sem endereço, sem faixas); resumo; antes → depois |
| `gestao.service` | Confirmação sim/não do endereço sem IA; correção parcial mescla e busca de novo; "é isso" com endereço pendente; `cancelar` descarta o pendente; aviso para loja antiga |
| `deepseek-interpretador` | `definir_endereco` e `faixas_entrega` validados pelo zod; metros convertidos em km |

### Onde mexer

| Parte | Arquivo |
|---|---|
| Schema e migration | `prisma/schema.prisma` |
| Env (`GOOGLE_MAPS_API_KEY`) | `src/config/env.ts`, `.env.example` |
| Tipos do rascunho e do contexto | `src/menu/conversation/conversation-state.types.ts` |
| ViaCEP + Google atrás de `ConsultaCep` / `Geocodificador` | `src/menu/endereco/` (novo), fake em `__mocks__/endereco.fake.ts` |
| Confirmação do endereço, aviso para loja antiga | `src/menu/gestao/gestao.service.ts` |
| Validação, pendências, resumo | `src/menu/gestao/rascunho.ts` |
| Operações e prompt | `src/menu/gestao/interpretador.ts`, `src/menu/gestao/deepseek-interpretador.ts` |
| Leitura e gravação | `src/menu/gestao/gestao.repository.prisma.ts`, `src/menu/menu.repository.prisma.ts` |
| Cálculo e validação das faixas | `src/menu/entrega.ts` (novo) |
| Testes | `src/menu/entrega.test.ts`, `src/menu/endereco/*.test.ts`, `src/menu/gestao/gestao.service.endereco.test.ts` |
| Injeção do geocodificador | `src/main.ts` |
