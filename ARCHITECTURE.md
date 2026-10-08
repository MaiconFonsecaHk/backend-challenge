# Arquitetura

## 1. Status e fonte de verdade

Este é um documento vivo. Ele descreve apenas decisões já tomadas e torna explícitas as decisões que ainda dependem de análise ou evidência.

O `README.md` do desafio é a fonte de verdade dos requisitos. Este documento não pode reduzir, reinterpretar ou substituir esses requisitos. Em caso de conflito, o `README.md` prevalece.

Estados utilizados:

- **confirmada**: decisão implementada e sustentada por evidência reproduzível;
- **aberta**: decisão ainda não tomada porque faltam análise, implementação ou prova;
- **obrigatória**: restrição definida diretamente pelo desafio, não uma escolha da solução.

## 2. Objetivos arquiteturais

A arquitetura deve preservar, inclusive sob concorrência, redelivery e falhas parciais:

- precisão monetária sem `number`, `float` ou `double`;
- saldo nunca negativo;
- igualdade entre saldo materializado e saldo reconstruído pelo ledger;
- no máximo um efeito financeiro para a mesma operação idempotente;
- atomicidade entre wallet, ledger, transação, inbox e outbox quando fizerem parte da mesma operação;
- publicação somente depois do commit financeiro;
- funcionamento correto com três ou mais instâncias;
- recuperação de mensagens duplicadas, fora de ordem e entregues novamente.

Esses objetivos ainda não significam que os mecanismos concretos foram escolhidos. Locking, hashing, retries e TTL permanecem abertos até possuírem justificativa e testes próprios.

## 3. Visão atual de componentes

```text
AppModule
├── ConfigModule
├── PersistenceModule
│   └── MikroORM
│       ├── registro explícito de modelos de persistência
│       └── PostgreSQL
└── HealthModule
    ├── GET /health/live
    ├── PostgreSQL health indicator ── MikroORM ── SELECT 1
    └── SQS health indicator ── AWS SDK v3 ── MiniStack/SQS
```

Ainda não existem endpoints financeiros, tabelas de negócio, consumidor SQS ou workers. O domínio puro da Fase 2 contém `Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`, os modelos de inbox/outbox e os eventos de integração. A infraestrutura já descreve os cinco modelos persistentes correspondentes, mas migrations, constraints, repositórios e casos de uso continuam nas etapas específicas do roadmap.

## 4. Boundaries e dependências

A direção de dependência pretendida é:

```text
interfaces ──────→ application ──────→ domain
infrastructure ──→ application/domain ports
bootstrap ───────→ module composition
```

- `domain`: regras financeiras, aggregates, entidades, value objects, eventos e erros puros;
- `application`: casos de uso, portas e coordenação das transações de negócio;
- `infrastructure`: MikroORM, PostgreSQL, AWS SDK, SQS, relógio e IDs concretos;
- `interfaces`: controllers HTTP, consumidores, workers e health checks;
- `bootstrap`: composição dos módulos e inicialização do processo.

O domínio não pode importar NestJS, MikroORM, AWS SDK ou tipos de transporte. Persistência de inbox/outbox e mecanismos de SQS pertencem à infraestrutura, ainda que seus contratos e eventos sejam definidos em camadas internas.

## 5. Decisões confirmadas

### D-001 — Bun, NestJS e TypeScript estrito

- **Status:** confirmada e obrigatória.
- **Requisito protegido:** aderência à stack prescrita e segurança estática básica.
- **Alternativas consideradas:** não aplicável para runtime e framework, pois são obrigatórios; relaxar o modo estrito foi rejeitado.
- **Trade-off:** a compatibilidade das bibliotecas precisa ser verificada com a versão efetivamente fixada do Bun e do TypeScript.
- **Evidência:** `bun run typecheck`, `bun run build`, inicialização real da aplicação e `bun test --check`.

### D-002 — PostgreSQL como autoridade persistente

- **Status:** confirmada e obrigatória.
- **Requisito protegido:** atomicidade, constraints, idempotência persistente e coordenação entre instâncias.
- **Alternativas consideradas:** garantias apenas em memória ou no broker foram rejeitadas pelo desafio.
- **Trade-off:** disponibilidade da aplicação depende do banco para operações financeiras; falhas devem aparecer em readiness e gerar retry controlado nos fluxos apropriados.
- **Evidência:** conexão e consulta reais contra PostgreSQL em container, além do ciclo de migration em banco limpo.

