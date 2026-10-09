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
│       ├── repositórios transacionais e mappers explícitos
│       ├── Unit of Work por `EntityManager.transactional()`
│       └── PostgreSQL
├── WalletApplicationModule
│   ├── CreateWalletUseCase
│   ├── GetWalletUseCase
│   ├── GetWalletLedgerUseCase
│   ├── ReconcileWalletUseCase
│   ├── Base64UrlLedgerCursorCodec
│   ├── UuidGenerator
│   └── SystemClock
├── SqsWagerConsumerModule
│   ├── SqsWagerConsumer ── long polling, ack, retry e DLQ
│   ├── SqsWagerMessageHandler ── contrato SQS → use case compartilhado
│   └── ProcessWagerTransactionUseCase ── inbox + efeitos + outbox atômicos
├── OutboxPublisherModule
│   ├── OutboxPublisherWorker ── polling e shutdown cooperativo
│   ├── PublishOutboxBatchUseCase ── claim + publicação + retry transacionais
│   └── SqsOutboxEventTransport ── integration-events.fifo
├── PendingReferenceWorkerModule
│   ├── PendingReferenceWorker ── polling e shutdown cooperativo
│   └── ProcessPendingReferencesBatchUseCase ── claim + resolução + expiração
└── HealthModule
    ├── GET /health/live
    ├── PostgreSQL health indicator ── MikroORM ── SELECT 1
    └── SQS health indicator ── AWS SDK v3 ── MiniStack/SQS
