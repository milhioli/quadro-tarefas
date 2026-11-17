<!-- Cópia versionada do roteiro aprovado em 17/11/2026. Ao mudar uma decisão, atualize este arquivo. -->
# Plano — Quadro multiusuário: contas, grupos em tempo real, agendas por pessoa e tarefas com duração

> **Status:** documento de arquitetura e roteiro. Cada fase vira um plano próprio quando for a vez dela.
> **Andamento (17/11/2026):**
> - **Fase 0 (E2E com Playwright 1.64.1):** feita e validada, 8 jornadas.
> - **Fase 1 (tarefas com duração):** feita e validada, com 786 testes de unidade/integração e 12 jornadas E2E. As escolhas que o plano deixava em aberto:
>   - os triggers de sobreposição no banco foram incluídos;
>   - no celular, a tarefa longa aparece numa linha só, sem altura proporcional;
>   - o modificador do overlay chama-se `keepOverlayUnderPointer`.
> - **E2E na máquina do usuário:** confirmado em 17/11/2026. A primeira rodada revelou uma corrida no foco da toolbar do editor, já corrigida (`keepEditorFocus`). O teste humano visual da Fase 1 (seção "Ao fim de cada fase") segue com o usuário.
> - **Próximo passo: Fase 2.** Antes de escrever o plano dela, pergunte ao usuário:
>   - (a) se é só contas e quadros rodando no 127.0.0.1 (**2a**, recomendado) ou já com deploy (**2b**: Docker, Caddy, Litestream, domínio e onde hospedar);
>   - (b) quem pode criar conta: aprovação do admin (recomendado), só domínio(s) Workspace (`ALLOWED_GOOGLE_HD`), ou o domínio entra direto e o resto aguarda aprovação.
>
>   Depois: o plano da fase, a revisão do `cybersecurity-reviewer`, a aprovação e só então o código.
> **Revisão 2 (17/11/2026):** o usuário esclareceu que 500 era só um exemplo: **não há teto de usuários** (ver "Crescer sem teto"). Privacidade, plano de incidente e retenção deixaram de ser pendências e viraram itens concretos (seção "Privacidade, incidente e retenção").
> **Revisão 3 (17/11/2026):** os eventos da agenda ficam em memória enquanto a pessoa usa o app, e entra a **Fase 0: testes E2E no navegador** (Playwright), antes da Fase 1.
> **Revisões incorporadas:** leitura independente do código para a Fase 1 (agente de planejamento) e parecer do `cybersecurity-reviewer` para as fases 2–4 (7 bloqueantes, 11 recomendados, 7 opcionais e 9 contradições com o CLAUDE.md/código — todos tratados; resumo na seção final). Os três itens que antes iam para o usuário ou o encarregado (privacidade, incidente e retenção) agora estão resolvidos na seção própria.

## Contexto

O quadro hoje é **local, de uma pessoa só e sem login**: um processo Node com `node:sqlite`, guard preso ao loopback, um único conjunto de tarefas e a agenda da Apple ligada por flag de linha de comando. O usuário quer pensar o sistema para:

1. **Muitos usuários simultâneos** (500 foi o exemplo da pergunta, **não um limite**), cada um com login e a **própria agenda** (Apple e Google) ligada.
2. **Grupos com visualização compartilhada em tempo real**: quem está no desktop vê o mouse dos outros; quem está no celular vê a animação das tarefas sendo criadas e movidas.
3. **Tarefas com duração**: uma só faixa de 30 min ou uma sequência contínua (ex.: 05:00–20:00).

Restrição explícita: **simplicidade, fugindo de over-engineering.** O desenho abaixo escolhe, em cada ponto, a opção mais simples que ainda aguenta 500 pessoas e mantém as garantias de segurança que o projeto já tem (regras puras no `shared`, validação zod estrita, nenhuma rede de saída fora de um ponto guardado, nada de HTML montado à mão).

### Decisões do usuário (17/11/2026)
- **Faixa de horário** = tarefa com duração (ocupa N slots seguidos no mesmo dia). Grade do quadro continua fixa (05:00–22:00).
- **Agendas:** Apple por **senha de app custodiada no servidor, criptografada** (aceita pela revisão de segurança **sob 8 condições**, listadas na Fase 4); Google por **OAuth**, com os dois escopos mais estreitos que servem (`calendar.events.readonly` + `calendar.calendarlist.readonly`, para a pessoa escolher quais calendários entram — um só escopo `calendar.readonly` seria mais largo e também sensível).
- **Login com Google.** Cada pessoa escolhe um **nome de usuário**; o sistema gera o **handle `nome_NN`**, em que `NN` é uma **sequência global** que começa em `00` (**o `00` é o administrador**) e cresce de 1 em 1 sem limite (`99` → `100`). O handle é o que se usa para **achar pessoas e montar grupo**. Ajuste da revisão: o `00` não é "quem logar primeiro" (seria uma corrida numa URL pública), e sim a conta cujo e-mail está em `QUADRO_ADMIN_EMAIL`; e **quem pode criar conta** é decidido por domínio Workspace (`hd`) e/ou aprovação do admin, não cadastro aberto.
- **Agora:** só documentar.
- **Sem teto de usuários:** 500 era um exemplo da pergunta, não um requisito de limite.
- **Contato e incidente:** um e-mail que o usuário vai criar entra no `.env` como `QUADRO_CONTACT_EMAIL`. Ele é o canal de privacidade e o remetente dos avisos de incidente.

## O tamanho real do problema (por que dá para ser simples)

| Carga | Estimativa | Consequência |
|---|---|---|
| 500 conexões WebSocket abertas | trivial para um processo Node | **um processo**, sem Redis, sem broker |
| Mutação (criar/mover) | poucos KB, 1 transação curta | SQLite em WAL aguenta com folga |
| Cursor do mouse | 10–15 Hz por pessoa, só em quadro com ≥ 2 pessoas online, só para a sala | nada é persistido; só fan-out em memória |
| Agenda por pessoa | 1 leitura por semana vista; depois, só atualização em segundo plano a cada 5 min enquanto a pessoa usa o app | o custo é o **parse** do ICS (CPU) — ver "Riscos" |

Conclusão: **1 processo Node 24 + SQLite WAL + WebSocket em memória**, num container atrás de um proxy com TLS. Postgres, filas, CRDT e múltiplas instâncias ficam **fora** até existir uma medição que exija.

### Crescer sem teto
Nada no desenho limita o número de usuários. 500 é só uma carga em que **um processo** basta com folga. O que pesa quando a base cresce não é o número de contas, e sim três coisas mensuráveis. Cada uma tem um próximo passo, já preparado pelas interfaces das fases 2–4:

| O que medir | Sinal de que chegou a hora | Próximo passo (sem reescrever as rotas) |
|---|---|---|
| CPU do processo | > 70 % sustentado no horário de pico | parse de ICS em `worker_threads`; depois, 2+ processos |
| Necessidade de 2+ processos | CPU, deploy sem queda ou alta disponibilidade | SQLite → **Postgres** (o repositório já isola o SQL) e `BoardHub` → Postgres `LISTEN/NOTIFY` (a interface `publish/subscribe/evict` foi desenhada para isso); proxy com afinidade por conexão no `/ws` |
| Leituras de agenda por minuto | fila crescendo ou Apple/Google devolvendo 429 | atualização em segundo plano menos frequente (10–15 min) e teto de leituras simultâneas por provedor |

Ordem de grandeza: um processo Node segura milhares de WebSockets ociosos. O custo real é o fan-out de cursor em grupos grandes (limitado a 15 Hz por pessoa e só dentro da sala) e o parse de ICS. O único teto externo é do **Google**: **100 usuários novos** na conexão de agenda enquanto o app não for verificado. O login em si não tem esse teto (ver "Privacidade, incidente e retenção").

## Arquitetura alvo

```
navegador ──HTTPS──▶ Caddy (TLS) ──▶ Node 24 (Fastify)
                                        ├─ /            estáticos do Vite (@fastify/static)
                                        ├─ /api/*       rotas JSON (como hoje) + sessão por cookie
                                        ├─ /ws          WebSocket: assinatura por quadro, presença
                                        ├─ BoardHub     salas em memória (boardId → sockets)
                                        ├─ SQLite WAL   dados + sessões + credenciais cifradas
                                        └─ guardedFetch única saída de rede (iCloud CalDAV, Google)
                      Litestream ──▶ réplica contínua do .sqlite num bucket (backup)
```