### D-003 — MikroORM para persistência PostgreSQL

- **Status:** confirmada.
- **Requisito protegido:** integração com PostgreSQL, migrations reversíveis e transações explícitas sem contaminar o domínio.
- **Alternativas consideradas:** TypeORM é aceito, mas MikroORM é a preferência do desafio e oferece Unit of Work, Identity Map e `EntityManager.transactional()` de forma explícita. Prisma está fora do escopo.
- **Trade-off:** o mapeamento persistente e os contextos do `EntityManager` exigem disciplina, especialmente em consumers e workers.
- **Evidência:** inicialização pelo container do NestJS e consulta SQL executada pelo `EntityManager` contra PostgreSQL real.

### D-004 — MiniStack para SQS local

- **Status:** confirmada para desenvolvimento e testes locais.
- **Requisito protegido:** uso de SQS realista em container sem substituir a integração por mocks.
- **Alternativas consideradas:** LocalStack foi testado, mas a imagem atual exigiu token de autenticação; MiniStack atende ao serviço SQS necessário sem credencial privada e é permitido pelo desafio.
- **Trade-off:** um emulador não reproduz integralmente o comportamento operacional da AWS; garantias finais continuam pertencendo ao PostgreSQL e precisam de testes contra a API compatível usada pelo projeto.
- **Evidência:** criação e consulta das duas filas FIFO, verificação dos atributos e reprovisionamento após reinício.

### D-005 — Migrations explícitas, transacionais e reversíveis

- **Status:** confirmada para a infraestrutura e para a criação das cinco tabelas persistentes.
- **Requisito protegido:** evolução reproduzível e reversível do schema.
- **Alternativas consideradas:** sincronização automática do schema e alterações manuais foram rejeitadas.
- **Trade-off:** toda alteração exige migration revisada, snapshot coerente e um caminho `down`; alterações destrutivas precisarão de análise adicional. O snapshot possui nome estável e independe do nome do banco usado localmente ou em testes.
- **Escolha:** a migration de schema foi gerada pela CLI do MikroORM a partir do registro explícito de entidades. Ela cria `wallets`, `wager_transactions`, `wallet_ledger_entries`, `inbox_messages` e `outbox_messages`, incluindo chaves primárias, relações já modeladas e os valores enumerados conhecidos. O `down` remove somente esse schema, preservando o baseline e o controle de migrations.
- **Evidência:** em um banco PostgreSQL temporário e isolado, `migration:up` aplicou baseline e schema desde zero; a inspeção do catálogo confirmou exatamente as cinco tabelas; `migration:down` removeu todas elas; uma nova execução de `migration:up` as recriou; a comparação final entre banco, snapshot e metadados informou que não havia drift.

O baseline permanece neutro e prova a cadeia inicial. A migration seguinte contém o DDL real das tabelas. Constraints financeiras adicionais, índices e proteção de imutabilidade do ledger continuam em blocos próprios e não são considerados concluídos pela simples criação das tabelas.

### D-006 — Liveness separado de readiness

- **Status:** confirmada.
- **Requisito protegido:** distinguir processo vivo de instância apta a receber tráfego.
- **Alternativas consideradas:** um único endpoint foi rejeitado porque mistura falha do processo com indisponibilidade transitória de dependências.
- **Trade-off:** cada chamada de readiness realiza operações reais e possui custo controlado por timeout.
- **Evidência:** liveness permaneceu `200` durante falhas isoladas de PostgreSQL e SQS; readiness respondeu `503` e voltou a `200` após cada recuperação.

### D-007 — AWS SDK v3 com credenciais por provider chain

- **Status:** confirmada para a integração básica.
- **Requisito protegido:** acesso ao SQS local e compatibilidade futura com credenciais gerenciadas em ambiente AWS.
- **Alternativas consideradas:** credenciais estáticas obrigatórias foram rejeitadas porque impediriam uso de roles; credenciais locais opcionais continuam disponíveis para o emulador.
- **Trade-off:** o ambiente de execução precisa fornecer uma fonte válida de credenciais quando valores estáticos não forem configurados.
- **Evidência:** `GetQueueUrl` executado contra MiniStack e validação de que access key e secret key só podem ser fornecidas em conjunto.