```

Os endpoints financeiros e de consulta e o consumidor SQS expõem o mesmo caso de uso de wagering por bordas validadas. O publisher da outbox reivindica eventos confirmados no PostgreSQL e os publica em uma fila FIFO dedicada. O worker de referências retoma transações fora de ordem com o mesmo executor financeiro, ou as rejeita auditavelmente no prazo configurado. O domínio puro da Fase 2 contém `Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`, os modelos de inbox/outbox e os eventos de integração. A infraestrutura materializa os cinco modelos persistentes com constraints, índices, mappers, repositórios e Unit of Work transacional. A aplicação possui os casos de uso de criação, consulta e reconciliação de wallet, consulta paginada do ledger e uma entrada única e independente de transporte para submissões de wagering. Essa entrada normaliza o comando, calcula seu hash canônico e passa por um processador de idempotência persistente que serializa operações de saldo por wallet e executa inbox e efeitos financeiros com outbox na mesma transação SQL.

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

O baseline permanece neutro e prova a cadeia inicial. A migration seguinte contém o DDL real das tabelas, e uma migration incremental aplica as constraints financeiras e a proteção de imutabilidade. Índices puramente orientados aos padrões de consulta continuam em bloco próprio; os índices criados por unicidades existem para garantir invariantes, não como otimização antecipada.

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

- **Status:** confirmada para o domínio puro; persistência, atomicidade de abertura e concorrência pessimista por wallet também estão confirmadas, enquanto as operações externas ainda aguardam seu executor.
- **Requisito protegido:** saldo nunca negativo, moeda consistente, versão iniciada em `1` e incrementada somente quando o saldo muda, além da correspondência futura entre cada movimento e um lançamento do ledger.
- **Alternativas consideradas:** métodos que apenas alteram o saldo e retornam `void` foram rejeitados porque ocultariam os valores anterior e posterior necessários ao ledger; criar e persistir o ledger dentro do aggregate foi rejeitado porque acoplaria o domínio à infraestrutura e à transação SQL.
- **Trade-off:** `credit` e `debit` alteram o estado local e retornam um `WalletBalanceChange` imutável com direção, valor, saldos anterior/posterior e nova versão. O retorno torna a mudança explícita, mas a garantia atômica de persistir wallet e ledger ainda pertence ao caso de uso e ao PostgreSQL.
- **Escolha:** abertura aceita saldo zero ou positivo, inicia a versão em `1` e recebe o instante externamente; créditos e débitos exigem valores positivos da mesma moeda; overdraft falha antes de qualquer mutação; `rehydrate` reconstrói o estado persistido sem repetir validações de transição; cópias defensivas impedem mutação externa dos timestamps.
- **Evidência:** testes unitários cobrem abertura, saldo zero, identidade, saldo inicial negativo, crédito, débito até zero, overdraft sem mutação, moedas divergentes, movimentos não positivos, versionamento, timestamps defensivos, reidratação e códigos de erro estáveis.
- **Limitação e gatilho de revisão:** unicidade de `(playerId, currency)`, não-negatividade, identidade imutável e progressão da versão já são protegidas no PostgreSQL. A atomicidade com `OPENING` e ledger e o controle de concorrência continuam dependentes dos casos de uso e dos testes paralelos.

### D-011 — Máquina de estados explícita para `WagerTransaction`

- **Status:** confirmada para o domínio puro; resolução concorrente, unicidade de reversão e taxonomia concreta de falhas continuam abertas.
- **Requisito protegido:** transações nascem em `PENDING`, referências ausentes permanecem recuperáveis e estados `PROCESSED`, `REJECTED` e `FAILED` nunca sofrem novas transições.
- **Alternativas consideradas:** setters livres de status foram rejeitados porque permitiriam estados impossíveis; revalidar regras de transição durante `rehydrate` foi rejeitado porque reidratação deve reconstruir o estado persistido; definir agora todos os códigos de rejeição foi rejeitado porque essa taxonomia depende dos casos de uso e contratos ainda não implementados.
- **Trade-off:** `FailureCode` permanece textual, mas só aceita identificadores estáveis em maiúsculas, números e underscores. Isso garante formato legível por máquina sem antecipar quais códigos pertencem a rejeições de negócio ou falhas permanentes.
- **Escolha:** as transições válidas são `PENDING → PENDING_REFERENCE | PROCESSED | REJECTED | FAILED` e `PENDING_REFERENCE → PROCESSED | REJECTED | FAILED`; repetir `PENDING_REFERENCE` é erro de estado. `REFUND` e `ROLLBACK` exigem referência, `WIN` pode referenciar `BET`, e `OPENING`, `BET` e `LOSS` não carregam referência externa. Toda transição terminal registra timestamp; rejeição e falha também registram `failureCode`.
- **Referências:** o cálculo da direção do ledger valida que a referência está `PROCESSED`, possui tipo permitido e pertence ao mesmo provider, player, wallet, moeda e rodada. `REFUND` e `ROLLBACK` exigem valor idêntico; `ROLLBACK` inverte a direção de `BET`, `WIN` ou `REFUND`. `LOSS` não possui direção de ledger.
- **Semântica auxiliar:** `affectsBalance()` descreve o efeito do tipo da operação, não confirma que o efeito foi aplicado; uma transação rejeitada continua sem alterar wallet ou ledger. `matchesPayload()` apenas compara o hash persistido; canonicalização e algoritmo do hash continuam decisões abertas.
- **Evidência:** testes unitários cobrem os seis tipos, identidade, valores positivos, formato de referência, todas as transições, terminalidade, timestamps defensivos, códigos de falha, reidratação, hash, efeito no saldo, direção do ledger e todas as regras locais de referência.
- **Limitação e gatilho de revisão:** `OPENING` só será bloqueado em entradas HTTP/SQS quando esses adaptadores existirem. O PostgreSQL já limita uma reversão por tipo e valida o contexto de referências resolvidas; resolução atômica de referências pendentes e proteção contra corridas continuam dependentes das consultas, casos de uso e estratégia transacional.

### D-012 — Ledger imutável com aritmética verificável

- **Status:** confirmada para a entidade de domínio; unicidade e imutabilidade no PostgreSQL continuam abertas.
- **Requisito protegido:** cada lançamento precisa provar `balanceBefore ± money === balanceAfter`, usar uma única moeda e nunca representar saldo negativo.
- **Alternativas consideradas:** confiar apenas no caso de uso foi rejeitado porque permitiria construir lançamentos inconsistentes; impedir a reidratação de dados divergentes foi rejeitado porque ocultaria corrupção que a reconciliação precisa detectar.
- **Trade-off:** `create` valida todas as invariantes e falha imediatamente; `rehydrate` reconstrói exatamente o estado persistido, enquanto `isBalanced()` retorna `false` para aritmética, moeda, sinal ou direção inconsistentes. Assim, leitura e reconciliação conseguem tornar divergências visíveis sem normalizá-las silenciosamente.
- **Escolha:** `WalletLedgerEntry` não possui setters nem métodos de transição, congela a instância e protege o timestamp com cópias defensivas. Débitos subtraem o valor do saldo anterior; créditos somam; o valor precisa ser positivo e os dois saldos precisam ser não negativos.
- **Evidência:** testes unitários cobrem crédito, débito até zero, valores além do limite seguro do JavaScript, identidade, timestamp, moedas divergentes, valores não positivos, saldos negativos, aritmética incorreta, direção desconhecida, imutabilidade e reidratação de dados inconsistentes.
- **Limitação e gatilho de revisão:** a constraint única `(walletId, transactionId)`, as foreign keys e triggers agora impedem ledger duplicado, contexto incompatível, ledger para `LOSS` ou transação não processada e qualquer `UPDATE`/`DELETE`. A atomicidade entre alteração da wallet, transação e criação do ledger ainda pertence ao caso de uso e ao Unit of Work.

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

- **Status:** confirmada para desenho, descoberta, DDL, constraints, índices de consulta e round-trip automatizado em PostgreSQL real.
- **Requisito protegido:** o domínio deve permanecer independente do ORM, dinheiro não pode passar por `number` e runtime, CLI e migrations precisam descobrir o mesmo conjunto de modelos.
- **Alternativas consideradas:** decorators do MikroORM nas entidades de domínio foram rejeitados por inverter a direção de dependência; `autoLoadEntities` isolado foi rejeitado porque só descobre entidades registradas em módulos Nest e não configura a CLI; mapear `Money` como objeto opaco foi rejeitado porque esconderia valor e moeda do schema; enums nativos do PostgreSQL não foram escolhidos porque aumentam o custo de evolução e reversão sem benefício demonstrado neste momento.
- **Escolha:** cinco classes de persistência definidas com `defineEntity` vivem em `infrastructure`: wallet, wager transaction, ledger, inbox e outbox. Um registro único e explícito alimenta tanto o bootstrap do NestJS quanto a configuração da CLI. Relações financeiras usam foreign keys mapeadas para IDs escalares, evitando que referências do ORM atravessem a futura fronteira dos repositórios.
- **Dinheiro e tempo:** valores monetários usam `numeric` com conversão do MikroORM para `string`, nunca `number`; moedas ocupam `char(3)` separado; timestamps usam `timestamptz`. Precisão máxima e autoridade de timestamps não foram inventadas. Constraints agora rejeitam frações além de duas casas sem arredondamento silencioso, códigos de moeda inválidos, valores e saldos incompatíveis.
- **Estado recuperável:** a transação persiste o saldo original do resultado idempotente e o agendamento de referências pendentes; inbox usa identidade composta `(consumerName, messageId)`; outbox conserva o envelope em `jsonb`, tentativas e datas de agendamento/publicação.
- **IDs:** chaves internas e `playerId` são armazenados como UUID, coerentes com os contratos do desafio; a decisão de onde e como gerar esses UUIDs continua aberta.
- **Evidência:** testes inicializam a descoberta de metadados sem conexão e verificam as cinco tabelas, tipos monetários em string, moedas, enums, relações, identidade da inbox e estado recuperável da outbox/transação. A suíte de integração persiste e reidrata os cinco modelos por seus repositórios em PostgreSQL real, incluindo `9007199254740993.12 BRL`, sem conversão para `number` nem perda de precisão. Type-check e build validam o mesmo registro usado pela aplicação.
- **Limitação e gatilho de revisão:** a representação `numeric` sem precisão máxima preserva os valores exigidos sem arredondamento silencioso, mas limites operacionais de tamanho de payload e valor ainda poderão ser definidos por contrato quando houver evidência de negócio.

### D-015 — Invariantes persistentes usam constraints antes de triggers

- **Status:** confirmada para as invariantes expressas pelo schema atual; atomicidade da abertura, idempotência persistente e concorrência por wallet também possuem provas próprias, enquanto a composição das operações externas permanece aberta.
- **Requisito protegido:** unicidade, não-negatividade, precisão monetária, coerência de estados, contexto financeiro e imutabilidade não podem depender apenas da aplicação.
- **Alternativas consideradas:** validação somente no domínio foi rejeitada porque outros writers ou falhas de código poderiam gravar estado inválido; `numeric(p, 2)` foi rejeitado porque exigiria um limite máximo arbitrário e pode arredondar entradas; `CHECK` consultando outras linhas foi rejeitado porque o PostgreSQL não garante esse uso; triggers para todas as regras foram rejeitados por esconder lógica que `UNIQUE`, foreign key ou `CHECK` representam melhor.
- **Escolha para regras locais:** unicidades protegem wallet por jogador/moeda, idempotency key, identidade externa do provider, uma reversão por tipo, um ledger por wallet/transação e inbox composta. Checks protegem valores positivos ou não negativos, no máximo duas casas sem arredondamento, moedas, aritmética do ledger, timestamps, referências, estados terminais, failure codes, payload de outbox e contadores.
- **Escolha para regras relacionais:** foreign keys preservam wallet, transação, ledger e referência resolvida. Triggers são restritos a regras que dependem da operação ou de outra linha: identidade e versão da wallet, terminalidade e contexto da transação, validade da referência, contexto do ledger e rejeição de `UPDATE`/`DELETE` no ledger.
- **Inbox e outbox:** inbox é identificada por `(consumerName, messageId)`. Outbox usa `aggregateId` polimórfico para eventos de wallet ou transação; uma foreign key única não representaria ambos os alvos com integridade real. A ligação será garantida pela mesma transação SQL e testada no Unit of Work, sem inventar uma referência falsa.
- **Trade-off:** triggers oferecem defesa final para invariantes relacionais, mas aumentam a complexidade do schema e exigem que a aplicação traduza SQLSTATEs estáveis. Operações administrativas capazes de desabilitar triggers permanecem fora do papel da aplicação e deverão ser restringidas operacionalmente.
- **Evidência:** PostgreSQL real aceitou um conjunto coerente de wallet, aposta processada, ledger, inbox e outbox; 22 tentativas inválidas da inspeção inicial e uma suíte automatizada representativa confirmaram rejeições pelas constraints ou triggers esperadas. O teste automatizado cobre unicidade de wallet, idempotency key e inbox, saldo não negativo, tentativas de outbox não negativas e bloqueio de `UPDATE`/`DELETE` no ledger. O catálogo confirmou 39 checks/unicidades nomeados e quatro triggers. O rollback removeu os objetos gerenciados, a reaplicação os restaurou e a comparação final não encontrou drift.
- **Limitação e gatilho de revisão:** a igualdade agregada entre saldo materializado e soma do ledger não é uma constraint de uma única linha. Ela será garantida pelo limite transacional dos casos de uso e comprovada novamente por testes de concorrência e reconciliação.

### D-016 — Índices seguem acessos demonstrados e evitam duplicar unicidades

- **Status:** confirmada para os três padrões de acesso conhecidos nesta fase.
- **Requisito protegido:** paginação estável do ledger, recuperação de referências pendentes e publicação da outbox precisam localizar o próximo lote sem ordenar ou percorrer todo o conjunto elegível.
- **Alternativas consideradas:** criar índices para todas as colunas consultáveis foi rejeitado como otimização especulativa; índices adicionais para identidade da wallet, idempotency key, identidade externa do provider e identidade da inbox foram rejeitados porque as respectivas constraints únicas ou chave primária já fornecem índices; índices completos para workers foram rejeitados porque incluiriam linhas terminais que nunca voltam à fila de trabalho; `INCLUDE` e índices de cobertura mais largos foram adiados por não haver leitura implementada que justifique o custo adicional.
- **Escolha para ledger:** o B-tree `(wallet_id, created_at, id)` atende a consulta por wallet e ao cursor composto determinístico. A mesma estrutura pode ser percorrida em ordem inversa para `ORDER BY created_at DESC, id DESC`, enquanto `id` desempata timestamps iguais.
- **Escolha para referências pendentes:** o índice parcial `(next_reference_attempt_at ASC NULLS FIRST, id ASC) WHERE status = 'PENDING_REFERENCE'` mantém somente trabalho recuperável e entrega a ordem estável de seleção do lote.
- **Escolha para outbox:** o índice parcial `(next_attempt_at ASC NULLS FIRST, occurred_at ASC, id ASC) WHERE published_at IS NULL` mantém somente mensagens ainda não publicadas, prioriza o agendamento e usa ocorrência e ID como desempates determinísticos.
- **Trade-off:** os três índices consomem armazenamento e ampliam o custo de escrita. Os índices parciais reduzem esse custo ao excluir estados concluídos, mas exigem que as consultas mantenham predicados compatíveis com seus filtros. O instante limite continua como filtro porque registros sem agendamento e registros já vencidos compartilham a mesma fila ordenada.
- **Evidência:** em PostgreSQL real, após `ANALYZE`, uma base com 5.000 lançamentos de ledger, 10.000 transações e 10.000 mensagens de outbox fez o planner escolher naturalmente os três índices, sem desabilitar sequential scan: `Index Scan Backward` no ledger e `Index Only Scan` nos dois workers. Testes de metadados verificam o conjunto exato e os predicados parciais. A migration removeu os três índices no `down`, restaurou-os no `up` e a comparação final não encontrou drift.
- **Limitação e gatilho de revisão:** planos dependem de distribuição, cardinalidade, estatísticas e consultas reais. Os repositórios deverão preservar os predicados e a ordenação comprovados; métricas de produção ou novos padrões de acesso podem justificar revisão, remoção ou novos índices com nova evidência de `EXPLAIN (ANALYZE, BUFFERS)`.

### D-017 — Repositórios são portas puras e o Unit of Work controla a transação

- **Status:** confirmada para contratos, mappers, adapters MikroORM e semântica real de commit e rollback no PostgreSQL.
- **Requisito protegido:** wallet, transação de aposta, ledger, inbox e outbox precisam compartilhar uma única transação SQL sem expor MikroORM ao domínio ou permitir que cada repositório confirme seus efeitos isoladamente.
- **Alternativas consideradas:** injetar repositórios do MikroORM diretamente nos casos de uso foi rejeitado porque vazaria tipos e ciclo de vida do ORM para a aplicação; permitir `flush` ou `transactional()` em cada repositório foi rejeitado porque poderia confirmar efeitos parciais; um repositório genérico foi rejeitado porque esconderia identidades, consultas e regras diferentes, especialmente a natureza append-only do ledger; decorators nas entidades de domínio continuam rejeitados pela direção de dependência.
- **Escolha para as portas:** a aplicação define contratos específicos para wallet, wager transaction, ledger, inbox e outbox. O ledger expõe somente leitura por identidade financeira e inclusão, sem `save` ou `delete`. O repositório de transações devolve um `WagerTransactionRecord` que conserva a entidade de domínio, o saldo original do resultado, tentativas de referência e próximo agendamento, evitando perder dados necessários para replay e recuperação.
- **Escolha para os mappers:** cada modelo possui conversão explícita entre persistência e domínio. Valores `numeric` permanecem strings e são normalizados para duas casas antes de criar `Money`; valores maiores que o limite seguro do JavaScript não passam por `number`. Campos opcionais são convertidos conscientemente entre `null` do banco e `undefined` do domínio, e payloads de outbox voltam a passar pela cópia imutável do modelo.
- **Escolha para o Unit of Work:** `MikroOrmUnitOfWork.execute()` abre `EntityManager.transactional()` e cria todos os repositórios com o mesmo `EntityManager` transacional. Os adapters apenas registram inclusões ou atribuem estado mutável; nenhum chama `flush`, inicia transação própria ou publica evento. O provider é exportado por token de aplicação, não pela classe concreta do ORM.
- **Atualizações:** `add` é explícito e `save` exige que o registro já exista, falhando em vez de transformar silenciosamente uma atualização em inserção. Wallet, wager transaction, inbox e outbox atualizam somente seus campos mutáveis; identidade e payload imutáveis não são reassinados. Ledger permanece sem caminho de atualização ou exclusão.
- **Trade-off:** todo caso de uso persistente precisa entrar pelo callback do Unit of Work e construir o registro operacional completo da transação de aposta. Essa disciplina acrescenta tipos e mappers, mas deixa o limite transacional visível e testável. O repositório de wallet agora expõe uma leitura explicitamente bloqueante para o processador financeiro; consultas de worker e a tradução pública dos demais erros SQL continuam fora desses contratos até suas decisões próprias. A paginação do ledger foi adicionada por um contrato específico de leitura, sem ampliar a superfície mutável do repositório append-only.
- **Evidência:** testes unitários exercitam round-trip exato dos cinco modelos, saldo original e estado de referência; verificam identidades de consulta, inclusão sem flush, atualização restrita, ausência de update no ledger, falha explícita de `save` inexistente, compartilhamento do mesmo `EntityManager` e propagação de erro. No PostgreSQL real, a Unit of Work confirmou atomicamente wallet, `OPENING`, ledger, inbox e outbox; outra execução enviou primeiro o `INSERT` da wallet, falhou depois na constraint da transação dependente e o `ROLLBACK` removeu ambos os efeitos. Type-check e build validam a composição do provider no NestJS.
- **Limitação e gatilho de revisão:** o limite técnico está comprovado, mas cada caso de uso financeiro ainda precisa demonstrar que inclui todos os efeitos exigidos e que sua estratégia de concorrência preserva o mesmo limite sob disputa real.

### D-018 — Integração PostgreSQL usa um banco temporário isolado por execução

- **Status:** confirmada para os testes de schema e persistência.
- **Requisito protegido:** migrations, constraints, repositórios e rollback precisam ser comprovados em PostgreSQL real sem depender do estado do banco de desenvolvimento nem destruir dados preexistentes.
- **Alternativas consideradas:** mocks ou banco em memória foram rejeitados porque não reproduzem `numeric`, SQLSTATE, constraints, triggers e transações do PostgreSQL; limpar o banco padrão foi rejeitado por risco de perda de dados e interferência entre execuções; schema temporário foi considerado, mas um banco dedicado representa melhor o ciclo de instalação desde zero e evita vazamento de `search_path`; Testcontainers foi adiado porque o Docker Compose obrigatório já fornece a infraestrutura e outra dependência não acrescentaria uma garantia nova nesta fase.
- **Escolha:** `test:integration:postgres` conecta ao PostgreSQL do Compose, cria um banco com prefixo validado `backend_challenge_it_`, aplica a lista explícita de migrations e remove exclusivamente esse banco no `afterAll`, inclusive após falha. O nome aleatório permite execuções independentes e o descarte encerra conexões remanescentes antes do `DROP DATABASE`.
- **Trade-off:** o teste exige PostgreSQL acessível e permissão `CREATEDB`, por isso permanece em script dedicado e é ignorado pela suíte unitária quando a flag explícita não está presente. Em troca, a prova é fiel ao driver e mantém `bun run test` rápido e utilizável sem infraestrutura.
- **Evidência:** nove testes reais aplicam quatro migrations em banco limpo, persistem e reidratam os cinco modelos, exercitam a abertura completa de wallet, consultam wallet e ledger paginado, reconciliam wallet vazia e estados consistentes e divergentes, verificam constraints e imutabilidade, observam `BEGIN`, inserts, `ROLLBACK`, ausência dos efeitos revertidos, executam todos os `down`, confirmam zero tabelas da aplicação e reaplicam o schema completo. A consulta administrativa após a suíte confirma que nenhum banco temporário permanece.

### D-019 — Abertura de wallet é uma operação financeira atômica

- **Status:** confirmada para criação de wallet, `OPENING`, ledger de abertura e registro do evento na outbox.
- **Requisito protegido:** saldo inicial positivo precisa ser auditável e manter `wallet.balance == saldo reconstruído pelo ledger`; nenhum efeito parcial pode sobreviver a uma falha, e `OPENING` nunca pode depender de entrada HTTP ou SQS.
- **Alternativas consideradas:** gravar apenas o saldo inicial foi rejeitado porque quebraria a reconstrução pelo ledger; criar a wallet com zero e aplicar um crédito posterior foi rejeitado porque abriria uma janela e duas transações SQL sem benefício; publicar o evento diretamente foi rejeitado porque poderia ocorrer antes do commit; gerar `OPENING` também para saldo zero foi rejeitado porque uma operação sem alteração de saldo não pode inventar ledger.
- **Escolha:** `CreateWalletUseCase` valida o comando, verifica a identidade `(playerId, currency)` dentro da Unit of Work e cria a wallet com versão `1`. Se o saldo for positivo, a mesma transação SQL inclui uma `WagerTransaction` interna já `PROCESSED`, um ledger `CREDIT` de zero até o saldo inicial e um `WalletBalanceChanged` persistido como outbox. Saldo zero persiste apenas a wallet. O identificador interno `opening:<walletId>` fornece identidade determinística para `externalTransactionId`, `idempotencyKey`, `roundId` e o marcador de payload da operação sintética; ele não decide o algoritmo de hash das submissões externas da Fase 5.
- **IDs e tempo:** IDs internos são UUID v4 gerados na aplicação pela porta `IdGenerator`, usando `crypto.randomUUID()` sem nova dependência. Um único instante vindo da porta `Clock` alimenta wallet, transação, ledger e evento, evitando divergência dentro da operação. Chaves primárias e unicidades do PostgreSQL permanecem a defesa final contra colisões e duplicidade.
- **Trade-off:** o pré-check permite erro de aplicação legível para duplicidade já existente, mas duas criações simultâneas ainda disputam a constraint única; a tradução dessa violação concorrente para conflito HTTP será fechada junto ao mapeamento de erros da API. UUID v4 não oferece localidade temporal, porém os cursores usam `(createdAt, id)` e não dependem de ID ordenável. O relógio da aplicação exige sincronização operacional entre instâncias; nenhuma invariante financeira depende da ordem física desses timestamps.
- **Evidência:** testes unitários comprovam saldo positivo, saldo zero, identidade duplicada, correlação obrigatória e geração UUID v4. Em PostgreSQL real, o caso de uso persiste e reidrata wallet, `OPENING`, ledger e outbox, e uma consulta reconcilia saldo materializado com o ledger. Um segundo cenário deixa inserts chegarem ao banco, força falha no UUID da `OPENING`, observa `ROLLBACK` e confirma ausência de wallet e outbox.
- **Limitação e gatilho de revisão:** ainda não existem controller HTTP ou tradução da corrida de unicidade. As operações de consulta e reconciliação existem na aplicação, mas só serão expostas publicamente quando os contratos e o mapeamento HTTP forem implementados.

### D-020 — Consultas retornam snapshots estáveis e o ledger usa cursor composto

- **Status:** confirmada para os casos de uso, adapter MikroORM, codificação e contrato HTTP.
- **Requisito protegido:** a consulta de wallet precisa devolver o estado materializado sem expor entidades internas, e o histórico do ledger precisa manter ordem determinística e continuidade sem duplicar ou saltar entradas quando timestamps empatam ou novas entradas são inseridas entre páginas.
- **Alternativas consideradas:** paginação por offset foi rejeitada porque inserções concorrentes deslocam as páginas; cursor apenas por timestamp foi rejeitado porque não ordena empates; cursor apenas por UUID foi rejeitado porque não representa a cronologia; uma consulta de contagem separada foi rejeitada por custo e por abrir outra janela de inconsistência; assinatura ou criptografia do cursor foi adiada porque o requisito atual exige opacidade e validação, não confidencialidade ou proteção criptográfica contra alteração.
- **Escolha:** `GetWalletUseCase` e `GetWalletLedgerUseCase` retornam DTOs imutáveis com valores monetários em strings decimais e timestamps ISO. O ledger usa keyset pagination em ordem decrescente por `(createdAt, id)`, aplica o predicado estrito anterior ao cursor e solicita `limit + 1` para detectar a próxima página. O cursor contém versão, timestamp e ID em JSON canônico codificado como Base64URL sem padding; formatos não canônicos, versões desconhecidas, timestamps inválidos e estruturas extras são rejeitados com código estável.
- **Trade-off:** Base64URL impede que o contrato dependa de campos visíveis, mas não é criptografia nem assinatura. Alterações malformadas são rejeitadas, enquanto um cliente pode construir outro cursor estruturalmente válido; isso não concede escrita nem acesso a outra wallet porque `walletId` permanece parâmetro independente da consulta. O valor padrão e máximo HTTP são `50`, usando diretamente o tamanho de página publicado pelo README em vez de criar outro limite operacional sem evidência. A aplicação continua aceitando um limite positivo em sua porta independente de transporte; a borda HTTP restringe o custo público.
- **Evidência:** testes unitários cobrem wallet existente e ausente, DTOs imutáveis, limite padrão, limites inválidos, `limit + 1`, página final, codec determinístico e rejeição de cursores malformados. O teste com PostgreSQL real cria entradas com o mesmo timestamp, confirma desempate por ID, insere uma entrada mais nova entre páginas e demonstra que a continuação pelo cursor não deriva nem repete resultados; uma consulta nova observa a inserção imediatamente.
- **Limitação e gatilho de revisão:** UUIDs, limite, serialização e erro de cursor são validados pelo adapter HTTP. Assinatura do cursor só será adicionada se surgir requisito de integridade contra manipulação ou se o cursor passar a carregar informação sensível; ampliar o limite de `50` exige medição de latência e tamanho de resposta.

### D-021 — Reconciliação usa um snapshot SQL e nunca corrige estado

- **Status:** confirmada para o caso de uso, leitura PostgreSQL, endpoint, log estruturado e métrica de divergência.
- **Requisito protegido:** `wallet.balance` deve ser comparado ao saldo reconstruído pelo ledger imutável, divergências precisam ser explícitas e nenhuma reconciliação pode alterar silenciosamente wallet ou ledger.
- **Alternativas consideradas:** carregar todas as entradas e somar na aplicação foi rejeitado por consumo de memória e transferência proporcionais ao histórico; ler a wallet e agregar o ledger em comandos separados foi rejeitado porque o isolamento padrão `READ COMMITTED` poderia usar snapshots diferentes durante um commit concorrente e produzir falso positivo; usar o último `balanceAfter` foi rejeitado porque dependeria da cadeia materializada em vez de reconstruir o saldo a partir de todos os movimentos; corrigir a wallet automaticamente foi rejeitado pelo requisito de auditabilidade.
- **Escolha:** um repositório de leitura específico executa um único `SELECT` que parte da wallet, agrega créditos como valores positivos e débitos como negativos, contabiliza as entradas e preserva os decimais como strings. O caso de uso calcula `difference = storedBalance - calculatedBalance` com `Money`, sinaliza igualdade em `consistent` e retorna DTO profundamente imutável. Wallet sem ledger reconcilia contra zero; wallet inexistente gera `WALLET_NOT_FOUND`.
- **Trade-off:** a agregação percorre todo o ledger da wallet e seu custo cresce com o histórico, mas fornece a prova integral exigida sem materialização adicional sujeita a drift. A contagem sai do PostgreSQL como inteiro decimal e só vira `number` após validação de representação segura, pois o contrato HTTP exige quantidade numérica; dinheiro nunca passa por essa conversão. A consulta é observacional e não abre caminho de escrita no repositório.
- **Evidência:** testes unitários cobrem saldo consistente acima do limite seguro do JavaScript, diferença negativa, wallet vazia, ausência da wallet, DTOs congelados, SQL agregado único e rejeição de contagem inexata. No PostgreSQL real, quatro créditos produzem saldo calculado `40.00`; após uma alteração intencional do saldo materializado para `41.00`, a resposta informa diferença `1.00`, `consistent: false` e quatro entradas, nenhuma instrução de correção é emitida e a wallet permanece em `41.00`.
- **Limitação e gatilho de revisão:** o endpoint registra divergência como warning estruturado e incrementa o contador correspondente. A integração permanece na borda sem conceder ao caso de uso capacidade de corrigir dados; volumes que tornem a agregação integral lenta exigirão medição antes de qualquer resumo materializado ou estratégia incremental.

### D-022 — HTTP e SQS compartilham uma única entrada de wagering

- **Status:** confirmada e ligada ao bootstrap por um único `ProcessWagerTransactionUseCase`; controllers HTTP e consumer SQS ainda serão adapters dessa mesma entrada.
- **Requisito protegido:** submissões HTTP e mensagens SQS devem alcançar exatamente o mesmo fluxo de negócio, bloquear `OPENING` externo e produzir a mesma semântica sem duplicar validação ou regras em adapters de transporte.
- **Alternativas consideradas:** criar handlers financeiros separados para HTTP e SQS foi rejeitado porque permitiria divergência de regras, idempotência e respostas; transportar DTOs ou decorators do NestJS para a aplicação foi rejeitado por acoplamento; acessar repositórios diretamente nos adapters foi rejeitado porque permitiria contornar o limite transacional e as futuras garantias de concorrência.
- **Escolha:** `ProcessWagerTransactionUseCase` recebe somente dados de negócio, `Idempotency-Key` e correlação, sem campos de HTTP, SQS, NestJS ou AWS. A fronteira valida identidades obrigatórias, tipos externos permitidos, formato das referências e `Money`, normaliza o decimal e entrega um comando profundamente imutável a `WagerTransactionProcessor`. A resposta comum contém identidade interna, status, saldo opcional, falha opcional e `idempotentReplay`; o use case copia e congela o resultado antes de devolvê-lo ao adapter.
- **Trade-off:** a porta do processador mantém a entrada única testável e agora delega ao executor completo descrito em D-026. `messageId` e identidade da inbox ficam no consumidor da Fase 7 e não contaminam o comando financeiro compartilhado; os adapters ainda precisam mapear seus contratos e erros sem duplicar regras.
- **Evidência:** testes unitários confirmam normalização monetária exata, imutabilidade do comando e da resposta, delegação única, bloqueio de `OPENING` e tipos desconhecidos, identidades vazias, referências obrigatórias/proibidas, `WIN` opcionalmente referenciado, valores inválidos e quantias não positivas. Todos os caminhos inválidos falham antes de invocar o processador.
- **Limitação e gatilho de revisão:** a entrada comum, o hash, a idempotência e as regras financeiras já possuem implementação real e provas PostgreSQL. Os adapters HTTP e SQS ainda não existem; quando forem adicionados, deverão resolver esta mesma dependência exportada pelo módulo de wagering, sem criar handlers financeiros paralelos.

### D-023 — Payload financeiro usa JSON canônico e SHA-256

- **Status:** confirmada para o payload das submissões externas.
- **Requisito protegido:** uma mesma idempotency key precisa distinguir replay idêntico de conflito por conteúdo, independentemente da ordem de propriedades recebida pelo transporte, sem incluir o próprio header ou metadados operacionais no hash.
- **Alternativas consideradas:** comparar o JSON bruto foi rejeitado porque ordem de chaves e espaços não alteram o negócio; persistir e comparar cada campo foi rejeitado por duplicar a regra e dificultar sua evolução; hashes não criptográficos foram rejeitados pela margem menor contra colisões; SHA-512 duplicaria o armazenamento do digest sem benefício prático para igualdade de payload neste contexto; BLAKE3 exigiria uma dependência adicional e teria interoperabilidade menor com ferramentas usuais.
- **Escolha:** a aplicação projeta, depois da validação e normalização, exatamente `providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money.amount`, `money.currency` e, quando presente, `referenceExternalTransactionId`. `idempotencyKey` e `correlationId` não entram por serem respectivamente identidade do replay e metadado de rastreamento. A serialização é JSON compacto, sem espaços, com chaves ordenadas lexicograficamente em todos os níveis e ordem de arrays preservada. O adapter calcula SHA-256 sobre os bytes UTF-8 e devolve 64 caracteres hexadecimais minúsculos.
- **Trade-off:** a projeção explícita exige revisão versionada quando um novo campo passar a alterar o significado financeiro; em troca, alterações em headers, correlação ou envelope de transporte não criam conflitos falsos. Não é adotada normalização Unicode, pois identificadores são comparados exatamente como validados. A função genérica rejeita ciclos, arrays esparsos, números não finitos, chaves `symbol` e objetos não planos para impedir serializações silenciosamente ambíguas.
- **Evidência:** testes demonstram ordenação recursiva, independência da ordem de inserção, rejeição de estruturas ambíguas, vetor oficial de SHA-256 para `abc`, exclusão de idempotency key e correlação, estabilidade quando apenas esses metadados mudam e alteração do hash para cada campo de negócio. O teste do caso de uso prova que `Money` é normalizado antes da canonicalização e que o processador recebe o hash derivado junto ao comando imutável.
- **Limitação e gatilho de revisão:** o hash já é comparado e persistido pelo processador idempotente definido em D-024. Qualquer mudança futura no subconjunto, na serialização ou no algoritmo precisará de estratégia explícita de versão para não reinterpretar registros existentes.

### D-024 — Idempotência financeira é coordenada pela constraint persistente

- **Status:** confirmada para submissões de wagering; a adaptação do header HTTP e a inbox SQS permanecem em suas fases de transporte.
- **Requisito protegido:** uma mesma chave e payload devem devolver o resultado original sem repetir transação nem efeitos, enquanto a mesma chave com payload divergente deve ser conflito, inclusive quando várias instâncias submetem a operação simultaneamente.
- **Alternativas consideradas:** cache ou mutex em memória foram rejeitados por não coordenarem processos distintos nem sobreviverem a reinícios; um pré-check sem constraint foi rejeitado por sofrer race entre leitura e escrita; confiar apenas na deduplicação do broker foi rejeitado porque HTTP não passa pelo SQS e redelivery continua possível; reservar e confirmar a chave em uma transação separada foi rejeitado porque permitiria uma reserva órfã ou exigiria recuperação adicional; `INSERT ... ON CONFLICT` antecipado dentro da mesma transação continua uma possível otimização, mas não elimina a necessidade de recuperar o resultado vencedor e complicaria a integração com a entidade e o Unit of Work sem evidência de gargalo.
- **Escolha:** `PersistentWagerTransactionProcessor` abre uma única Unit of Work, procura a chave persistida e resolve replay ou conflito pelo `payloadHash`. Para uma chave nova, o executor produz a transação e os efeitos no mesmo limite SQL; o processador valida que a identidade retornada corresponde ao comando e adiciona a `WagerTransaction` com seu status, falha e saldo de resultado. A unicidade global de `idempotency_key` no PostgreSQL decide corridas. O perdedor captura somente a violação da constraint `wager_transactions_idempotency_key_unique`, inicia uma nova Unit of Work, lê o vencedor já confirmado e então devolve replay ou conflito. Nenhum loop, quantidade arbitrária de retries ou cache participa da garantia.
- **Resultado estável:** replays são reconstruídos da transação persistida e devolvem o mesmo `transactionId`, `status`, `failureCode` e `resultBalance` observado no processamento original; apenas `idempotentReplay` muda para `true`. Correlação não participa do hash e pode mudar entre tentativas sem alterar o resultado financeiro.
- **Trade-off:** requisições que realmente empatam podem executar trabalho antes de uma delas perder a constraint no flush, mas todos os efeitos da perdedora são revertidos na mesma transação. Isso favorece um desenho simples e comprovável; uma reserva antecipada poderá reduzir trabalho desperdiçado caso medições revelem uma hot key, desde que permaneça atômica e preserve a recuperação do resultado. A leitura de recuperação acontece uma única vez porque a violação única já prova que outro commit venceu; ausência do registro faz o erro original reaparecer em vez de mascarar uma inconsistência.
- **Evidência:** testes unitários cobrem criação, replay de resultado processado ou rejeitado, conflito sequencial e concorrente, recuperação do vencedor, falhas não relacionadas, vencedor ausente e executor inconsistente. O classificador reconhece somente a constraint de idempotência. Em PostgreSQL real, uma barreira força ao menos três execuções concorrentes entre 50 submissões idênticas: exatamente uma resposta é original, 49 são replays com o mesmo ID e saldo, e o banco contém uma transação e um efeito outbox. Uma nova correlação reproduz o resultado e um valor monetário divergente gera `IDEMPOTENCY_CONFLICT` sem novo efeito.
- **Limitação e gatilho de revisão:** as regras financeiras e seus efeitos atômicos foram concluídos em D-026, mas a deduplicação da inbox SQS permanece fora deste bloco. A constraint separada de `(providerId, externalTransactionId)` também permanece ativa; seu mapeamento para o contrato público será definido com a taxonomia HTTP sem confundi-la com conflito da mesma idempotency key.

### D-025 — Operações de saldo usam lock pessimista por linha de wallet

- **Status:** confirmada para a fronteira transacional do processamento financeiro.
- **Requisito protegido:** operações concorrentes sobre a mesma wallet não podem ler o mesmo saldo e confirmar lost update, saldo negativo ou ledger incompatível, enquanto wallets distintas e três ou mais instâncias devem continuar independentes.
- **Alternativas consideradas:** versionamento otimista foi rejeitado neste momento porque exigiria update condicionado, classificação de conflito, quantidade de retries e backoff ainda sem evidência, além de repetir todo o trabalho em hot wallets; `UPDATE` atômico com predicado e `RETURNING` é eficiente para um saldo isolado, mas complica a obtenção coerente de saldos anterior/posterior, referências, ledger e eventos; advisory locks foram rejeitados por dependerem de uma chave derivada, poderem colidir e não protegerem diretamente a linha que contém a invariante; lock global foi rejeitado por eliminar paralelismo entre wallets.
- **Escolha:** `WalletRepository.findByIdForUpdate` emite `SELECT ... FOR UPDATE` por meio de `LockMode.PESSIMISTIC_WRITE`, sempre dentro da mesma Unit of Work que persistirá transação, wallet, ledger e outbox. Depois do pré-check idempotente, `PersistentWagerTransactionProcessor` bloqueia exatamente a wallet do comando antes de chamar qualquer executor que altere saldo (`BET`, `WIN`, `REFUND` ou `ROLLBACK`) e entrega a instância bloqueada ao executor. `LOSS` usa leitura normal porque não altera saldo, não cria ledger e não incrementa versão. Replays persistidos retornam antes de qualquer leitura ou lock da wallet.
- **Ordem e retry:** cada operação externa bloqueia no máximo uma wallet e a adquire antes de resolver ou persistir seus efeitos, evitando ciclos de aquisição dentro deste fluxo. Não existe retry de lock na aplicação: o limite é zero tentativas adicionais, portanto deadlock, indisponibilidade ou timeout do PostgreSQL permanecem falhas transitórias para a borda classificar e observar. Um timeout numérico não foi inventado neste bloco; ele deverá derivar do orçamento real do request/consumer quando esses adapters existirem.
- **Trade-off:** operações da mesma hot wallet formam fila e mantêm uma conexão e transação abertas enquanto aguardam, mas não desperdiçam reexecuções otimistas nem dependem de uma única instância. Wallets diferentes conservam paralelismo por usarem linhas distintas. Leitura normal de `LOSS` observa um saldo confirmado válido no instante da consulta, mas não ordena a operação sem efeito em relação a uma alteração concorrente; o saldo observado fica persistido para replay.
- **Evidência:** testes unitários confirmam `LockMode.PESSIMISTIC_WRITE`, lock antes do executor para operações de saldo, ausência de lock para `LOSS`, ausência de leitura em replay e falha antes do executor quando a wallet não existe. Em PostgreSQL real, três instâncias independentes com pools separados entram na seção crítica da mesma wallet com concorrência máxima igual a `1`; duas wallets diferentes entram simultaneamente com concorrência máxima igual a `2`; o log SQL confirma pelo menos cinco consultas `FOR UPDATE`.
- **Limitação e gatilho de revisão:** D-026 acrescenta a prova financeira real sobre este mecanismo, inclusive a disputa obrigatória de duas apostas de `80.00` contra `100.00`. Métricas de espera, timeout operacional e eventual otimização continuam dependentes de dados observáveis da API e dos consumers.

### D-026 — Um executor financeiro produz todos os efeitos atômicos

- **Status:** confirmada para `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`, incluindo rejeições e referência ainda ausente.
- **Requisito protegido:** cada operação precisa aplicar exatamente sua regra de saldo, criar no máximo um ledger, manter `wallet.balance` reconstruível, registrar resultado auditável e gravar os eventos correspondentes na mesma transação SQL, inclusive sob concorrência e falha parcial.
- **Alternativas consideradas:** regras separadas em controllers e consumers foram rejeitadas porque divergiriam entre transportes; atualizar saldo diretamente no repositório foi rejeitado porque contornaria `Wallet`, perderia a descrição exata de `balanceBefore`/`balanceAfter` e duplicaria a aritmética do ledger; publicar eventos depois do retorno do Unit of Work foi rejeitado porque criaria uma janela de perda; tratar referência ausente como erro foi rejeitado pelo requisito de entrega fora de ordem; criar ledger compensatório para rejeições ou `LOSS` foi rejeitado porque inventaria movimento financeiro inexistente.
- **Escolha:** `WagerTransactionExecutor` cria a transação, resolve a referência por `(providerId, referenceExternalTransactionId)`, valida direção e contexto no domínio e executa débito ou crédito somente sobre a wallet já carregada pelo processador. Alterações de saldo salvam a wallet, criam um `WalletLedgerEntry` balanceado e enfileiram `WagerTransactionProcessed` e `WalletBalanceChanged`; `LOSS` enfileira somente o evento processado. Rejeições enfileiram `WagerTransactionRejected`, não salvam wallet nem criam ledger. Uma referência externa ainda inexistente produz `PENDING_REFERENCE` e `WagerTransactionPendingReference`, com zero tentativas e sem efeito financeiro, para o worker futuro assumir.
- **Reversões e códigos:** `REFUND` aceita somente `BET` processada e credita o mesmo valor; `ROLLBACK` aceita `BET`, `WIN` ou `REFUND` processada e aplica a direção inversa. A consulta por `(referenceTransactionId, kind)`, serializada pelo lock da wallet e reforçada pela constraint parcial existente, impede uma segunda reversão do mesmo tipo. Os resultados de negócio usam `INSUFFICIENT_FUNDS`, `INVALID_TRANSACTION_REFERENCE`, `REFERENCE_ALREADY_REVERSED` e `REVERSAL_INSUFFICIENT_FUNDS`; o último é deliberadamente distinto do saldo insuficiente de uma aposta. Referência inválida é agrupada em um código estável porque todos os seus subcasos exigem correção ou abandono do payload, enquanto ausência continua recuperável e portanto não é rejeição.
- **Trade-off:** o executor coordena entidades, repositórios e eventos de forma explícita, o que gera mais código que callbacks genéricos, mas mantém a ordem e as invariantes auditáveis. O resultado persiste o saldo observado também para `LOSS`, rejeição e pendência, permitindo replay estável. `WIN` com referência declarada aguarda uma `BET` ausente como qualquer operação dependente; sem referência, continua válido. O registro rejeitado por reversão duplicada preserva a referência externa, mas não preenche `referenceTransactionId`, que permanece reservado a relações processadas e evita disputar a constraint de reversão.
- **Evidência:** quatorze testes unitários cobrem débito, crédito, ausência de efeito, referência opcional de `WIN`, direções inversas de `ROLLBACK`, contexto/tipo/valor inválidos, referência pendente, reversão duplicada e os dois códigos distintos de saldo insuficiente. No PostgreSQL real, uma sequência com todas as operações termina em `100.00`, versão `5`, cinco ledgers incluindo `OPENING` e reconciliação exata; a outbox contém cinco eventos processados, cinco mudanças de saldo, uma rejeição e uma pendência. Duas instâncias submetendo `BET 80.00` contra saldo `100.00` produzem exatamente uma `PROCESSED`, uma `REJECTED`, saldo `20.00` e dois ledgers incluindo abertura. Uma falha deliberada no UUID da outbox reverte wallet, ledger, transação e outbox juntos.
- **Limitação e gatilho de revisão:** o worker que reprocessará `PENDING_REFERENCE`, sua política de tentativas/TTL e a rejeição terminal por expiração pertencem à Fase 8. As consultas e o contrato estável de leitura foram concluídos em D-027; mapeamentos HTTP e SQS permanecem em suas fases próprias.

### D-027 — Consultas expõem um snapshot público único e imutável

- **Status:** confirmada para busca por ID interno e por `(providerId, externalTransactionId)`; a exposição HTTP pertence à Fase 6.
- **Requisito protegido:** os dois endpoints de consulta devem reconstruir a mesma resposta estável a partir do registro confirmado, preservando estados processado, rejeitado e pendente sem expor detalhes internos ou exigir interpretação de texto livre quando o recurso não existe.
- **Alternativas consideradas:** devolver a entidade de domínio ou o record de persistência foi rejeitado porque vazaria métodos, `idempotencyKey`, `payloadHash` e controle de retry; criar DTOs diferentes para cada identidade de consulta foi rejeitado porque permitiria divergência semântica; reutilizar a resposta mínima da submissão foi rejeitado porque uma consulta precisa identificar provider, rodada, jogo, operação, valor, referências e timestamps; expor `referenceAttempts` e `nextReferenceAttemptAt` foi rejeitado porque são estado operacional do worker, não contrato financeiro do provedor.
- **Escolha:** `GetWagerTransactionByIdUseCase` e `GetProviderWagerTransactionUseCase` usam os acessos já indexados do repositório e passam pelo mesmo serializador. O snapshot contém identidades públicas de transação, wallet e player, contexto de rodada/jogo, `kind`, `status`, `money`, saldo observado, referências, `failureCode` e timestamps ISO-8601 aplicáveis. Campos opcionais ausentes são omitidos, valores monetários e o objeto externo são congelados, e ambos os caminhos usam `WAGER_TRANSACTION_NOT_FOUND` sem incluir a identidade consultada na mensagem.
- **Trade-off:** o snapshot é deliberadamente mais rico que a resposta de submissão, mas continua independente de HTTP e de detalhes do ORM. Omitir hash, chave de idempotência e agenda de retry reduz acoplamento e exposição; ferramentas operacionais futuras poderão ter uma consulta administrativa separada. O GET não carrega `idempotentReplay`, pois leitura não reaplica uma operação e esse indicador só descreve uma submissão deduplicada.
- **Evidência:** cinco testes unitários demonstram igualdade contratual entre as duas identidades, imutabilidade profunda, omissão de campos internos, representação correta de processada, rejeitada e pendente e erro único de ausência. No PostgreSQL real, os dois caminhos reidratam o mesmo `BET` processado, e consultas adicionais preservam o código de uma reversão rejeitada e a ausência de `processedAt` em uma referência pendente.
- **Limitação e gatilho de revisão:** validação sintática, serialização e política uniforme de status foram concluídas na borda HTTP. A autorização do provider continua aberta e será tratada por um ponto de extensão explícito sem alterar o snapshot financeiro.

### D-028 — A API usa status, código e retryability como taxonomia pública

- **Status:** confirmada para todos os endpoints HTTP financeiros e de consulta.
- **Requisito protegido:** o provedor precisa distinguir payload inválido, ausência, conflito, rejeição, pendência, falha transitória e falha permanente sem analisar texto livre nem receber detalhes internos sensíveis.
- **Alternativas consideradas:** responder `200` para todo resultado foi rejeitado porque esconderia rejeição e pendência; lançar `400` para qualquer falha foi rejeitado porque induziria decisões erradas de retry; expor diretamente exceções de domínio, ORM ou framework foi rejeitado por acoplamento e risco de vazamento; usar apenas uma flag no corpo foi rejeitado porque intermediários e clientes HTTP precisam de semântica de status; definir `Retry-After` agora foi rejeitado porque ainda não existe uma política operacional de backoff comprovada.
- **Escolha:** um filtro global transforma falhas em um envelope com `statusCode`, `code`, `message` e `retryable`, preservando `issues` somente para violações de contrato. Contrato inválido usa `400`; recurso ausente, `404`; conflito de recurso ou idempotência, `409`; rejeição financeira persistida, `422`; `PENDING` e `PENDING_REFERENCE`, `202`; indisponibilidade, deadlock, lock timeout e erros de rede transitórios conhecidos, `503` com `retryable: true`; falhas inesperadas ou permanentes, `500` com mensagem genérica e `retryable: false`. Criação de wallet usa `201`, consultas e reconciliação usam `200`.
- **Replay e falha terminal:** uma submissão processada retorna `200` tanto na execução original quanto no replay; uma rejeição retorna `422` nos dois casos; uma pendência retorna `202`. Assim o status semântico original é preservado junto de `idempotentReplay`. Um resultado `FAILED` vira erro estável não retentável, mantendo seu `failureCode` como código público quando disponível.
- **Trade-off:** `422` representa rejeição de regra de negócio mesmo quando o resultado foi persistido com sucesso; isso separa claramente a decisão financeira de uma falha técnica. `503` autoriza retry, mas não informa intervalo até que a política de backoff seja decidida com os consumers. Exceções de domínio inesperadas são tratadas como `500`, pois alcançar a borda depois da validação indica quebra interna e não um payload que o cliente deva tentar corrigir.
- **Evidência:** testes tabelados cobrem todos os erros de aplicação expostos, exceções HTTP, falhas transitórias de banco e rede, ocultação de detalhes inesperados e os cinco estados da transação. Testes de controller confirmam que o header de idempotência continua sendo a fonte única. A aplicação real registra o filtro global e responde com envelopes uniformes sem mudar os casos de uso.
- **Limitação e gatilho de revisão:** o consumer SQS adapta a taxonomia para ack, retry e DLQ sem inventar status HTTP; logs correlacionados e métricas por resultado registram essas decisões. Alertas e metas operacionais dependem do ambiente de produção.

### D-029 — Autenticação externa é adiada atrás de um guard substituível

- **Status:** confirmada para o timebox do desafio; não existe autenticação artesanal.
- **Requisito protegido:** manter um ponto explícito de autenticação/autorização sem desviar esforço das garantias financeiras e sem proteger endpoints de health.
- **Alternativas consideradas:** integrar Keycloak ou Zitadel agora foi adiado porque autenticação não pontua e exigiria provisionamento, ciclo de token e testes operacionais adicionais; criar tabela local de usuários e senhas foi rejeitado explicitamente; deixar controllers sem qualquer fronteira foi rejeitado porque tornaria a integração futura difusa; um guard global foi rejeitado porque poderia capturar health por engano.
- **Escolha:** `DeferredProviderAuthenticationGuard` é aplicado somente aos três controllers financeiros e atualmente permite a requisição sem inspecionar credenciais. Ele é provider do módulo HTTP e constitui o ponto único a ser substituído pela validação de um Identity Provider externo. `HealthController` não possui esse guard.
- **Fluxo futuro:** o guard validará assinatura, issuer, audience e expiração do bearer token usando metadata/JWKS do IdP; extrairá `sub`, escopos e uma claim de provider; comparará a identidade autorizada com `providerId` presente em rota ou payload antes do caso de uso; e anexará uma identidade imutável ao request para autorização e correlação. Endpoints de wallet exigirão uma claim/escopo que autorize a operação sobre o player ou wallet sem criar uma base local de credenciais.
- **SQS:** o consumer é um canal interno autenticado pela infraestrutura AWS, valida estritamente a forma da identidade de provider contida na mensagem e reutiliza as mesmas regras de aplicação. A autorização do provider contra uma identidade confiável continua necessária antes de exposição externa; credenciais de infraestrutura não substituem essa associação.
- **Trade-off:** a API financeira permanece aberta no estado atual, o que é uma limitação consciente e documentada. Em troca, o código deixa claro onde a autenticação entra, health permanece público por construção e nenhuma solução de identidade parcial ou insegura compete com os requisitos obrigatórios.
- **Evidência:** testes de metadata confirmam que todos os controllers financeiros carregam o guard substituível, que o guard adiado permite a execução atual e que `HealthController` não está dentro dessa fronteira.
- **Limitação e gatilho de revisão:** antes de qualquer exposição fora do ambiente controlado, o guard permissivo deverá ser substituído pela integração real do IdP e por testes de token inválido, claim divergente, escopo insuficiente e rotação de chave.

### D-030 — Inbox e efeitos SQS compartilham uma única transação SQL

- **Status:** confirmada para consumo de wagering e redelivery.
- **Requisito protegido:** uma mensagem confirmada não pode perder seu efeito financeiro, e a mesma entrega não pode produzir dois efeitos mesmo se o worker morrer depois do commit e antes do ack.
- **Alternativas consideradas:** confiar na deduplicação FIFO foi rejeitado porque sua janela não representa a vida da operação e não protege reentregas após falhas; persistir a inbox antes ou depois do caso de uso foi rejeitado porque criaria respectivamente perda de efeito ou duplicidade; criar um caso de uso específico para SQS foi rejeitado porque permitiria divergência em relação ao HTTP; deduplicação em memória foi rejeitada por não sobreviver a reinício nem coordenar instâncias.
- **Escolha:** o adapter valida um envelope fechado, exige `MessageGroupId` igual ao `walletId`, usa o `messageId` do corpo como correlação e calcula SHA-256 sobre o JSON canônico completo. O `ProcessWagerTransactionUseCase` recebe esse contexto de entrega e o processador cria ou conclui `(consumerName, messageId)` dentro do mesmo Unit of Work que wallet, ledger, transação e outbox. Redelivery com o mesmo hash recupera o resultado persistido; o mesmo identificador com corpo diferente gera `INBOX_PAYLOAD_CONFLICT`. O consumer executa `DeleteMessage` somente depois que o caso de uso retorna, portanto depois do commit.
- **Concorrência e FIFO:** mensagens do mesmo grupo são executadas sequencialmente dentro do lote, enquanto grupos de wallets diferentes avançam em paralelo. Essa ordenação reduz contenção, mas não é autoridade de consistência: locks por wallet, constraints, idempotência financeira e inbox no PostgreSQL continuam válidos com consumidores e instâncias concorrentes.
- **Trade-off:** o hash do envelope completo faz mudanças em metadados observáveis serem tratadas como conflito, uma escolha conservadora que impede reinterpretar uma identidade já processada. A inbox duplica parte da proteção da chave de idempotência, mas identifica a entrega do broker independentemente da operação do provedor e fecha a janela commit/ack.
- **Evidência:** testes unitários cobrem contrato, grupo FIFO, hash, criação/conclusão da inbox, replay, conflito de payload e recuperação de corrida por unicidade. No PostgreSQL real, a inbox é confirmada com wallet, ledger, transação e duas mensagens de outbox; uma reentrega mantém exatamente uma linha de cada efeito e devolve replay; uma falha de flush reverte também a inbox. No SQS real em container, uma falha simulada do ack força redelivery e a segunda execução é confirmada sem perda.
- **Limitação e gatilho de revisão:** a identidade do provider ainda não é autorizada contra um IdP. A prova local usa MiniStack e não substitui testes operacionais periódicos na AWS real.

### D-031 — Falhas SQS têm destinos finitos e shutdown drena trabalho iniciado

- **Status:** confirmada para o consumer de wagering.
- **Requisito protegido:** falhas transitórias precisam recuperar sem loop imediato ou infinito; mensagens inválidas precisam sair do fluxo principal; shutdown não pode confirmar trabalho incompleto nem abandonar silenciosamente um lote iniciado.
- **Alternativas consideradas:** retry imediato foi rejeitado por amplificar indisponibilidade; retry ilimitado foi rejeitado por bloquear o grupo FIFO; reenviar toda falha manualmente à fila principal foi rejeitado por alterar identidade e ordem; enviar resultados financeiros rejeitados à DLQ foi rejeitado porque rejeição de negócio é um resultado persistido com sucesso; interromper o processo sem aguardar o lote foi rejeitado porque ampliaria a janela de redelivery evitável.
- **Escolha:** resultados processados, rejeitados ou pendentes retornam normalmente e são confirmados. Falhas transitórias conhecidas de conexão, deadlock, lock timeout e rede alteram a visibilidade com backoff exponencial. Falhas permanentes de contrato ou conteúdo são copiadas para a DLQ e só então removidas da fila principal. Ao atingir `SQS_MAX_RECEIVE_COUNT`, a mensagem transitória permanece sem ack para a redrive policy nativa. Em shutdown, o long poll atual é abortado e o consumer aguarda o lote já recebido; se uma operação de broker falhar, a mensagem permanece não confirmada e volta a ficar visível.
- **Limites e justificativa:** a configuração padrão usa visibilidade base de 30 segundos, teto de 300 segundos e cinco recebimentos. Isso produz oportunidades delimitadas de 30, 60, 120 e 240 segundos antes de a quinta falha seguir para redrive, evitando tanto loop apertado quanto espera ilimitada. Os valores são externos e devem ser revistos a partir de p99 de processamento, lock wait e tempo de recuperação observados; o teto nunca pode ser menor que a base.
- **Trade-off:** a cópia explícita de falhas permanentes para a DLQ dá destino imediato e auditável, mas exige que o envio à DLQ seja bem-sucedido antes do ack; uma falha nesse envio deixa a origem para nova tentativa. A redrive nativa de transitórios preserva o receive count do broker, mas o instante exato pode variar entre o emulador e a AWS.
- **Evidência:** testes unitários provam ack posterior ao handler, paralelismo entre grupos, ordem dentro do grupo, backoff, exaustão sem ack, envio à DLQ antes da remoção e validação dos limites. Testes com SQS real em container comprovam redelivery após falha de ack, DLQ imediata para falha permanente e redrive nativa após duas tentativas transitórias em filas isoladas de teste. O script de bootstrap cria fila FIFO, DLQ FIFO e redrive policy reproduzível.
- **Limitação e gatilho de revisão:** logs estruturados e contadores registram retries e transferências confirmadas para DLQ. O esgotamento que aguarda redrive nativo permanece distinguível no log, sem ser contado como transferência antes de ela ocorrer. O shutdown cooperativo não elimina redelivery em `SIGKILL`, perda do host ou expiração de visibilidade; a inbox torna essas reentregas seguras.

### D-032 — Publishers reivindicam a outbox com locks transacionais independentes

- **Status:** confirmada para publicação concorrente e recuperação por retry.
- **Requisito protegido:** nenhum evento confirmado pode ser perdido, publishers concorrentes não podem reivindicar a mesma linha simultaneamente e eventos posteriores do mesmo aggregate não podem ultrapassar um predecessor aguardando retry.
- **Alternativas consideradas:** publicar antes do commit financeiro foi rejeitado porque permitiria eventos sobre efeitos revertidos; polling sem lock foi rejeitado por permitir publicação concorrente da mesma linha; colunas de lease foram consideradas, mas adiadas porque acrescentariam schema, autoridade de tempo e recuperação de leases expirados sem necessidade demonstrada. Locks mantidos durante o envio foram escolhidos por oferecer recuperação automática no rollback com o modelo atual.
- **Escolha:** cada lote abre uma transação PostgreSQL e seleciona somente eventos não publicados e vencidos com `FOR UPDATE SKIP LOCKED`. Apenas o evento pendente mais antigo por `aggregateId` é elegível. Publishers diferentes prosseguem sobre linhas distintas; a fila usa `aggregateId` como `MessageGroupId` e o id do evento como `MessageDeduplicationId`. Sucesso marca `publishedAt` e falha agenda retry exponencial dentro da mesma transação que possui o lock.
- **Recuperação:** morte antes do envio causa rollback e libera a linha para outra instância. Morte depois do envio e antes da marcação pode republicar o evento; essa duplicidade é intencionalmente aceita no modelo at-least-once, e o id estável permite idempotência no consumidor. Falhas continuam sendo tentadas com atraso limitado pelo teto configurado, em vez de descartar um evento financeiro confirmado após um número arbitrário de tentativas.
- **Limites e justificativa:** os defaults são lote de 10, polling a cada 1 segundo e backoff de 5 a 300 segundos. O lote pequeno limita locks e tempo de transação enquanto ainda permite vazão paralela; os valores são externos e devem ser revistos com p99 de publicação, contenção e outbox lag observados.
- **Trade-off:** manter a transação aberta durante a chamada de rede simplifica claim e recuperação, mas ocupa conexão e locks enquanto o SQS responde. Se latência ou volume tornarem isso material, leases explícitos passam a ser a alternativa a medir, preservando ordenação por aggregate e recuperação de crash.
- **Evidência:** duas instâncias independentes de ORM e publisher dividem seis aggregates no PostgreSQL real sem sobreposição; outro teste impede um evento posterior de ultrapassar o predecessor em retry. A integração SQS confirma envelope, grupo e deduplicação, e a aplicação real publica o evento criado por uma wallet somente depois do commit. Testes do worker comprovam drenagem do lote iniciado e interrupção da espera no shutdown.
- **Limitação e gatilho de revisão:** duplicidade ainda é possível na janela envio/marcação e deve ser tolerada por consumidores. Logs estruturados e métricas registram retries, backlog e idade do registro pendente mais antigo; limiares de alerta dependem do SLA de produção. O emulador local não substitui validação periódica na AWS real.

### D-033 — Referências pendentes usam prazo absoluto e claim transacional por item

- **Status:** confirmada para recuperação, expiração e concorrência entre workers.
- **Requisito protegido:** operações entregues antes da referência não podem desaparecer, duplicar efeitos nem aguardar para sempre; sucesso e expiração precisam permanecer auditáveis com wallet e ledger consistentes.
- **Alternativas consideradas:** rejeição imediata foi descartada porque viola o requisito de entrega fora de ordem; espera ilimitada foi descartada porque nunca produz resultado terminal; um total fixo de tentativas foi descartado como limite principal porque muda de significado com backoff, indisponibilidade e reinícios. Um prazo absoluto desde `createdAt` foi escolhido por manter a mesma semântica através de processos e alterações de polling.
- **Escolha:** a primeira ausência persiste `PENDING_REFERENCE`, tentativa `1` e próximo horário. Cada execução seleciona uma única linha vencida com `FOR UPDATE SKIP LOCKED`, bloqueia somente sua wallet e procura novamente a referência dentro da mesma transação. Uma referência processada retoma o executor financeiro original; uma referência ainda não terminal volta ao backoff; uma referência terminal inválida segue as mesmas regras de rejeição do fluxo original. Se a referência continuar indisponível no prazo, a transação termina como `REJECTED/REFERENCE_NOT_FOUND` e cria `WagerTransactionRejected` na outbox.
- **Expiração e limites:** `PENDING_REFERENCE_TTL_SECONDS` é obrigatório, pois o desafio não fornece SLA de liquidação e um default silencioso inventaria uma regra de negócio. `.env.example` usa 24 horas somente como valor local explícito; produção deve substituí-lo pelo SLA acordado com os provedores. O backoff inicia em 30 segundos, dobra até 1 hora e nunca agenda depois do prazo; lote 10 e polling de 1 segundo são externos e revisáveis.
- **Ordem transacional:** a atualização da transação retomada é materializada antes dos inserts dependentes, permitindo que o trigger do ledger veja o estado `PROCESSED`; wallet, transação, ledger e outbox ainda confirmam ou revertem juntos. Uma transação SQL por item evita manter vários locks de wallets no mesmo lote e reduz ciclos de deadlock, enquanto instâncias diferentes processam itens desbloqueados em paralelo.
- **Recuperação:** não existem leases persistentes para expirar. Se um processo morre, o rollback do PostgreSQL libera o claim; outra instância seleciona a mesma linha ainda vencida. O worker drena o item em andamento durante shutdown cooperativo e uma interrupção abrupta deixa a transação novamente elegível.
- **Evidência:** no PostgreSQL real, um `REFUND` chega antes da `BET`, persiste tentativa e agendamento, fica invisível para uma segunda instância enquanto a primeira detém o lock, volta a ficar elegível após rollback simulado e termina processado por outra instância com saldo igual ao ledger. Outro cenário atravessa exatamente o TTL, rejeita com o código estável, publica o evento terminal e não cria ledger. Testes unitários cobrem backoff, teto, prazo, retomada, contadores do lote e shutdown.
- **Trade-off e gatilho de revisão:** uma transação por item custa mais round-trips que um lote transacional único, mas limita contenção e isola falhas. O worker usa o id da transação como correlação estável na retomada porque a correlação original não faz parte do registro financeiro; logs e contador de retry tornam o fluxo observável, enquanto tracing permanece opcional. TTL e backoff devem ser revistos com atraso real dos provedores, taxa de expiração e contenção observada.

### D-034 — Logs operacionais usam JSON, campos permitidos e correlação explícita

- **Status:** confirmada para HTTP, consumo SQS, publicação da outbox, recuperação de referências e reconciliação.
- **Requisito protegido:** operações financeiras precisam ser rastreáveis entre transportes e workers sem registrar payload completo, valores monetários, chaves de idempotência, credenciais ou mensagens internas de erro.
- **Alternativas consideradas:** texto livre foi rejeitado por dificultar consulta e alertas; aceitar objetos arbitrários no logger foi rejeitado porque facilitaria vazamentos acidentais; `AsyncLocalStorage` foi considerado, mas não acrescenta garantia ao fluxo atual, que já transporta correlação explicitamente nos comandos e eventos; registrar corpos HTTP/SQS foi rejeitado porque mistura diagnóstico com dados financeiros e secretos.
- **Escolha:** o bootstrap do NestJS usa o logger JSON nativo sem cores. A porta `OperationalLogger` aceita somente uma allowlist tipada de identificadores, resultado, tentativas, duração e contadores operacionais. Um interceptor global preserva ou gera `x-correlation-id`, disponibiliza o mesmo valor ao controller e o devolve no header da resposta. Mensagens SQS usam `messageId` como correlação; retomadas persistidas usam o id estável da transação. Eventos de retry ou conclusão disparados por casos de uso são registrados somente depois que a Unit of Work confirma a transação SQL.
- **Severidade e falhas:** resultados esperados e conclusões usam `info`; divergências, retries e falhas HTTP 4xx usam `warn`; indisponibilidade operacional, DLQ e HTTP 5xx usam `error`. Logs de exceção registram somente tipo concreto, código público, status e retryability, nunca a mensagem recebida.
- **Evidência:** testes verificam geração e preservação da correlação HTTP, header de resposta, formato estruturado nas três severidades, contexto seguro nos controllers HTTP e no handler SQS, sinais de retry e DLQ, logs de referência pendente e ausência de quantias, payload e idempotency key. A execução real iniciou com cada linha do NestJS em JSON e respondeu liveness com a correlação fornecida e com UUID gerado. As suítes fecharam com 414 testes normais, 20 testes PostgreSQL e 4 testes SQS, além de type-check e build.
- **Trade-off e gatilho de revisão:** correlação explícita mantém dependências visíveis, mas exige que novos adapters a propaguem conscientemente. O contrato fechado reduz risco de vazamento, ao custo de ampliar a interface quando surgir um novo campo operacional legítimo. Tracing distribuído continua opcional; deverá ser reconsiderado se chamadas entre serviços tornarem a correlação por identificador insuficiente. As métricas complementares são definidas em D-035.

### D-035 — Métricas Prometheus usam dimensões finitas e estado real da outbox

- **Status:** confirmada para todas as métricas mínimas do desafio e exposição HTTP pública em `/metrics`.
- **Requisito protegido:** operação precisa revelar status das transações, duplicatas, retries, DLQ, contenção de lock, atraso da outbox, latência, divergência de reconciliação e readiness sem criar séries por entidade financeira.
- **Alternativas consideradas:** métricas artesanais em memória foram rejeitadas porque recriariam incorretamente o formato e os tipos do Prometheus; labels com `walletId`, `transactionId`, `providerId` ou `messageId` foram rejeitadas por cardinalidade não limitada; calcular lag somente a partir dos itens reivindicados pelo worker foi rejeitado porque ocultaria backlog adiado por retry; falhar `/metrics` quando o PostgreSQL estiver indisponível foi rejeitado porque removeria justamente os sinais necessários durante incidente.
- **Escolha:** `prom-client` mantém um registry privado por processo e expõe counters, gauges e histogram. Labels usam apenas conjuntos finitos: origem HTTP/SQS/worker de referência, operação, status e componente. O caso de uso compartilhado registra resultado, replay idempotente e duração; replays incrementam o contador de duplicatas e o histograma, mas não inventam uma nova transição no contador de transações. O worker registra a transição terminal de referências retomadas. Consumers e workers contam retry somente depois de o novo estado ser confirmado, e DLQ somente depois do envio bem-sucedido. Deadlock e timeout de lock são classificados no limite persistente e contabilizados antes da propagação. Reconciliação divergente incrementa contador sem usar a identidade da wallet.
- **Outbox e disponibilidade:** cada scrape executa uma leitura agregada de `count(*)` e `min(occurred_at)` sobre itens ainda não publicados, calcula backlog e lag atual e então renderiza o registry. Se essa coleta falhar, o endpoint ainda responde com as demais séries e incrementa `metrics_collection_failures_total`; não substitui o último gauge por zero falso. Os indicadores de PostgreSQL e SQS atualizam gauges de readiness após a tentativa completa, inclusive timeout ou falha.
- **Evidência:** testes verificam nomes, tipos, valores, buckets, labels permitidas, ausência de identificadores de alta cardinalidade, origem HTTP/SQS, replays, retries dos três componentes, DLQ, conflito de lock, divergência, snapshot da outbox e tolerância a falha do coletor. Em execução real, `/health/ready` confirmou PostgreSQL e SQS e `/metrics` respondeu `200` com content type Prometheus, todas as famílias obrigatórias, readiness `1` para ambos os componentes, backlog real e nenhuma label de identidade. As suítes passam com 423 testes normais, 20 PostgreSQL e 4 SQS, além de type-check e build.
- **Trade-off e gatilho de revisão:** métricas são locais a cada processo; counters e histogramas devem ser agregados pelo backend Prometheus entre instâncias. O scrape adiciona uma consulta indexável ao PostgreSQL para obter estado atual da outbox. Frequência excessiva, volume muito alto ou custo observado exigem cache curto ou coletor dedicado, nunca aproximação silenciosa. Buckets de latência e alertas precisam ser recalibrados com tráfego real; OpenTelemetry e dashboards continuam opcionais.

## 6. Decisões abertas

Nenhuma alternativa desta tabela está escolhida antecipadamente.

| Decisão | Requisito protegido | Alternativas que precisam ser avaliadas | Evidência necessária para fechar |
| --- | --- | --- | --- |
| Limite transacional dos casos de uso | atomicidade de wallet, ledger, transação, inbox e outbox | composição de cada operação financeira dentro do Unit of Work já comprovado | testes de falha antes/depois do commit e concorrência para cada caso de uso |

## 7. Modelo transacional — estado atual

O Unit of Work e os repositórios estabelecem o limite técnico de uma transação SQL compartilhada. Criação de wallet e processamento de apostas comprovam commit e rollback de casos financeiros completos no PostgreSQL real; a disputa obrigatória de saldo também comprova a serialização dos efeitos. A restrição estabelecida é:

```text
wallet + ledger + wager transaction + inbox + outbox
                         ↓
              mesma transação SQL quando
              pertencem à mesma operação