- **Mesma origem** para app e API (`APP_ORIGIN`, ex.: `https://quadro.exemplo.com`): sem CORS, cookie `SameSite=Lax`, e o header `X-Quadro-Client: 1` continua obrigatório em toda mutação (defesa em profundidade contra CSRF).
- **Mutações continuam por HTTP** (validadas, transacionais, idempotentes como hoje). O WebSocket **nunca** recebe mutação: ele só entrega eventos do servidor e troca presença (cursor/arraste), que é efêmera. Essa divisão é o que mantém o tempo real simples.
- **Fonte da verdade** = banco. Cada quadro tem um `version` monotônico; todo evento carrega a versão; o cliente aplica se for `local + 1`, senão refaz o GET. Reconectou → GET. Sem CRDT: o estado é uma grade de posições e o servidor decide (last-writer-wins já é o que o `PUT /position` faz).

## Modelo de dados (migrações novas)

```sql
users(id, google_sub UNIQUE, email, username, seq INTEGER UNIQUE,      -- handle = username || '_' || printf('%02d', seq)
      role CHECK (role IN ('admin','user')), status CHECK (status IN ('active','disabled')),
      created_at, last_seen_at)
boards(id, name, kind CHECK (kind IN ('personal','group')), owner_user_id, version INTEGER NOT NULL DEFAULT 0, created_at)
board_members(board_id, user_id, role CHECK (role IN ('owner','editor','viewer')),
      status CHECK (status IN ('invited','active')), calendar_share CHECK (calendar_share IN ('none','busy','titles')),
      invited_by, joined_at, PRIMARY KEY (board_id, user_id))
tasks(... + board_id NOT NULL, created_by, span INTEGER NOT NULL DEFAULT 1)   -- ver Fase 1
sessions(id_hash PRIMARY KEY, user_id, created_at, expires_at, last_seen_at)  -- cookie guarda o id aleatório; banco guarda o hash
calendar_connections(id, user_id, provider CHECK (provider IN ('apple','google')),
      label,                      -- texto curto validado por zod; NUNCA o Apple ID nem o e-mail
      secret BLOB, key_id,        -- ciphertext AES-256-GCM: Apple ID + senha de app, ou refresh token do Google
      calendars TEXT,             -- JSON com os ids/nomes escolhidos
      created_at, last_ok_at, last_status CHECK (last_status IN ('ok','auth','upstream','never')), paused_until, auth_failures)
audit_log(id, at, actor_user_id, action, target_kind, target_id)             -- sem handle buscado, sem título, sem URL
```

- **Grupo = quadro compartilhado.** O quadro pessoal é um `board` `personal` com 1 membro e **recusa membros**. Um grupo é um `board` `group` com N membros. Nada de entidade "grupo" separada: evita duplicar permissão.
- **Handle:** `username` com 3–20 caracteres `[a-z0-9._]`, sem precisar ser único (o `seq` já garante unicidade do handle). `seq` vem de um contador único (`INSERT` com `MAX(seq)+1` dentro de `BEGIN IMMEDIATE`). **`seq = 0` e `role = 'admin'` só para a conta cujo e-mail verificado é igual a `QUADRO_ADMIN_EMAIL`**; qualquer outro login antes dela vê "aguardando o administrador" e não cria `users`. Mostrar o handle com pelo menos 2 dígitos (`00`…`99`, depois `100`). O admin não ganha selo na interface (o `_00` já o identifica; não piorar).
- **Quem pode criar conta:** `ALLOWED_GOOGLE_HD` (lista de domínios Workspace, conferida no claim `hd` do ID token) **e/ou** aprovação do admin antes do `INSERT` em `users`. Sem isso não existe conta nem `seq`. Evita homônimos para engenharia social (`ana_57` adicionada como se fosse a Ana) e evita custodiar credencial de iCloud de estranhos.
- **Achar pessoas:** só por **handle exato**, via `POST /api/users/lookup {handle}` (corpo, não query: a query cai no log do pino), com `X-Quadro-Client`, devolvendo nome e handle. Resposta idêntica em forma e tempo para inexistente e desativado. Rate limit de 20/min e 200/dia por usuário; `audit_log` grava só a contagem. Sem listagem nem busca por prefixo. Opcional: toggle "permitir que me encontrem pelo handle".
- **Entrar num grupo exige aceite:** o owner convida pelo handle (`status = 'invited'`); a pessoa aceita ou recusa. Ninguém é colocado num quadro sem querer (vetor de assédio, de spam com conteúdo rico e de observação da presença).
- **Dado do quadro atual:** a migração cria o quadro pessoal do admin na primeira entrada dele e move as tarefas existentes para lá.

## Fases

### Fase 0 — Testes E2E no navegador (antes da Fase 1)
**Por que primeiro:** o jsdom não simula o que mais quebra numa mudança de regra: o arraste do dnd-kit, o redimensionar, o layout real de celular e, na Fase 3, duas pessoas no mesmo quadro. Hoje isso é conferido à mão. A Fase 1 mexe em `shared/src/move.ts`, o coração do arraste, então a rede de proteção precisa existir antes.

- **Ferramenta:** `@playwright/test`, como dependência de desenvolvimento, com versão exata e a mesma revisão das outras (`npm view <pkg> time`, `npm audit` e `npm audit signatures`).
  - Como o `.npmrc` tem `ignore-scripts=true`, o navegador é baixado num passo explícito (`npx playwright install chromium`).
  - Só Chromium, com emulação de celular (`devices['Pixel 7']`). Firefox e WebKit ficam para depois.
- **Onde:** pasta `e2e/` na raiz, com `*.spec.ts` e `playwright.config.ts`, e script `npm run test:e2e`. Fica fora do `npm test` (Vitest) porque é mais lento e sobe servidor.
- **Servidor de teste:**
  - O `webServer` do Playwright sobe `npm run dev`, **nunca `dev:agenda`**.
  - O banco é um `DB_PATH` temporário novo a cada execução.
  - As portas são próprias (`API_PORT`/`WEB_PORT`, ex.: 3101/5273), para não colidir com o seu `npm run dev`. Confirmar que o allowlist do guard segue essas portas, como já acontece com `API_PORT=0` no `index.test.ts`.
  - `baseURL` é `http://127.0.0.1:<porta>`, nunca `localhost`.
- **Regras do projeto nos specs:**
  - Nada de `new Date()`. Datas fixas vêm do `?hoje=AAAA-MM-DD` que já existe (`web/src/lib/devToday.ts`).
  - `workers: 1`, e cada teste apaga pela API as tarefas que criou (com `X-Quadro-Client`). Nenhuma rota "só para teste" no servidor.
  - Traces, screenshots e vídeos ficam fora do git (`test-results/` e `playwright-report/` no `.gitignore`). Como a agenda está sempre desligada, eles só têm dados de teste.
  - O CLAUDE.md ganha a exceção "`e2e/` e `playwright.config.ts` não precisam de teste irmão" (os specs já são testes).
- **Jornadas da Fase 0, cobrindo o que já existe:**
  1. Criar uma tarefa pelo deck, dar título e cor, marcar um item de checklist pela toolbar, recarregar a página e ver que tudo persistiu.
  2. Arrastar a tarefa do deck para uma célula e depois entre células. Soltar numa célula ocupada troca as duas. Arrastar de volta para o deck.
  3. Agendar pelo campo "Quando" do modal: um horário ocupado aparece desabilitado.
  4. "Resetar quadro" devolve tudo ao deck sem apagar nenhuma tarefa.
  5. Com `?hoje=2026-11-15`, a sexta mostra a bolinha da Consciência Negra, e clicar nela abre o modal de feriados.
  6. No celular: as três tags (Dia, Dia completo, Semana) funcionam; "+ livre" abre "Nova tarefa" já com o horário; a visualização escolhida continua depois de recarregar.
  7. Com a agenda desligada, não aparece nenhuma bolinha roxa nem erro no topo.
  8. O console fica sem erros de CSP nem de React durante todas as jornadas.
- **Jornadas das outras fases:** ficam junto do teste humano, em "Ao fim de cada fase: E2E e teste humano".
- **Quem roda:** o `e2e-validator`, depois de o `test-runner` aprovar, só com as jornadas afetadas pela mudança, como já prevê o CLAUDE.md global.