### D-008 — Erros codificados e portas para IDs e tempo

- **Status:** confirmada apenas como padrão fundamental.
- **Requisito protegido:** distinguir violações esperadas do domínio de erros inesperados e permitir geração determinística de IDs e tempo nos casos de uso.
- **Alternativas consideradas:** acesso direto e espalhado a `Date`, geradores globais e erros identificados somente por mensagem foram rejeitados; a taxonomia final de códigos, o formato concreto dos IDs e a autoridade dos timestamps continuam abertos.
- **Trade-off:** as portas introduzem uma pequena indireção, mas evitam acoplamento a relógio e geração aleatória em testes e regras de negócio.
- **Escolha:** erros esperados do domínio derivam de `DomainError` e expõem um código estável; casos de uso dependerão das portas `Clock` e `IdGenerator`; `SystemClock` é o adapter concreto mínimo disponível. Nenhum gerador concreto de ID foi escolhido ainda.
- **Evidência:** testes do contrato básico de `DomainError` e do adapter `SystemClock`, além do type-check das portas puras.

### D-009 — `Money` com aritmética decimal exata

- **Status:** confirmada para o domínio puro; o mapeamento no PostgreSQL continua aberto.
- **Requisito protegido:** dinheiro nunca usa `number`, mantém escala fixa de duas casas na entrada e na saída e não permite operações entre moedas diferentes.
- **Alternativas consideradas:** `number` foi rejeitado por não representar decimais financeiros exatamente; `decimal.js` foi descartado para este conjunto de operações porque aplica uma precisão global aos resultados; representação apenas em minor units com `bigint` foi descartada porque o desafio pede uma biblioteca decimal exata e uma representação decimal explícita.
- **Trade-off:** o domínio expõe somente soma, subtração, negação e comparações, operações que o `big.js` executa exatamente. Divisão, raiz e potências não fazem parte do contrato de `Money`. A moeda é validada no formato canônico ISO-4217 alpha-3; a lista de moedas habilitadas pelo produto será uma política do contrato de entrada, sendo `BRL` suficiente para o desafio.
- **Escolha:** `big.js` `7.0.1`, com tipos fixados em `@types/big.js` `7.0.0`. `Money` recebe e serializa strings com duas casas, preserva sua instância imutável e cria novos valores em todas as operações. Valores assinados são aceitos no value object porque diferenças e reversões podem ser negativas; contratos que representam quantias positivas devem rejeitá-los explicitamente antes de executar o caso de uso.
- **Evidência:** testes unitários cobrem escala, formato inválido, serialização canônica, imutabilidade, zero, soma, subtração, negação, sinais, comparações, valores além do limite seguro do JavaScript, moedas diferentes e códigos de erro estáveis.
- **Limitação e gatilho de revisão:** a representação em colunas PostgreSQL e o round-trip pelo ORM só serão definidos na fase de persistência, com teste contra banco real.

### D-010 — Transições locais da `Wallet` produzem uma mudança de saldo explícita

- **Status:** confirmada para o domínio puro; atomicidade, unicidade e concorrência continuam abertas até a implementação da persistência e dos casos de uso.
- **Requisito protegido:** saldo nunca negativo, moeda consistente, versão iniciada em `1` e incrementada somente quando o saldo muda, além da correspondência futura entre cada movimento e um lançamento do ledger.
- **Alternativas consideradas:** métodos que apenas alteram o saldo e retornam `void` foram rejeitados porque ocultariam os valores anterior e posterior necessários ao ledger; criar e persistir o ledger dentro do aggregate foi rejeitado porque acoplaria o domínio à infraestrutura e à transação SQL.
- **Trade-off:** `credit` e `debit` alteram o estado local e retornam um `WalletBalanceChange` imutável com direção, valor, saldos anterior/posterior e nova versão. O retorno torna a mudança explícita, mas a garantia atômica de persistir wallet e ledger ainda pertence ao caso de uso e ao PostgreSQL.
- **Escolha:** abertura aceita saldo zero ou positivo, inicia a versão em `1` e recebe o instante externamente; créditos e débitos exigem valores positivos da mesma moeda; overdraft falha antes de qualquer mutação; `rehydrate` reconstrói o estado persistido sem repetir validações de transição; cópias defensivas impedem mutação externa dos timestamps.
- **Evidência:** testes unitários cobrem abertura, saldo zero, identidade, saldo inicial negativo, crédito, débito até zero, overdraft sem mutação, moedas divergentes, movimentos não positivos, versionamento, timestamps defensivos, reidratação e códigos de erro estáveis.
- **Limitação e gatilho de revisão:** a unicidade de `(playerId, currency)`, a atomicidade com `OPENING` e ledger, o controle de concorrência e a não-negatividade no schema só estarão garantidos após migrations e testes reais de PostgreSQL.