```

Nenhum evento pode ser publicado antes do commit. SQS FIFO não substituirá locks, constraints ou idempotência no PostgreSQL.

## 8. Autenticação — estado atual

Autenticação foi conscientemente adiada e não existe tabela própria de usuários ou senha. O ponto explícito é `DeferredProviderAuthenticationGuard`, aplicado somente aos controllers financeiros; sua implementação permissiva deverá ser substituída por um adapter de Identity Provider antes de exposição externa.

O fluxo futuro, claims e associação com provider estão definidos em D-029. `/health/live` e `/health/ready` permanecem públicos por não carregarem o guard, e a identidade do provider recebida por SQS continuará sujeita à validação do consumer e às regras da aplicação.

## 9. Evidências reproduzíveis disponíveis

Com as variáveis de `.env.example` configuradas:

```bash
bun install --frozen-lockfile
docker compose up -d --wait
bun run typecheck
bun run build
bun run test
bun run test:integration:postgres
bun run test:integration:sqs
bun run migration:pending
bun run migration:up
bun run migration:down
```

O ciclo `up → inspeção → down → inspeção → up` é automatizado em um banco temporário criado por execução. A suíte PostgreSQL comprova round-trip exato dos cinco modelos, commit e rollback incluindo inbox, constraints representativas, imutabilidade do ledger, paginação estável, reconciliação, disputa financeira real, cinquenta submissões concorrentes, dois publishers dividindo a outbox e recuperação de referência após rollback de outro worker. A suíte SQS cria filas temporárias no emulador real e comprova redelivery após falha de ack, DLQ permanente, redrive transitória e publicação da outbox com grupo e deduplicação estáveis. A suíte normal também comprova o runner do Bun, configuração, domínio, contratos, agrupamento concorrente, decisões de retry e todas as famílias de métricas sem substituir essas provas de infraestrutura. Em execução real, `/metrics` consulta o backlog da outbox no PostgreSQL e expõe o formato Prometheus.

## 10. Limitações atuais

- endpoints de wallet, ledger, reconciliação e wagering estão implementados com contratos estritos e taxonomia HTTP estável;
- o consumer SQS, a inbox atômica, o publisher concorrente da outbox e o worker de referências pendentes estão implementados;
- a outbox publica com claim transacional e retry sem descartar eventos; duplicidade continua possível na janela entre envio ao SQS e marcação no PostgreSQL;
- concorrência por wallet, idempotência HTTP e deduplicação SQS estão implementadas; a autorização da identidade do provider ainda não;
- existem testes reais de PostgreSQL, SQS, concorrência financeira e redelivery commit/ack; crash abrupto de processo e três processos completos permanecem na Fase 10;
- não existe autenticação; logs, correlação e métricas operacionais estão implementados sem payload financeiro ou labels de alta cardinalidade;
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