### Fase 1 — Tarefas com duração (local, sem infra)
Não depende de login nem de rede. É a fase mais acoplada ao código atual e a única que mexe em regra de negócio. Desenho validado contra o código por um agente de planejamento (achados incorporados abaixo).

**Modelo e banco**
- `slot` continua sendo o início; entra **`span INTEGER NOT NULL DEFAULT 1`** (não `slot_end`: continua válido no deck, sem coluna nullable nem CHECK triplo, e a troca compara `a.span === b.span` direto). O `span` pertence à tarefa: viaja no arraste e no retorno ao deck.
- Migração = um único item novo em `MIGRATIONS` (`server/src/db/migrations.ts`, `user_version` 2): `ALTER TABLE tasks ADD COLUMN span INTEGER NOT NULL DEFAULT 1 CHECK (span BETWEEN 1 AND 34 AND (day IS NULL OR slot + span <= 34))`. Nenhuma linha é reescrita: toda tarefa existente fica com `span = 1`, que é o comportamento de hoje.
- **Não-sobreposição:** checada em memória por `planMove`/`planPlacement`, que já rodam inteiras dentro de `BEGIN IMMEDIATE` (`server/src/db/transaction.ts`), com um escritor por vez. O índice único `(day, slot)` e as duas fases de `writePositions` **ficam** (pegam o caso degenerado de dois inícios iguais e a troca precisa das duas fases). Opcional e barato: um trigger `BEFORE UPDATE OF day, slot, span` que faz `RAISE(ABORT)` se existir `t.slot < NEW.slot + NEW.span AND NEW.slot < t.slot + t.span` no mesmo dia — dá no banco a mesma garantia que o índice único dá hoje. Rejeitada a tabela materializada `task_slots` (30 linhas por arraste para repetir o que a transação garante).

**Regras (`shared/src/move.ts`)**
- `Position` ganha `span`. Novos: `occupantsOf(state, day, slot, span, exceptId?)` (faixas que cruzam `[slot, slot+span)`, em ordem) e `maxSpanAt(state, day, slot, exceptId?)` (quantos slots cabem até a próxima tarefa ou 22:00). `occupantOf` fica como atalho de 1 slot.
- `planMove`: faixa **livre** → move; `to.slot + span > 34` → `INVALID_TARGET` ("A tarefa não cabe até 22:00"); sobrepõe **exatamente uma** tarefa com **o mesmo `span`** → troca, e a arrastada assume **o início da ocupante** (`hit.slot`), para "trocar" continuar significando "as duas trocam de faixa exatamente" mesmo com soltura desalinhada; qualquer outra sobreposição → **`OCCUPIED`** (novo em `planMove`, que hoje nunca lança isso). Sem cascata de "empurrar as outras": é aí que a complexidade explodiria. Mover um bloco dentro da própria pegada funciona porque `exceptId` exclui a própria tarefa.
- `planPlacement` (formulário e redimensionar): recusa **qualquer** sobreposição e o estouro de 22:00, e faz essa checagem **antes** do curto-circuito "mesma célula" de `planMove` — é assim que o repositório valida um `span` que cresceu no lugar.
- `planReset`/`applyPositions`: só carregam `span`.

**API e servidor**
- `shared/src/schemas.ts`: `spanSchema = z.number().int().min(1).max(SLOT_COUNT)`, opcional em `createTaskSchema` e `updateTaskSchema`; `Task.span`. `moveTargetSchema`/`PUT /position` não mudam.
- **Não existe código HTTP `INVALID_TARGET`:** `moveErrorToHttp` (`server/src/routes/tasks.ts`) já mapeia para 400 `VALIDATION` com a mensagem; sobreposição → 409 `CONFLICT`. Nenhuma rota nova.
- `taskRepository.update`: grava `span = patch.span ?? current.span` e, se veio `span` sem `position` e a tarefa está no quadro, chama `planPlacement` com a célula atual (lida **depois** do UPDATE, para ver o span novo); se lançar, o rollback desfaz o span — preserva "nenhum campo muda".

**Web desktop**
- O quadro é uma **`<table>`** (`Board.tsx`, um `<td>`/`BoardCell` droppable por célula), então `grid-row: span N` não serve. O cartão é desenhado **só na célula de início, `position:absolute`**, com altura `calc(var(--span) * var(--row-h) - 6px)`; as células cobertas ficam vazias (`is-covered`) mas continuam droppable. `web/src/lib/board.ts` troca `placedTasksByCell` por `boardLayout(tasks) → { starts, covered }`, com `maxSpan` por início.
- **Colisão não muda:** `pointerWithin` já usa só a coordenada do ponteiro e o `collisionRect` é o do `DragOverlay` (220 px), não o cartão alto. O problema é visual: o overlay nasce no canto superior esquerdo do cartão, então um bloco de 30 slots pego pela borda de baixo deixa o fantasma 29 linhas acima do ponteiro. Correção: um `Modifier` de poucas linhas em `web/src/lib/dnd.ts` que ancora o topo do overlay no ponteiro (`getEventCoordinates` de `@dnd-kit/utilities`, que já é dependência; **não** instalar `@dnd-kit/modifiers`).
- **`dropToMove` (`web/src/lib/dnd.ts`) hoje engole qualquer erro e devolve `null`.** Passa a devolver a intenção `{taskId, to}` também quando `planMove` lança `OCCUPIED`/`INVALID_TARGET` (só `NOT_FOUND` vira `null`): o servidor responde 409/400 e o `onError` já existente no `handleDragEnd` mostra "Não foi possível mover a tarefa. Esse horário já está ocupado". Zero código novo de toast, coerente com "o servidor decide".
- **Redimensionar** fora do dnd-kit: um `<span class="task-card__resize">` na borda inferior com pointer events próprios; `onPointerDown` faz `stopPropagation` (o `PointerSensor` é o `onPointerDown` sintético espalhado pelos `listeners` no pai, então ele nunca arma) + `setPointerCapture`; `rowHeight` medido do `<td>` real; `spanFromPointer(startY, y, rowHeight, startSpan, maxSpan)` puro em `web/src/lib/resize.ts` (snap de 30 min, clamp em `maxSpanAt`); `onPointerUp` → callback `onResize(id, span)` até o `App`, que chama `useUpdateTask` com `{span}` (`BoardCell.test.tsx` renderiza sem `ApiProvider`, então o `TaskCard` não pode ter o hook). `onClick` com `stopPropagation` para não abrir o modal; handle `aria-hidden` — o caminho acessível é o "Até" do modal.

**Modal e mobile**
- `shared/src/slots.ts`: `slotTime(boundary 0..34)` ('05:00'…'22:00') e `rangeLabel(slot, span)` ('05:00 – 20:00'; com span 1 é igual a `slotLabel`).
- `SchedulePicker`: `ScheduleValue = {day, slot, span}` e um terceiro select **"Até"** (desabilitado sem horário), com opções de `slot+1` até `maxSpanAt` (`endChoices` em `web/src/lib/agenda.ts`); mudar dia ou início reduz o span se precisar. `slotChoices` passa a marcar como ocupado um início que caia dentro da faixa de outra tarefa. Inícios **não** são desabilitados por "não caber com o span atual": o "Até" se ajusta. `TaskModal` manda `span` na criação só quando > 1 e no PATCH quando mudou, na mesma requisição do `position`.
- Mobile: `AgendaDayGrid` usa `boardLayout`; faixas cobertas não renderizam linha nem "+ livre"; a linha de início mostra `rangeLabel` ("05:00 – 20:00 Título") e, opcionalmente, altura proporcional via `--span`. `AgendaDayList`/`AgendaWeek` só trocam `slotLabel` por `rangeLabel`.
- Docs: trocar "ocupa 1 slot" em `README.md` e `CLAUDE.md`.