### D-011 — Máquina de estados explícita para `WagerTransaction`

- **Status:** confirmada para o domínio puro; resolução concorrente, unicidade de reversão e taxonomia concreta de falhas continuam abertas.
- **Requisito protegido:** transações nascem em `PENDING`, referências ausentes permanecem recuperáveis e estados `PROCESSED`, `REJECTED` e `FAILED` nunca sofrem novas transições.
- **Alternativas consideradas:** setters livres de status foram rejeitados porque permitiriam estados impossíveis; revalidar regras de transição durante `rehydrate` foi rejeitado porque reidratação deve reconstruir o estado persistido; definir agora todos os códigos de rejeição foi rejeitado porque essa taxonomia depende dos casos de uso e contratos ainda não implementados.
- **Trade-off:** `FailureCode` permanece textual, mas só aceita identificadores estáveis em maiúsculas, números e underscores. Isso garante formato legível por máquina sem antecipar quais códigos pertencem a rejeições de negócio ou falhas permanentes.
- **Escolha:** as transições válidas são `PENDING → PENDING_REFERENCE | PROCESSED | REJECTED | FAILED` e `PENDING_REFERENCE → PROCESSED | REJECTED | FAILED`; repetir `PENDING_REFERENCE` é erro de estado. `REFUND` e `ROLLBACK` exigem referência, `WIN` pode referenciar `BET`, e `OPENING`, `BET` e `LOSS` não carregam referência externa. Toda transição terminal registra timestamp; rejeição e falha também registram `failureCode`.
- **Referências:** o cálculo da direção do ledger valida que a referência está `PROCESSED`, possui tipo permitido e pertence ao mesmo provider, player, wallet, moeda e rodada. `REFUND` e `ROLLBACK` exigem valor idêntico; `ROLLBACK` inverte a direção de `BET`, `WIN` ou `REFUND`. `LOSS` não possui direção de ledger.
- **Semântica auxiliar:** `affectsBalance()` descreve o efeito do tipo da operação, não confirma que o efeito foi aplicado; uma transação rejeitada continua sem alterar wallet ou ledger. `matchesPayload()` apenas compara o hash persistido; canonicalização e algoritmo do hash continuam decisões abertas.
- **Evidência:** testes unitários cobrem os seis tipos, identidade, valores positivos, formato de referência, todas as transições, terminalidade, timestamps defensivos, códigos de falha, reidratação, hash, efeito no saldo, direção do ledger e todas as regras locais de referência.
- **Limitação e gatilho de revisão:** `OPENING` só será bloqueado em entradas HTTP/SQS quando esses adaptadores existirem. Uma única reversão por tipo, referência pendente, resolução atômica e proteção contra corridas exigem constraints, consultas e transações PostgreSQL nas fases seguintes.

### D-012 — Ledger imutável com aritmética verificável