**Testes essenciais**
- `shared`: `occupantsOf` (adjacentes 0–1 e 2–3 não se sobrepõem; parcial sim; ignora `exceptId`), `maxSpanAt`, `planMove` (span viaja deck↔célula; troca exata alinhada e desalinhada assume `hit.slot`; span diferente ou duas atingidas → `OCCUPIED`; deck → ocupada de mesmo span manda a ocupante ao deck; estouro → `INVALID_TARGET`; invariante "nunca sobrepõe" reescrito por faixas), `planPlacement` (span crescido no lugar contra vizinho → `OCCUPIED`), `spanSchema` (1 e 34 ok; 0, 35, 1.5, `'2'` não), `rangeLabel`.
- `server`: migração a partir de `MIGRATIONS.slice(0, 1)` com dados (todas ficam `span = 1`; `slot 33, span 2` rejeitado; se houver trigger, UPDATE sobreposto rejeitado); repositório (`update({span})` contra vizinho → `OCCUPIED` e nada muda; troca com mesmo span; span sobrevive ao `reset`); rotas (POST `span 30` em `slot 0` → 201; PATCH `{span: 3}` com vizinho → 409; estouro → 400 `VALIDATION`; adjacentes sem conflito).
- `web`: `fakeApi` aplica a mesma regra do repositório para `span` no lugar; `boardLayout`, `endChoices`, `dropToMove` devolvendo intenção em `OCCUPIED`, `spanFromPointer`; `Board`/`BoardCell` (cartão alto com `--span`, célula coberta vazia mas `role="cell"`, 170 células, `pointerDown/Move/Up` no handle chama `onResize` respeitando `maxSpan` e **não** abre o modal); `SchedulePicker` ("Até" de início+1 até o vizinho/22:00; trocar início reduz o span); `AgendaDayGrid` (bloco de 30 slots → um botão "05:00 – 20:00 Título" e 4 "+ livre"); `App` (criar com Dia/Horário/Até → cartão na célula de início).
- Ordem: `shared` (`slots` → `move` → `schemas`) → `server` (migração → repositório → rotas) → `web` (`fakeApi` → libs → `TaskCard`/`BoardCell`/`Board`/`App` → `SchedulePicker`/`TaskModal` → agenda mobile → CSS → docs).

### Fase 2 — Contas, quadros e deploy
A base de tudo que é multiusuário.

- **Login Google (OIDC, authorization code + PKCE):** biblioteca `openid-client` (mantida, certificada; só valida o ID token e troca o code — nada de montar JWT à mão). Escopos no login: só `openid email profile`. O escopo de agenda é pedido **depois**, na Fase 4 (autorização incremental). Conferir `email_verified` e `hd`.
  - **Vínculo com o navegador (B6):** `state`, `nonce` e `code_verifier` vão num cookie `__Host-quadro_oauth` (HttpOnly, Secure, SameSite=Lax, 10 min), conferido e apagado no callback; a sessão é emitida **só depois** e nunca reaproveita cookie anterior; `redirect_uri` fixo; destino pós-login só caminho relativo validado. Sem isso há login CSRF (a vítima acaba logada na conta do atacante e conecta a agenda nela) e callback forjado.
  - **Rede do `openid-client` (R2):** ele faz o próprio HTTP (discovery, JWKS, token) e segue redirecionamentos. Recebe `[customFetch]` apontando para o `guardedFetch` com allowlist **do provedor Google** (`accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`). Falha no discovery não derruba a subida. `GOOGLE_CLIENT_SECRET` tem o mesmo tratamento da senha de app hoje: lido, apagado do `env`, vive em closure.
- **Sessão:** cookie `__Host-quadro_session` (`HttpOnly; Secure; SameSite=Lax; Path=/`), valor aleatório de 256 bits, **hash** guardado em `sessions`, expiração deslizante (30 dias, renovada a cada uso, máximo absoluto de 90). Logout é `POST` com `X-Quadro-Client`, apaga a linha e fecha os sockets dessa sessão. Sem JWT no cookie: revogação imediata e zero segredo de assinatura.
- **Primeiro acesso:** só para quem passa no filtro de cadastro (domínio `hd` e/ou aprovação). Tela para escolher o `username` → cria `users` + quadro pessoal. `seq 0`/admin só para `QUADRO_ADMIN_EMAIL`.
- **Autorização no servidor (sempre), sem IDOR (B3):** `boardId` vindo do cliente só em `POST /api/boards/:id/tasks` e nos `GET`. Em `PATCH/DELETE /api/tasks/:id` e `PUT .../position` o servidor lê `board_id` **da própria linha, dentro da transação**, e autoriza sobre ele (viewer lê; editor/owner escreve; owner convida e remove). Tarefa de quadro alheio responde **404**, nunca 403.
- **Grupo:** `POST /api/boards` (cria grupo), `POST /api/boards/:id/invites {handle}` (owner convida), `POST /api/invites/:id/accept|decline`, `DELETE .../members/:userId`, sair do grupo. Owner não remove a si mesmo (passa a posse ou apaga o quadro). Convite por link e papéis finos ficam para depois.
- **Guard:** Host e Origin por igualdade continuam, agora contra `APP_ORIGIN` (uma origem só; atrás do Caddy o `Host` vem **sem porta**, então a regex de `isAllowedHost` e os testes mudam, mantendo "qualquer outro host → 403"). **Com cookie, método não seguro sem `Origin` passa a ser 403** (hoje `Origin` ausente é aceito). `trustProxy: '127.0.0.1'` (string, nunca `true`). Rate limit (`@fastify/rate-limit`) por sessão/IP em login, lookup, convite e agenda.
- **Estáticos (R11):** Vite faz o build; Fastify serve só `web/dist` com `@fastify/static` (`dotfiles: 'deny'`, fallback SPA só fora de `/api`), `index.html` com `no-store` e assets com hash `immutable`. A CSP atual (`default-src 'none'`) é para JSON; o HTML recebe: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss://<APP_ORIGIN>; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. O TipTap injeta `<style>` por padrão → `injectCSS: false` e CSS no bundle, senão pede `unsafe-inline`. COOP/CORP `same-origin`; HSTS no Caddy.
- **Deploy:** Dockerfile (Node 24, `npm ci --ignore-scripts`), Caddy com TLS automático, volume persistente para o `.sqlite`, **Litestream** replicando para um bucket privado com versionamento, credencial própria e mínima, **retenção curta e declarada (7 dias)**. **Caddy e Node no mesmo namespace de rede** (mesmo container, `network_mode: service:…` no Compose, ou VM com systemd): o Node continua em `127.0.0.1` (`API_HOST` fixo em `server/src/config.ts`; o CLAUDE.md proíbe `0.0.0.0`/`host: true`), e isso é a pré-condição do `trustProxy`. `PRAGMA secure_delete=ON` para linhas apagadas não ficarem em páginas livres do arquivo (e do backup). Health check já existe.
- **Configuração:** `.env.example` ganha `APP_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `QUADRO_ADMIN_EMAIL`, `ALLOWED_GOOGLE_HD`, `QUADRO_CONTACT_EMAIL` e passa a dizer que em produção essas chaves são obrigatórias. A chave mestra de cifra **não** entra no `.env`: ver Fase 4. Agentes nunca leem o `.env`.
- **Admin (`seq 0`), limitado (R10):** `role='admin'` **não** dá acesso a quadros, tarefas nem agendas de ninguém. Rotas admin separadas e auditadas: listar usuários (só handle, e-mail e `last_seen_at`), aprovar cadastro, desativar conta (= apagar sessões, fechar sockets, apagar conexões de agenda e cache, bloquear login). Admin não desativa a si mesmo. Sem painel; um par de rotas basta.
- **CLAUDE.md:** a frase "o app não tem autenticação" e a regra "não abra túnel / não ponha IP na allowlist" são reescritas com a nova premissa (uma origem, `APP_ORIGIN`, sessão por cookie), não apenas ignoradas. A lista de dependências que tocam conteúdo externo passa a incluir `openid-client` (via `customFetch` guardado) e `ws` (parseia frames de clientes não confiáveis).

### Fase 3 — Tempo real e presença
- **Transporte:** WebSocket em `/ws` (`ws` via `@fastify/websocket`). No upgrade, **nesta ordem**: limite de upgrades por IP/sessão, `Origin` presente e igual a `APP_ORIGIN` (ausente ou diferente → recusa antes de ler o cookie), sessão válida pelo cookie. A API `WebSocket` do navegador não manda header, então `X-Quadro-Client` não se aplica aqui; `Origin` exata + sessão basta (página de terceiro não forja `Origin`; cliente fora do navegador forja `Origin` mas não tem o cookie). Um socket por aba; assina um quadro de cada vez (`{t:'sub', boardId}`), com a mesma checagem de membro `active`.
- **`BoardHub` (memória):** `Map<boardId, Set<socket>>`, cada socket carregando `sessionId` e `userId`. Interface pequena (`publish`, `subscribe`, `unsubscribe`, **`evict(boardId, userId)`**, **`evictSession(sessionId)`**) para que, se um dia houver mais de um processo, a implementação troque por Postgres `LISTEN/NOTIFY` sem tocar nas rotas.
- **Revogação ao vivo (B4):** a checagem de membro no `sub` não basta. `DELETE .../members` chama `evict`; logout, expiração e desativação chamam `evictSession`. Teste: membro removido para de receber `task.*`, `positions` e presença na hora.
- **Eventos de dado (servidor → cliente),** emitidos pelo repositório **depois do commit**, todos com `version`:
  - `task.created {task}`, `task.updated {task}`, `task.deleted {id}`
  - `positions {changes}` (mover, redimensionar, resetar) — reaproveita `applyPositions` no cliente
  - `board.version {version}` ao assinar (o cliente compara e refaz o GET se divergir)
- **Presença (efêmera, nunca persistida):**
  - `presence.members` ao entrar/sair: `{userId, handle, color}` (cor derivada do `seq`).
  - `cursor {day, slot, fx, fy}` — posição **normalizada à célula**, não em pixels, para fazer sentido em telas diferentes. Cliente envia no máximo a 15 Hz; servidor coalesce por remetente a cada 50 ms e só retransmite para a sala. Só desktop envia; celular só recebe (e não desenha cursor).
  - `drag {taskId, over: {day, slot} | null}` enquanto alguém arrasta: os outros veem um "fantasma" do cartão na célula alvo. No celular, isso é a "animação da movimentação" antes mesmo do commit.
  - Quadro pessoal com 1 pessoa online: presença desligada (nada a transmitir).
- **Cliente:** um hook `useBoardSocket(boardId)` que aplica os eventos no cache do TanStack Query (`setQueryData` nas chaves que hoje são `['tasks']`, que passam a `['boards', id, 'tasks']`). Reconexão com backoff (1 s → 30 s) e GET ao reconectar. A camada de cursores é um `<div>` por pessoa posicionado sobre o quadro, com o handle ao lado; texto só como texto.
- **Animação no celular:** FLIP com CSS (`transform` + `transition`), medindo a posição do cartão antes e depois de o cache mudar; cartão novo entra com fade. Sem biblioteca de animação.
- **Identidade carimbada pelo servidor (R7):** `userId`/`handle` de `cursor`, `drag` e `presence.members` vêm **da sessão do socket**, e o que é retransmitido é um objeto **reconstruído** pelo servidor, nunca o payload recebido (senão `{t:'cursor', userId: 7}` vira spoof). `drag` valida `taskId ∈ quadro` e `day/slot` no intervalo. Schemas zod `strict` por tipo de mensagem.
- **Limites:** mensagem de entrada ≤ 1 KiB, 1 assinatura por socket, 20 sockets por sessão, `drag` limitado como `cursor`, desconectar quem exceder taxa. Teto de tarefas por quadro e rate limit de mutação por usuário (cada mutação é fan-out para a sala inteira).

### Fase 4 — Agendas por pessoa (Apple e Google)
Generaliza a integração atual: deixa de ser global por flag e passa a ser **por usuário, ligada pela interface**.

- **Custódia das senhas de app da Apple — as 8 condições do revisor (sem 1, 3 e 6 ele não aprova):**
  1. **Chave mestra separada do banco:** carregada de `QUADRO_MASTER_KEY_FILE` (arquivo `0400` fora do volume do `.sqlite`, fora da imagem, fora do bucket do Litestream) ou de um secret manager; apagada do `env` depois de lida; **nunca no `.env`** (hoje `process.loadEnvFile` o lê no mesmo host/volume do banco — exatamente o pior caso). Rotação com duas chaves ativas (`key_id` na linha; re-cifra na leitura).
  2. **Apple ID dentro do ciphertext**, nunca em `label`; AAD = `connection_id:user_id:provider` (permite mais de uma conexão por pessoa sem troca de linha).
  3. **Vida do claro = uma requisição:** `authorization()` decifra **a cada chamada** a partir do ciphertext e não retém nada. Isso **muda** o padrão atual (`calendar/config.ts` monta o header Basic uma vez e `calendarService.ts` o retém em `source ??=` pela vida do processo; replicado por usuário seriam 500 credenciais em claro residentes). `secrets.test.ts` prova que `inspect`/`JSON.stringify`/log do serviço não contêm o segredo.
  4. **Saída só para hosts Apple com essa credencial:** `createGuardedFetch({provider})` com **allowlist por provedor** — credencial Apple nunca vai a host Google e vice-versa.
  5. **Logs sem corpo, sem query, sem erro cru** (ver "Erros e logs" abaixo).
  6. **Eliminação real:** desconectar apaga a linha **e** purga o cache `(userId, *)` na hora (senão títulos de terceiros ficariam na memória até a pessoa sair); retenção de backup curta e declarada; rotação de chave.
  7. **Auditoria de decifragem:** `audit_log {at, actor_user_id, action:'calendar.read', target_kind:'connection', target_id}`; em leitura de grupo, `actor` é quem olhou e `target_id` é a conexão de quem é a agenda.
  8. **Incidente e transparência:** página de privacidade, canal de contato (`QUADRO_CONTACT_EMAIL`) e procedimento de incidente, descritos em "Privacidade, incidente e retenção". Como só a própria pessoa consegue revogar uma senha de app da Apple, avisar cada uma é obrigatório. O canal existe: o app guarda o e-mail de cada conta, que vem do login Google.
- **Cifra (`server/src/crypto/secrets.ts`):** AES-256-GCM com `node:crypto`, nonce por registro, `key_id`, AAD como acima. Decifra só dentro do serviço de agenda, por chamada. Nunca em log, erro, resposta nem `inspect`.
- **Apple:** o usuário cola o Apple ID e a senha de app numa tela que explica, em uma frase, que a senha vale para todo o iCloud e como revogar. O servidor valida o formato do Apple ID e da senha (regex já existente), faz **um PROPFIND de teste antes de gravar** (senha inválida nem entra no banco) e reaproveita `caldavClient.ts`/`parseEvents.ts`/`guardedFetch.ts`. **Oráculo limitado (R4):** essa rota de teste tem rate limit por usuário (5/h) e global (60/h), porque senão vira credential stuffing contra a Apple a partir do IP do servidor, que a Apple bloquearia para todos. `last_status` é enum, nunca mensagem. A escolha de calendários (hoje `ICLOUD_CALENDARS`) vira por conexão, a partir dos nomes do discovery.
- **Google:** botão "Conectar agenda Google" pede, por autorização incremental, `calendar.events.readonly` + `calendar.calendarlist.readonly`, com `access_type=offline` e `prompt=consent` para receber o refresh token; o servidor confere o **escopo concedido** na resposta (a pessoa pode negar parte). O **refresh token** é o segredo cifrado; o access token vive só em memória e nunca vai para `calendar_connections`. Leitura por `events.list` com `timeMin/timeMax`, `singleEvents=true` (o Google expande a recorrência — dispensa o ical.js aqui) e `fields=items(id,summary,start,end,status)` (minimização na origem). **Processo, não código:** app OAuth com escopo sensível exige **verificação do Google**: página de privacidade publicada (a `/privacidade` abaixo), justificativa de escopo e posse do domínio comprovada no Google Search Console. Sem ela, a conexão de agenda fica limitada a **100 usuários novos** e mostra a tela de "app não verificado". A análise pode levar de semanas a meses. Começar o pedido assim que a Fase 2 estiver no ar.
- **Serviço por usuário e cache da sessão (decisão de 17/11/2026):** `calendarService` passa a ser `getWeek(userId, monday)`. Os eventos **nunca vão para o banco**, mas também não somem a cada 5 minutos. Eles ficam em memória **enquanto a pessoa está usando o app**: só são exibidos e guardados em cache.
  - **Servidor:**
    - Cache por `(userId, monday)`, só com o evento minimizado.
    - Depois de 5 min a entrada fica "velha". A próxima leitura devolve na hora o que está em cache e atualiza em segundo plano (stale-while-revalidate).
    - Se a atualização falhar por rede ou erro 5xx, continua valendo o último resultado bom, com "atualizado às HH:MM" na interface, e as bolinhas não somem.
    - Um 401/403 apaga na hora o cache daquela conexão: senha revogada é acesso encerrado.
  - **Quando sai da memória:**
    - no logout ou quando a sessão expira;
    - depois de 30 min sem nenhuma requisição nem WebSocket dessa pessoa;
    - ao desconectar a agenda, ou quando a conta é apagada ou desativada;
    - quando o servidor reinicia.

    Há também um teto global de entradas (LRU de ~5.000), só para proteger a memória. Uma entrada descartada é buscada de novo.
  - **Navegador:**
    - O TanStack Query guarda os eventos só na memória da aba (`staleTime` 5 min, `gcTime: Infinity`, `refetchOnWindowFocus`). Trocar de semana e voltar não pisca.
    - Nada vai para `localStorage` nem IndexedDB. No logout, `queryClient.clear()`.
  - **Continuam como estão:**
    - a união de requisições concorrentes;
    - a pausa de 15 min depois de 401/403, agora **por conexão** (`paused_until`).

    Depois de 3 falhas de autenticação seguidas (`auth_failures`), a conexão é apagada e a pessoa é avisada na interface para reconectar.
- **Privacidade no grupo — projeção no servidor (B5):** os eventos são **da pessoa**. No quadro compartilhado, por padrão cada um vê **só a própria agenda** (`calendar_share = 'none'`). Opt-in por quadro em dois níveis: `busy` ("ocupado", sem título) ou `titles`. A projeção é feita **na saída de `GET /api/boards/:id/calendar?week=`**, por leitor, conferindo **naquele momento** que o dono ainda é membro e ainda optou; o payload `busy` **não contém a chave `title`** (não é o cliente que esconde). Sair do quadro zera o opt-in. Nunca sai descrição, local nem participante — isso já é garantido no parse. Essa GET, como a de hoje, exige `X-Quadro-Client` (a regra "GET com efeito externo" generaliza para eventos Apple, eventos Google e discovery de calendários; o comentário em `routes/calendar.ts` muda).
- **Erros e logs (R8):** o `setErrorHandler` atual loga `{err}` inteiro; erros do `openid-client`, do `node:crypto` e da API do Google chegando crus levariam corpo e URL ao log. Todo erro de serviço externo sai embrulhado num erro tipado `{kind, status}` (como `CalendarFetchError`); o serializer do pino redige a query de `req.url` (`code`, `state`, `handle`); nunca headers nem corpo.
- **Ciclo de vida e retenção (R9):** desconectar apaga a linha, revoga o token no Google (`revoke`) e purga o cache; **a própria pessoa pode apagar a conta** (não só o admin desativar): apaga sessões, sockets, conexões, cache, convites e tarefas dos quadros pessoais, e anonimiza `actor_user_id` no `audit_log`; conta desativada apaga as conexões; conexão sem uso por 90 dias é apagada e a pessoa avisada; `audit_log` e sessões inativas anonimizados/apagados após 180 dias; linhas apagadas persistem no backup pelo prazo do Litestream (7 dias) e isso entra no aviso de privacidade. Tudo com linha no `audit_log` (sem dado da agenda).
- **Flag `--agenda` fica (contradição e):** além das conexões por usuário, o processo só fala com Apple/Google se subir com `--agenda` na linha de comando (nunca pelo `.env`). Sem a flag, `enabled: false` como hoje. É o que garante que um `npm run dev` rodado por agente, com o banco local do usuário (que terá uma conexão cifrada) e a chave de desenvolvimento, **não** dispare leitura real nem ponha títulos reais no DOM/trace. A regra do CLAUDE.md "agentes nunca ligam a agenda" continua literal; os testes seguem com fixtures escritas à mão, agora também de JSON do Google.
- **Alternativa "link de calendário público" (se mantida na interface):** não é "sem risco", é risco diferente — a URL é portadora e expõe **todos** os detalhes do evento a quem a tiver. Se entrar, é segredo e vai cifrada do mesmo jeito.

### Depois (só se pedido)
Grade de horários configurável por quadro; convite por link; notificações; exportar quadro; Postgres (quando houver segundo processo); parse de ICS em `worker_threads` (quando medido).

## O que deliberadamente **não** entra
- Microsserviços, Redis, fila/broker, Kubernetes, múltiplas instâncias.
- CRDT/Yjs: o estado é uma grade de posições com servidor decidindo; versionamento + refetch resolve.
- Mutação pelo WebSocket; GraphQL; SDK `googleapis` (3 chamadas REST com `fetch` guardado bastam).
- JWT em cookie, "lembrar senha", login por e-mail/senha.
- Cursores em pixels, gravação de cursores, "replay".
- Busca de usuários por nome/prefixo (só handle exato).

## Dependências novas previstas (versões exatas fixadas na hora de cada fase, com `npm view <pkg> time`, `npm audit` e `npm audit signatures`)
| Fase | Pacote | Para quê | Observação de segurança |
|---|---|---|---|
| 0 | `@playwright/test` (dev) | testes E2E no navegador | navegador baixado num passo explícito (`ignore-scripts` continua); só Chromium; o servidor de teste nunca sobe com `--agenda` |
| 2 | `openid-client` | OIDC do Google (login) e OAuth incremental (agenda) | faz HTTP próprio → recebe `customFetch` guardado (allowlist Google); entra na lista do CLAUDE.md de dependências que tocam conteúdo externo |
| 2 | `@fastify/cookie`, `@fastify/static`, `@fastify/rate-limit` | sessão, estáticos, limite de taxa | `@fastify/static` só sobre `web/dist`, `dotfiles: 'deny'` |
| 3 | `@fastify/websocket` (traz `ws`) | WebSocket | `ws` parseia frames de clientes não confiáveis → também entra na lista do CLAUDE.md |
| 4 | nenhuma (`node:crypto`, `fetch` guardado) | cifra e Google Calendar REST | — |

Fora do npm: Caddy e Litestream, na imagem/VM. Opcional, não adotado agora: ids opacos (UUID) para `users`/`boards`/`tasks` nas URLs — a autorização já cobre; fica como redução de superfície para depois.

## Riscos e como medir antes de complicar
- **CPU do parse de ICS (Apple):** hoje cada semana tem orçamento de 250 ms; com 500 pessoas em rajada isso trava o event loop. Mitigações em ordem: cache por pessoa (já previsto), reduzir o orçamento para 100 ms, e só então `worker_threads`. Medir com 50 agendas sintéticas antes de decidir.
- **Custódia de senhas de app da Apple:** é a decisão de maior risco do plano (acesso total ao iCloud de cada pessoa, inclusive e-mail). O revisor a considera **aceitável como decisão de produto e defensável só com as 8 condições da Fase 4** — em especial chave fora do volume do banco, claro vivo só durante uma requisição e eliminação real. Um vazamento do banco **e** da chave expõe todos; por isso o procedimento de incidente (seção "Privacidade, incidente e retenção") não é opcional.
- **Verificação do app no Google:** leva de semanas a meses. Sem ela, a conexão de agenda Google fica limitada a 100 usuários novos (o login não). Não é código, é processo, e precisa começar logo que a Fase 2 estiver no ar. Depende da `/privacidade` e da posse do domínio.
- **SQLite em um processo:** `DatabaseSync` é síncrono; uma transação longa bloqueia tudo. Regra: nada de rede dentro de transação (já é assim). Backup = Litestream; restauração testada uma vez.
- **WebSocket atrás de proxy:** Caddy precisa de timeout de idle maior que o ping (30 s) do servidor.

## Ao fim de cada fase: E2E e teste humano
Uma fase só termina depois de três passos, nesta ordem:
1. o `test-runner` aprova os testes de unidade e de integração;
2. o `e2e-validator` roda as jornadas E2E afetadas;
3. **você** segue o roteiro manual abaixo.

O roteiro manual cobre só o que um agente não pode ou não deve fazer: usar conta real, testar no celular de verdade, avaliar como o uso se sente e tomar decisões de produto.

### Fase 0 — Testes E2E
**E2E:** as 8 jornadas listadas na Fase 0.

**Você testa:**
- Rode `npm run test:e2e` uma vez na sua máquina (o primeiro uso baixa o Chromium) e confira que tudo passa.
- Abra o relatório (`npx playwright show-report`) e um trace qualquer. Só devem aparecer tarefas de teste.
- Com o seu `npm run dev` aberto, rode o E2E de novo. Os dois devem funcionar ao mesmo tempo, sem mudar as suas tarefas.

### Fase 1 — Tarefas com duração
**E2E:**
- criar uma tarefa das 05:00 às 20:00 pelo "Até";
- arrastar o bloco sobre outro do mesmo tamanho troca os dois;
- sobre um de tamanho diferente, aparece o aviso de horário ocupado;
- redimensionar pela borda até encostar na tarefa de baixo;
- no celular, a linha mostra "05:00 – 20:00".

**Você testa no desktop** (`http://127.0.0.1:5173`):
- As tarefas que você já tinha continuam iguais, com uma faixa cada.
- Crie uma tarefa das 05:00 às 20:00 pelo "Até". O cartão deve ocupar a coluna inteira, com o título visível.
- Pegue esse bloco **pela parte de baixo** e arraste. O fantasma deve acompanhar o ponteiro.
- Solte-o sobre outra tarefa do mesmo tamanho: as duas trocam de lugar. Sobre uma de tamanho diferente: aparece o aviso de horário ocupado e nada muda.
- Puxe a borda de baixo. Ela deve crescer e encolher de 30 em 30 min e parar na tarefa de baixo ou em 22:00. Soltar a borda não pode abrir o modal.
- No modal, o "Até" só oferece horários até a próxima tarefa, e trocar o início ajusta o fim.