- **Status:** confirmada para a entidade de domínio; unicidade e imutabilidade no PostgreSQL continuam abertas.
- **Requisito protegido:** cada lançamento precisa provar `balanceBefore ± money === balanceAfter`, usar uma única moeda e nunca representar saldo negativo.
- **Alternativas consideradas:** confiar apenas no caso de uso foi rejeitado porque permitiria construir lançamentos inconsistentes; impedir a reidratação de dados divergentes foi rejeitado porque ocultaria corrupção que a reconciliação precisa detectar.
- **Trade-off:** `create` valida todas as invariantes e falha imediatamente; `rehydrate` reconstrói exatamente o estado persistido, enquanto `isBalanced()` retorna `false` para aritmética, moeda, sinal ou direção inconsistentes. Assim, leitura e reconciliação conseguem tornar divergências visíveis sem normalizá-las silenciosamente.
- **Escolha:** `WalletLedgerEntry` não possui setters nem métodos de transição, congela a instância e protege o timestamp com cópias defensivas. Débitos subtraem o valor do saldo anterior; créditos somam; o valor precisa ser positivo e os dois saldos precisam ser não negativos.
- **Evidência:** testes unitários cobrem crédito, débito até zero, valores além do limite seguro do JavaScript, identidade, timestamp, moedas divergentes, valores não positivos, saldos negativos, aritmética incorreta, direção desconhecida, imutabilidade e reidratação de dados inconsistentes.
- **Limitação e gatilho de revisão:** `Object.freeze` protege a instância em memória, mas não impede alterações no banco. A constraint única `(walletId, transactionId)`, as foreign keys e a proteção contra `UPDATE`/`DELETE` serão definidas e testadas na fase de persistência. A regra que impede ledger para `LOSS` ou transação rejeitada pertence ao caso de uso atômico.

### D-013 — Inbox, outbox e eventos permanecem puros e orientados à persistência

- **Status:** confirmada para os modelos e envelopes de domínio; persistência, claims concorrentes, backoff concreto e publicação SQS continuam abertos.
- **Requisito protegido:** deduplicação precisa ser persistente, eventos financeiros só podem ser publicados depois do commit e seus payloads precisam ser estáveis, imutáveis, versionados e serializáveis como JSON.
- **Alternativas consideradas:** usar cache em memória para inbox foi rejeitado pelo desafio; publicar diretamente durante o caso de uso foi rejeitado porque pode preceder ou escapar do commit; colocar instâncias de `Money` nos eventos foi rejeitado porque acopla o contrato ao domínio e produz serialização instável; fixar agora quantidade de tentativas ou atrasos foi rejeitado por falta de evidência operacional.
- **Escolha para inbox:** `InboxMessage` guarda `(consumerName, messageId)`, hash do payload, recebimento e processamento. `matchesPayload()` distingue replay idêntico de conflito e `markProcessed()` só pode ocorrer uma vez. A constraint composta e a atomicidade com os efeitos financeiros serão responsabilidade do PostgreSQL.
- **Escolha para eventos:** a classe abstrata `IntegrationEvent<T>` produz envelope com IDs, correlação, causação opcional, timestamp ISO-8601, tipo e versão definidos pela subclasse. Os quatro eventos obrigatórios possuem versão `1`; dados monetários usam `MoneyProps`. O payload é copiado e congelado recursivamente e rejeita classes, `undefined`, `NaN` e `Infinity`.
- **Escolha para outbox:** `OutboxMessage` é criado a partir do envelope completo, inicia pendente com zero tentativas, registra agendamento e publicação e não aceita transições depois de publicado. `scheduleRetry` recebe uma política, incrementa tentativas somente após obter um agendamento válido e não embute números arbitrários de backoff.
- **Trade-off:** os modelos expressam estados e contratos sem importar MikroORM ou AWS SDK, mas sozinhos não garantem deduplicação, claim exclusivo, recuperação de publisher morto ou publicação após commit. Essas garantias dependem da mesma transação SQL e dos workers das fases posteriores.
- **Evidência:** testes unitários cobrem replay e conflito de payload, terminalidade de inbox/outbox, timestamps defensivos, retry injetado, falha de agendamento sem mutação, serialização JSON profunda, rejeição de dados instáveis, envelopes versionados, todos os eventos obrigatórios e validação de suas entidades de origem.
- **Limitação e gatilho de revisão:** limites de retry, backoff, leasing/locking, recuperação, ordem de publicação e comportamento com dois publishers só serão escolhidos após implementação e testes com PostgreSQL e SQS reais.

### D-014 — Modelos do MikroORM separados do domínio e registrados explicitamente

- **Status:** confirmada para o desenho e a descoberta dos metadados; DDL, constraints, índices e round-trip em PostgreSQL real continuam abertos.
- **Requisito protegido:** o domínio deve permanecer independente do ORM, dinheiro não pode passar por `number` e runtime, CLI e migrations precisam descobrir o mesmo conjunto de modelos.
- **Alternativas consideradas:** decorators do MikroORM nas entidades de domínio foram rejeitados por inverter a direção de dependência; `autoLoadEntities` isolado foi rejeitado porque só descobre entidades registradas em módulos Nest e não configura a CLI; mapear `Money` como objeto opaco foi rejeitado porque esconderia valor e moeda do schema; enums nativos do PostgreSQL não foram escolhidos porque aumentam o custo de evolução e reversão sem benefício demonstrado neste momento.
- **Escolha:** cinco classes de persistência definidas com `defineEntity` vivem em `infrastructure`: wallet, wager transaction, ledger, inbox e outbox. Um registro único e explícito alimenta tanto o bootstrap do NestJS quanto a configuração da CLI. Relações financeiras usam foreign keys mapeadas para IDs escalares, evitando que referências do ORM atravessem a futura fronteira dos repositórios.
- **Dinheiro e tempo:** valores monetários usam `numeric` com conversão do MikroORM para `string`, nunca `number`; moedas ocupam `char(3)` separado; timestamps usam `timestamptz`. Precisão máxima e autoridade de timestamps não foram inventadas. A escala fixa, moedas válidas e coerência entre colunas serão protegidas pelas constraints do próximo bloco.
- **Estado recuperável:** a transação persiste o saldo original do resultado idempotente e o agendamento de referências pendentes; inbox usa identidade composta `(consumerName, messageId)`; outbox conserva o envelope em `jsonb`, tentativas e datas de agendamento/publicação.
- **IDs:** chaves internas e `playerId` são armazenados como UUID, coerentes com os contratos do desafio; a decisão de onde e como gerar esses UUIDs continua aberta.
- **Evidência:** testes inicializam a descoberta de metadados sem conexão de banco e verificam as cinco tabelas, tipos monetários em string, moedas, enums, relações, identidade da inbox e estado recuperável da outbox/transação. Type-check e build também validam o mesmo registro usado pela aplicação.
- **Limitação e gatilho de revisão:** os metadados ainda não criam nem protegem tabelas por si só. A decisão só poderá ser promovida a garantia persistente depois de uma migration reversível e de testes contra PostgreSQL real, incluindo round-trip monetário e inspeção das constraints.

## 6. Decisões abertas

Nenhuma alternativa desta tabela está escolhida antecipadamente.

| Decisão | Requisito protegido | Alternativas que precisam ser avaliadas | Evidência necessária para fechar |
| --- | --- | --- | --- |
| Validação persistente de `Money` | precisão decimal e moeda consistente no PostgreSQL | o desenho `numeric` como string + `char(3)` precisa ser confrontado com DDL, constraints e reidratação reais | teste de round-trip contra banco real sem perda de escala ou precisão |
| Geração de IDs | unicidade e ordenação quando necessária | UUID gerado na aplicação, UUID gerado no banco ou outra estratégia justificada | testes de geração, persistência e concorrência |
| Autoridade dos timestamps | resultados testáveis e timestamps consistentes | instante fornecido pelo `Clock`, timestamp do PostgreSQL ou combinação documentada | testes determinísticos, persistência e comportamento entre instâncias |
| Limite transacional | atomicidade de wallet, ledger, transação, inbox e outbox | desenho do caso de uso e escopo do `EntityManager.transactional()` | testes de rollback e falha antes/depois do commit |
| Concorrência por wallet | impedir saldo negativo e lost update sem lock global | lock pessimista, lock otimista com retry, update condicionado ou combinação | duas apostas concorrentes, hot wallet, wallets distintas e três instâncias |
| Idempotência HTTP | replay idêntico sem duplicar efeitos | chave persistente, estado armazenado, canonicalização e algoritmo de hash | mesma requisição 50 vezes, payload divergente e falha concorrente |
| Inbox SQS | deduplicação persistente e ack após commit | modelo de inbox e fronteira transacional do consumer | redelivery, crash após commit e antes do ack, múltiplos consumers |
| Outbox | nenhum evento confirmado perdido | claim concorrente, leasing/locking e marcação de publicação | crash após commit, dois publishers e publicação duplicada |
| Ordenação FIFO | preservar paralelismo por wallet sem torná-lo garantia final | `MessageGroupId` por wallet e deduplicação do broker como otimização | mesma wallet serializada, wallets distintas paralelas e redelivery |
| Retry e backoff | recuperação sem loop infinito | limites, backoff e classificação de erros ainda não definidos | testes de erro transitório, permanente, exaustão e observabilidade |
| Referência pendente | processar mensagens fora de ordem sem perda | TTL ou máximo de tentativas ainda não definidos | referência posterior, expiração e rejeição terminal auditável |
| Taxonomia de falhas | clientes e workers agirem sem analisar texto | códigos de validação, conflito, negócio e infraestrutura | testes de mapeamento estável em HTTP e SQS |
| Cursor do ledger | paginação estável e determinística | composição e codificação opaca do cursor | empates, inserções concorrentes e continuidade sem duplicação |
| Autenticação | ponto de extensão sem competir com garantias financeiras | IdP externo ou adiamento documentado com porta/guard explícito | integração do IdP ou teste do ponto de extensão; health permanece público |
| Shutdown de workers | não perder trabalho em andamento | drenagem, extensão/devolução de visibility timeout e ordem de encerramento | `SIGTERM` durante consumo e publicação |
| Observabilidade | diagnosticar rejeições, retries, DLQ e divergências | formato de logs, correlação e métricas ainda não definidos | testes que confirmem sinais úteis sem expor dados sensíveis |