**Você testa no celular** (janela estreita, DevTools ou `adb reverse`):
- "Dia completo" mostra uma única linha "05:00 – 20:00", sem "+ livre" nas faixas cobertas. "Dia" e "Semana" também mostram o intervalo inteiro.
- Mudar o "Até" no celular é confortável: o select abre e rola bem.

### Fase 2 — Contas, quadros e deploy
**E2E** (com o provedor de login falso, nunca o Google):
- entrar, escolher o nome de usuário e ver o handle;
- criar um grupo, convidar alguém e aceitar o convite em outro `browserContext`;
- abrir o quadro de outra pessoa pela URL dá 404;
- depois de sair, a URL pede login de novo.

**Você testa:**
- Crie o app OAuth no Google Cloud (tipo "Aplicativo da Web", com o `redirect_uri` exato) e preencha o `.env`.
- Entre com a conta do `QUADRO_ADMIN_EMAIL`, escolha o nome de usuário e confira o handle `nome_00`.
- Numa janela anônima, entre com uma conta fora do domínio permitido: nenhuma conta é criada. Com uma conta permitida, ela vira `nome_01`.
- Crie um grupo, convide `nome_01` pelo handle e aceite o convite na janela anônima.
- Na janela anônima, cole o endereço de um quadro que não é dessa conta: aparece "não encontrado".
- Saia da conta. A sessão deve acabar, e voltar pela URL deve pedir login.
- No servidor:
  - abra o app pelo domínio com HTTPS e confira que o cadeado é válido;
  - restaure o backup do Litestream uma vez, num lugar separado.