## 7. Modelo transacional — estado atual

O modelo transacional financeiro permanece aberto. As entidades financeiras, inbox, outbox e eventos já expressam seus estados locais, mas os casos de uso e as garantias de persistência ainda não foram implementados. A restrição estabelecida é:

```text
wallet + ledger + wager transaction + inbox + outbox
                         ↓
              mesma transação SQL quando
              pertencem à mesma operação
```

Nenhum evento pode ser publicado antes do commit. SQS FIFO não substituirá locks, constraints ou idempotência no PostgreSQL.

## 8. Autenticação — estado atual

Autenticação não está implementada e a decisão final entre integrar um Identity Provider ou adiar essa integração permanece aberta. Não será criada tabela própria de usuários ou senha.

Se a autenticação for adiada, a arquitetura deverá expor um ponto explícito, como `ProviderIdentityPort` ou um guard substituível. `/health/live` e `/health/ready` continuarão públicos, e a identidade do provider recebida por SQS continuará sujeita às regras do domínio.

## 9. Evidências reproduzíveis disponíveis

Com as variáveis de `.env.example` configuradas:

```bash
bun install --frozen-lockfile
docker compose up -d --wait
bun run typecheck
bun run build
bun run test
bun run migration:pending
bun run migration:up
bun run migration:down
```

O ciclo `up → inspeção → down → inspeção → up` foi comprovado em banco PostgreSQL temporário, seguido por uma comparação sem drift entre banco, snapshot e metadados. Testes automatizados de integração e concorrência serão adicionados nas fases correspondentes; os testes atuais também comprovam o runner do Bun, a normalização básica da configuração, o comportamento puro da Fase 2 e a descoberta dos cinco modelos persistentes com seus tipos e relações.

## 10. Limitações atuais

- os modelos puros da Fase 2 ainda não possuem casos de uso, mappers nem repositórios;
- a migration materializa as cinco tabelas, mas ainda faltam constraints financeiras obrigatórias, índices orientados aos acessos e proteção de imutabilidade do ledger;
- não existem endpoints de wallet, wagering ou ledger;
- não existem consumer, inbox, outbox ou publisher;
- não existem garantias implementadas de concorrência ou idempotência;
- não existem testes automatizados de integração, concorrência ou crash recovery;
- não existem autenticação, logs estruturados ou métricas de negócio;
- o comportamento do emulador local não substitui validação operacional em AWS real.

## 11. Template para novas decisões

Toda nova decisão crítica deve ser registrada antes de ser tratada como encerrada:

```text
Decisão:
Status:
Requisito protegido:
Alternativas consideradas:
Trade-offs aceitos:
Escolha e justificativa:
Teste ou evidência:
Limitações e gatilho de revisão:
```