- Revise o texto da `/privacidade`, publique a página e peça a verificação do Google, que leva semanas.

### Fase 3 — Tempo real
**E2E** (dois `browserContext`, mais um contexto de celular):
- o cursor de A aparece para B;
- quando A move uma tarefa, B vê a animação;
- o celular recebe a mudança;
- depois que A remove B do grupo, B para de receber atualizações.

**Você testa** com duas contas do mesmo grupo (uma em janela anônima ou em outro computador):
- Mova o mouse numa delas. O cursor deve aparecer na outra com o handle e andar sem travar.
- Arraste uma tarefa numa delas. A outra deve ver o fantasma antes de você soltar e a tarefa andando depois.
- No celular, a mudança deve chegar com animação, sem recarregar a página.
- Desligue o Wi-Fi por alguns segundos e religue. O app deve reconectar sozinho e o quadro deve ficar igual ao da outra pessoa.
- Remova a outra pessoa do grupo. Ela deve parar de ver o quadro na hora.

### Fase 4 — Agendas por pessoa
**E2E:** só com a agenda desligada e os erros de validação do formulário de conexão. Agentes nunca ligam a agenda.

**Você testa** com as suas contas reais (só você faz isto):
- Conecte a Apple com a senha de app: a bolinha roxa aparece. Com uma senha errada, a conexão é recusada e nada fica salvo.
- Conecte o Google e escolha os calendários. Só os escolhidos devem aparecer.
- Deixe o app aberto por mais de 5 min: os eventos continuam na tela e se atualizam. Feche e volte depois de 30 min: eles são carregados de novo.
- Num grupo, a outra conta vê o seguinte:
  - com "ocupado", só "Ocupado", sem título;
  - com "títulos", o título;
  - com "nenhum", nada.
- Desconecte a agenda. Os eventos devem sumir na hora.
- Revogue a senha em account.apple.com. O app deve avisar, e os eventos devem sumir.
- Olhe o log do servidor. Ele não pode ter senha, título, e-mail nem endereço do iCloud.
- Ensaie o procedimento de incidente uma vez, com contas de teste.

## Verificação automática (por fase, pelo `test-runner`)
- **Sempre:** `npm run typecheck`, `npm test` (0 falhas, 0 pulados), `npm run test:e2e` pelo `e2e-validator` quando a fase mexe na tela (a partir da Fase 0), greps do CLAUDE.md, teste irmão para todo `.ts/.tsx`, `npm audit` e assinaturas a cada dependência nova.
- **Fase 1:** os casos listados na fase.
- **Fase 2:** testes com um **IdP falso** (nunca o Google) atrás de uma interface `IdentityProvider`; callback sem o cookie `__Host-quadro_oauth` → 400 e a sessão anterior não é reaproveitada (B6); login com `hd` fora da allowlist não cria `users` (B2); segundo login antes do `QUADRO_ADMIN_EMAIL` não vira `seq 0` (B1); rotas de quadro com 3 usuários (owner/editor/viewer e um intruso); `PATCH` em tarefa de outro quadro → **404** mesmo mandando `boardId` do próprio quadro (B3); método não seguro sem `Origin` → 403; cookie com `__Host-` e flags corretas; lookup por handle inexistente e desativado respondem igual; convite precisa de aceite; CSP do HTML sem `unsafe-inline`.
- **Fase 3:** servidor real em porta efêmera com 2 clientes `ws`: evento chega com `version` certa; versão pulada força GET; upgrade sem `Origin`, com `Origin` errado ou sem sessão é recusado; **membro removido para de receber na hora** (B4); `cursor` com `userId` forjado sai carimbado com o da sessão (R7); taxa de cursor é cortada. Carga: script descartável (no scratchpad, não no repositório) com 500 sockets a 10 Hz por 1 min, observando CPU e latência.
- **Fase 4:** testes com fixtures de CalDAV e de JSON do Google escritos à mão; `secrets.test.ts` prova que `inspect`/`JSON.stringify`/log do serviço não contêm o segredo, que `authorization()` não retém claro entre chamadas e que AAD errado falha (B7); PROPFIND de teste recusa senha errada sem gravar e respeita o rate limit (R4); credencial Apple nunca sai para host Google e vice-versa (R2); payload `busy` não contém a chave `title` e o opt-in cai ao sair do quadro (B5); desconectar purga o cache na hora (R9); entrada com mais de 5 min é devolvida na hora e atualizada em segundo plano; falha de rede mantém o último resultado bom; 401/403 apaga o cache da conexão; logout ou 30 min sem uso esvaziam tudo (testado com relógio fixo); sem `--agenda` nenhuma requisição sai mesmo com conexão no banco.
- **Privacidade e incidente:**
  - `/privacidade` abre sem login e mostra o `QUADRO_CONTACT_EMAIL`.
  - A rota de destinatários do incidente e o aviso geral respondem só ao admin; para os demais, 404, como nas outras rotas admin.
  - O aviso aparece para todos na próxima abertura.
  - O job de retenção apaga ou anonimiza exatamente o que a tabela manda, testado com relógio fixo (`fixedClock`).

## Privacidade, incidente e retenção (antes "encaminhado ao usuário")

### Página de privacidade (`/privacidade`)
**Por que ela existe:**
- A LGPD obriga a explicar a cada pessoa, em linguagem simples, o que o sistema faz com os dados dela.
- O Google **não verifica** o app sem o endereço dessa página.
- O app passa a guardar dados de outras pessoas (e-mail, tarefas, credencial de agenda) e lê agendas que citam **terceiros** ("Consulta com Dr. Fulano"). Isso deixa de ser uso particular.

É uma página estática no `web`, versionada no repositório, que responde a estas perguntas:

| Pergunta | Resposta (rascunho) |
|---|---|
| Quem é o responsável | quem opera o app (nome ou empresa), com o contato `QUADRO_CONTACT_EMAIL` |
| O que é coletado | do Google: nome, e-mail e id da conta; o que a pessoa digita (nome de usuário, tarefas, grupos); se ela conectar a agenda, a senha de app da Apple ou a autorização do Google, **cifradas** |
| O que é lido da agenda | só título, início e fim dos eventos da semana vista; descrição, local e participantes nunca saem da Apple nem do Google |
| Onde fica e por quanto tempo | a tabela de retenção abaixo; os eventos ficam só em memória, enquanto a pessoa usa o app |
| Quem vê | as tarefas, os membros do quadro; a agenda, **só a própria pessoa**, a menos que ela escolha "ocupado" ou "títulos" num grupo |
| Para que serve | mostrar o quadro e a agenda da própria pessoa; nada de anúncio, venda ou perfil |
| Direitos | ver, corrigir, desconectar a agenda e **apagar a conta** pelo próprio app; qualquer outro pedido, pelo `QUADRO_CONTACT_EMAIL` |
| Aviso específico da Apple | a senha de app vale para todo o iCloud; como revogá-la em account.apple.com |

O texto final precisa ser revisado por quem responde juridicamente pelo app (a pessoa ou a empresa que o opera). Um agente de pequeno porte (Resolução CD/ANPD nº 2/2022) não precisa nomear um encarregado formal, mas precisa manter um **canal de comunicação**, e esse canal é o `QUADRO_CONTACT_EMAIL`.

### Plano de incidente
- **Contato:** `QUADRO_CONTACT_EMAIL` no `.env`. Não é segredo: o `.env.example` ganha a chave vazia, e o usuário preenche o valor no `.env`. O endereço aparece na `/privacidade` e no rodapé do app.
- **Canal de aviso:**
  - O app já tem o e-mail de cada conta, que vem do login Google.
  - Por enquanto o app não envia e-mail sozinho, porque isso exigiria mais um segredo (SMTP) e mais uma saída de rede.
  - A rota admin `GET /api/admin/incident/recipients?provider=apple` devolve os e-mails das contas com conexão Apple, e o admin os envia em **cópia oculta** pela caixa do `QUADRO_CONTACT_EMAIL`.
  - Além disso, `POST /api/admin/notice` publica um **aviso no topo do app**, que todos veem na próxima vez que abrirem.
  - Se a base crescer além do que uma caixa envia por dia (algumas centenas num Gmail comum), o envio passa para uma API de e-mail pelo `guardedFetch`.
- **Procedimento (`docs/incidente.md`):**
  1. Tirar o app do ar ou desligar a agenda (subir sem `--agenda`).
  2. Apagar todas as linhas de `calendar_connections` e trocar a chave mestra.
  3. Revogar os tokens do Google pelo endpoint `revoke`, porque esses o app consegue revogar sozinho. As senhas da Apple, **só a própria pessoa** consegue revogar.
  4. Publicar o aviso no app e mandar o e-mail: "revogue a senha de app 'quadro-tarefas' em account.apple.com e conecte de novo".
  5. **Comunicar a ANPD e as pessoas afetadas em até 3 dias úteis** depois de saber que dados pessoais foram atingidos (Resolução CD/ANPD nº 15/2024). Para agente de pequeno porte o prazo é dobrado, 6 dias úteis. Guardar o registro do incidente.

### Prazos de retenção
"Retenção" é **por quanto tempo cada dado fica guardado depois que deixa de ser necessário**. A LGPD não permite guardar para sempre "por via das dúvidas". Os números abaixo são o padrão e vão para a `/privacidade`. Aprovar o plano aprova esses valores, e qualquer um deles pode mudar:

| Dado | Quanto tempo | O que acontece depois |
|---|---|---|
| Eventos da agenda | enquanto a pessoa está usando o app, só em memória (atualizados a cada 5 min) | somem ao sair, após 30 min sem uso, ao desconectar a agenda ou se o servidor reiniciar; nunca vão para o banco |
| Sessão de login | 30 dias sem uso (no máximo 90) | é apagada; a pessoa precisa entrar de novo |
| Conexão de agenda sem uso | 90 dias | é apagada, e a pessoa é avisada no app |
| Conta apagada pela própria pessoa | na hora | tudo some: tarefas pessoais, conexões, sessões, convites |
| Registro de auditoria | 180 dias | é anonimizado (perde quem fez) |
| Backup (Litestream) | 7 dias | o que foi apagado some também do backup ao fim do prazo |

Um job diário no próprio processo, sem cron externo, aplica a tabela, lendo a hora pelo `server/src/clock.ts`.

**Admin `_00` público (O7):** o handle torna o admin identificável. O plano apenas não acrescenta um selo de admin na interface; a decisão é do usuário.

## Revisão de segurança (`cybersecurity-reviewer`, 17/11/2026)
Skills consultadas pelo revisor: personal-data, personal-data-backend, session-auth, session-auth-backend, integration-keys, dynamic-contents, hardening-base.

**Bloqueantes (todos incorporados):**
- **B1** admin por "primeira conta" era corrida → `QUADRO_ADMIN_EMAIL` (Fase 2).
- **B2** cadastro aberto → `hd` e/ou aprovação do admin (Fase 2).
- **B3** `boardId` do cliente em `PATCH/DELETE/PUT :id` era IDOR → `board_id` lido da linha; 404 (Fase 2).
- **B4** membro removido continuava no socket → `evict`/`evictSession` (Fase 3).
- **B5** "ocupado" sem dizer onde o título sai → projeção por leitor no servidor (Fase 4).
- **B6** `state`/`nonce`/`verifier` sem vínculo com o navegador → cookie `__Host-quadro_oauth` (Fase 2).
- **B7** chave mestra no `.env` junto do banco e header Basic retido na memória → `QUADRO_MASTER_KEY_FILE`, decifra por chamada, Apple ID no ciphertext, AAD com `connection_id` (Fase 4).

**Recomendados (todos incorporados):** R1 `Origin` obrigatório em método não seguro, `__Host-`, logout `POST`, `Origin` exata no upgrade; R2 allowlist por provedor e `customFetch` no `openid-client`; R3 `email_verified`/`hd`/escopo concedido, `offline`+`consent`, access token só em memória, client secret em closure; R4 rate limit no PROPFIND de teste; R5 lookup por `POST`, rate limit, resposta idêntica, sem handle no log; R6 convite com aceite, quadro pessoal recusa membros, owner não se remove; R7 identidade carimbada pelo servidor na presença; R8 erros tipados e `redact` da query; R9 eliminação pela própria pessoa, retenção, purga de cache, Litestream curto, rotação de chave; R10 admin sem acesso a dados, desativar = apagar tudo; R11 CSP do HTML, `injectCSS: false`, `@fastify/static` restrito, `trustProxy: '127.0.0.1'`.

**Opcionais:** O2 zod em `boards.name`/`label` (adotado); O3 `X-Quadro-Client` em toda GET com efeito externo (adotado); O4 teto de tarefas e rate limit de mutação (adotado); O5 `secure_delete` (adotado); O6 nada do TanStack Query no `localStorage` (já é a regra); O1 ids opacos (não adotado agora); O7 (encaminhado).

**Decisão (a) — custódia de senha de app:** "aceitável como decisão de produto; defensável só com o mínimo" das 8 condições da Fase 4. Sem 1, 3 e 6 o revisor não aprova; com as oito, aprova.

**Contradições com o CLAUDE.md/código, e como ficaram:** (a) loopback × Caddy → mesmo namespace de rede; (b) `Host` com porta obrigatória → regex e testes do guard mudam; (c) "`guardedFetch` é a única chamada a `fetch`" → `openid-client` via `customFetch` guardado e `ws` listados no CLAUDE.md; (d) escopo do Google inconsistente → `events.readonly` + `calendarlist.readonly`; (e) remover `--agenda` quebraria "agentes nunca ligam a agenda" → a flag fica como interruptor de processo; (f) "o app não tem autenticação" → CLAUDE.md reescrito na Fase 2; (g) "decifra só na leitura" × closure permanente atual → decifra por chamada; (h) "nenhuma chave é obrigatória" no `.env.example` → passa a dizer quais são obrigatórias em produção, e a chave mestra não entra nele; (i) comentário "única GET com efeito externo" → regra generalizada.
