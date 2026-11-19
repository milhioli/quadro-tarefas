<!-- Plano aprovado da Fase 2a (18/11/2026). O andamento fica em docs/roteiro.md. -->
# Plano — Fase 2a: contas, quadros e grupos (local, 127.0.0.1)

## Contexto
O roteiro (`docs/roteiro.md`) leva o quadro de "uma pessoa, sem login" para multiusuário. As fases 0 (E2E) e 1 (duração) estão prontas e no GitHub.

Em 18/11/2026 o usuário decidiu:
- **Escopo 2a:** contas e quadros compartilhados rodando no 127.0.0.1, com **login Google de verdade**. O deploy fica para a 2b.
- **Cadastro aberto:** qualquer conta Google cria conta. A revisão de segurança tinha marcado isso como bloqueante (B2 da Fase 2). Agora o veredito é **aceitável na 2a**, porque no 127.0.0.1 "aberto" quer dizer "contas usadas nesta máquina". O mínimo para abrir na 2b fica registrado (ver "Fica para a 2b").

**Resultado:**
- A pessoa entra com Google, escolhe nome de usuário e nome de exibição e recebe o handle `nome_NN`.
- Ela tem o quadro pessoal e pode criar grupos, convidar por handle (com aceite) e trabalhar no quadro do grupo.
- Toda autorização é decidida no servidor.
- As tarefas de hoje viram o quadro pessoal do admin (`_00`).

Duas revisões já foram incorporadas: a leitura do código e das bibliotecas (agente de planejamento) e o `cybersecurity-reviewer`, com 3 bloqueantes, 11 recomendados e 5 opcionais.

## Escopo da 2a
- **Fica:**
  - login Google e o entrypoint de E2E;
  - sessões;
  - handle com `seq 0` reservado;
  - quadro pessoal e o quadro legado;
  - grupos (criar, renomear, apagar);
  - convite com aceite e recusa;
  - membros (listar, remover, sair);
  - tarefas por quadro sem IDOR;
  - `Origin` obrigatório;
  - agenda só para o admin;
  - log redigido;
  - E2E logado.
- **Vai para a 2b (antes de qualquer exposição na rede, que fica proibida até lá):**
  - telas e rotas de admin (listar e desativar), com `audit_log` do acesso (R10);
  - rate limit e tetos contra contas em série, convites e grupos, e o bloqueio de reconvite depois de uma recusa (R7);
  - `DELETE /me` com a limpeza completa (R9);
  - lookup de usuário, papel e passagem de posse;
  - `/privacidade` e `QUADRO_CONTACT_EMAIL` publicados;
  - cookie `__Host-` com `Secure`.

## Decisões de desenho
### Login (Google)
- `openid-client` 6.8.9, com authorization code, PKCE e nonce. Os escopos são só `openid email profile`, que não exigem verificação do app no Google.
  - `discovery(new URL('https://accounts.google.com'), clientId, undefined, clientAuth, { [customFetch]: oidcFetch, timeout: 10, execute: [enableNonRepudiationChecks] })`.
  - O `enableNonRepudiationChecks` confere a assinatura do ID token pelo JWKS. Sem ele, a assinatura não é verificada.
- O discovery roda em segundo plano na subida. Uma falha não derruba o servidor; ela só deixa o login indisponível com mensagem.
- **O segredo do cliente:** um `ClientAuth` próprio faz `body.set('client_secret', readSecret())`, e o segredo vive só na nossa closure. Ele é apagado do `env` na leitura e recusado se `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- **O `email_verified`** é conferido no nosso serviço, não no provider: o IdP falso dos testes também passa por essa checagem. As claims passam por zod.
- **Todo erro** do provider sai como `IdentityError({kind})`, sem `cause`, corpo, URL nem claims (R1).

### Rede de saída (R2)
- `server/src/calendar/guardedFetch.ts` ganha `allowedUrl(provider, …)` com uma **allowlist por provedor**:
  - `apple`: os hosts de hoje;
  - `google`: `accounts.google.com`, `oauth2.googleapis.com` e `www.googleapis.com`.
- Ganha também `createOidcFetch()`:
  - só `GET` e `POST`;
  - `redirect: 'manual'`, e qualquer 3xx vira erro;
  - timeout de 10 s e corpo de até 256 KiB, lido pelo stream;
  - devolve um `Response` com só `content-type`, `cache-control`, `www-authenticate` e `retry-after`.
- O CalDAV não muda. O único `fetch(` de `server/src` continua nesse arquivo (`networkFetch`).
- Testes de provedor cruzado: um host da Apple é recusado no fetch do Google, e um do Google no da Apple.

### Vínculo do login com o navegador (B6 anterior, confirmado pelo revisor)
- `state`, `nonce`, `code_verifier` e `next` ficam **no servidor**, num mapa em memória com TTL de 10 min e teto de entradas. Com o mapa cheio, entradas novas são recusadas.
- O navegador guarda só um id aleatório no cookie `quadro_oauth` (HttpOnly, SameSite=Lax, Path=/api/auth).
- **No callback, nesta ordem:**
  1. acha a entrada pelo **id do cookie** e a apaga, mesmo que a troca falhe, limpando o cookie;
  2. confere o `state` da query contra o guardado, antes do provider;
  3. troca o code com `redirect_uri = new URL('/api/auth/google/callback' + search, APP_ORIGIN)`, que nunca vem do `Host`;
  4. confere o `email_verified`;
  5. recusa conta desativada;
  6. apaga a sessão anterior do cookie e emite uma nova.
- Qualquer erro no callback responde 303 para `/?login=erro`, sem cookie de sessão.
- **`/auth/google/start`:**
  - exige `Sec-Fetch-Site` igual a `same-origin` ou `none` (O3);
  - se o `Host` for diferente do host do `APP_ORIGIN`, redireciona para o `APP_ORIGIN`;
  - o `next` aceita só `^/(?![/\\])` com a mesma origem do `APP_ORIGIN`; se falhar, vai para `/` (R4).
- O callback é por query (GET). Não usar `form_post`, porque o guard recusaria o POST do Google.

### Sessão
- Cookie `quadro_session` (HttpOnly, SameSite=Lax, Path=/), com 256 bits aleatórios; o banco guarda o **sha256**.
- Expira com 30 dias sem uso e no máximo com 90. O `last_seen` é renovado no máximo uma vez por hora.
- A sessão expirada é apagada quando detectada (O5).
- O logout é `POST` sem corpo; o cliente zera o cache (`queryClient.clear()`) no logout, em todo 401 e depois de cada login (R5).
- A validação da sessão confere `status='active'` a cada requisição (B3).
- **Negação por padrão (R11):** um hook na raiz exige sessão em toda rota que não for de uma lista pública fechada: `/api/health`, `/api/auth/methods`, `/api/auth/google/start` e `/api/auth/google/callback`. O teste de `onRoute` falha se aparecer uma rota fora dessa lista sem exigir sessão.
- Quem ainda não escolheu o username tem sessão, mas só alcança as rotas marcadas `allowPending` (`/me`, `/me/profile` e `/auth/logout`). As outras respondem 403 `NEEDS_USERNAME`.
- **Cookie e porta (O1):** no 127.0.0.1 o cookie não separa porta, então a defesa entre projetos locais é o guard. Teste: cookie válido com `Origin: http://127.0.0.1:3000` dá 403. A nota vai para o CLAUDE.md e para o roteiro.

### Identidade e handle (R3, R8, O2)
- O usuário é achado **só por `google_sub`**. `role='admin'` e `seq 0` são gravados uma vez só, na criação do perfil, e só se o e-mail verificado for igual a `QUADRO_ADMIN_EMAIL` e ainda não existir ninguém com o `seq 0`. Depois disso, nada é recalculado pelo e-mail.
- O `seq` dos demais sai de um contador que nunca desce (tabela `counters`), começando em 1.
- **Primeiro acesso (`POST /me/profile`):**
  - `username` em `[a-z0-9._]`, de 3 a 20, com uma lista reservada (`admin`, `suporte`, `quadro`, `root`, `sistema`);
  - **nome de exibição** de 1 a 40, pré-preenchido com o `given_name`. É o único nome que outras pessoas veem; o nome completo do Google não é guardado.
- O zod do `shared` recusa as categorias Unicode `Cc` e `Cf` (controles e bidi) no nome de exibição e no nome de quadro. O handle é renderizado num `<bdi>`.

### Quadros e membros (R6)
- O acesso vem **só de `board_members`**, inclusive o do owner do quadro pessoal. A checagem é um helper único: `requireMember(boardId, userId, minRole)`.
- `boards.owner_user_id` existe só no pessoal: garante um quadro por pessoa e apaga em cascata.
- Os papéis são `owner` e `editor`, com um owner por quadro (índice único parcial). O pessoal não aceita membros (trigger). O `viewer` fica para depois.
- **Convite:** `POST /boards/:id/invites {handle}`, só o owner. Handle inexistente e conta desativada recebem o mesmo 404. O convidado vê só o nome do quadro e o handle de quem convidou, e aceita ou recusa.
- `GET /boards/:id/members` exige membro **ativo**. O owner remove membros; o membro sai sozinho; o owner sai apagando o grupo.
- **Sem IDOR (B3 anterior):** em `/api/tasks/:id` e `.../position`, uma consulta só decide existência e acesso:
  ```sql
  SELECT t.board_id FROM tasks t
  JOIN board_members m ON m.board_id = t.board_id AND m.user_id = ? AND m.status = 'active'
  WHERE t.id = ?
  ```
  O nulo responde **404**, o mesmo para "não existe" e "não é seu". Um trigger impede a tarefa de mudar de quadro.
- `boards.version` é incrementado em toda mutação real, já preparando a Fase 3.

### Guard e erros
- Método não seguro **sem `Origin`** passa a dar 403 (R1 anterior). O GET continua aceitando a ausência de `Origin`, porque o callback do Google chega sem ela.
- O `testApp` e as fixtures do E2E passam a mandar `Origin`.
- `ApiErrorCode` ganha `UNAUTHENTICATED` (401) e `NEEDS_USERNAME` (403).
- `GET /api/me` responde `200 {user: null}` para quem não tem sessão, porque o Chromium escreveria um 401 no console, e a fixture reprovaria as jornadas.
- **Log:** `serializers.req` grava só o caminho, sem a query (nem `code`, nem `state`). O teste captura o log e procura `code`, `state`, e-mail, `sub`, `id_token`, `access_token`, o secret e `Set-Cookie`.

### Agenda da Apple na 2a
A credencial continua global (`--agenda`). A rota responde `enabled:false` sem chamar o `getWeek` para quem não tem `role='admin'`, lido do banco. A agenda por pessoa é a Fase 4.

### Login de desenvolvimento (B1 e B2 do revisor)
- **Entrypoint separado, `server/src/e2eEntry.ts`.** O `index.ts` não conhece o login de desenvolvimento.
- **Ele recusa subir quando:**
  - o `NODE_ENV` não está na allowlist (ausente, `development` ou `test`);
  - o `APP_ORIGIN` não é loopback;
  - o `DB_PATH` está ausente ou é o `DEFAULT_DB_PATH`;
  - há `GOOGLE_CLIENT_SECRET` ou `ICLOUD_*` no ambiente;
  - o banco tem algum usuário cujo `sub` não começa com `dev:`.
- Ele também nunca lê o `.env`, nunca liga a agenda e desliga o login Google.
- **`POST /api/auth/dev/login {email}`:** aceita só `*@example.com`, com `google_sub = 'dev:' + email`.
  - A conta só vira admin se o `QUADRO_ADMIN_EMAIL` vindo do Playwright for `admin@example.com`.
  - Corpo com `role` ou `seq` dá 400.
- **No servidor normal (`index.ts`):**
  - uma sessão de usuário `dev:` dá 401;
  - o callback do Google recusa `sub` com o prefixo `dev:`;
  - `/api/auth/dev/*` dá 404, porque a rota nem é registrada.
- **Scripts:**
  - server: `"dev:e2e": "tsx src/e2eEntry.ts"`, sem watch, porque um reinício apagaria os logins pendentes;
  - raiz: `dev:e2e` com o `concurrently`.

  Um teste estático confere que só o script `dev:e2e` cita o `e2eEntry`.

## Modelo de dados: migração 3
O SQL está validado pelo agente de planejamento e é aplicado como uma string em `MIGRATIONS`, dentro da transação do `migrate()`, com `foreign_keys = ON`:
- **Tabelas novas:**
  - **`users`:** `google_sub UNIQUE`, `email`, `display_name`, `username`, `seq UNIQUE`, `role`, `status`, `created_at` e `last_seen_at`. Os CHECKs são `(username IS NULL) = (seq IS NULL)`, `role = 'user' OR seq IS 0` e `username NOT GLOB '*[^a-z0-9._]*'`.
  - **`sessions`:** `id_hash` (64), `user_id` com cascade, `created_at`, `expires_at` e `last_seen_at`.
  - **`boards`:** `name` de 1 a 60, `kind`, `owner_user_id` (só no pessoal), `version` e `created_at`. Índice único "um pessoal por dono".
  - **`board_members`:** `role`, `status`, `invited_by` (SET NULL) e `created_at`. Um owner por quadro, e o trigger "quadro pessoal não aceita membros".
  - **`counters`:** com `next_user_seq = 1`.
  - **`audit_log`:** `actor_user_id` (SET NULL). Já recebe login, convite, aceite, remoção e saída; a leitura pelo admin é da 2b.
- **O quadro legado:** `INSERT INTO boards (id 1, 'Meu quadro', 'personal', owner NULL)` acontece **antes** da cópia das tarefas.
- **`tasks` recriada** com `board_id NOT NULL` (cascade) e `created_by` (SET NULL):
  - a cópia é `INSERT … SELECT … 1`, mantendo os ids e o `sqlite_sequence`;
  - os índices passam a ser `(board_id, day, slot)` único e `(board_id, deck_order)`;
  - os triggers `tasks_no_overlap_*` filtram por `board_id`;
  - um trigger novo, `tasks_board_immutable`, impede a tarefa de mudar de quadro.
- **Reclamar o legado:** no `POST /me/profile` do admin, em `BEGIN IMMEDIATE`, roda `UPDATE boards SET owner_user_id=? WHERE id=1 AND owner_user_id IS NULL`, mais a linha de owner em `board_members`. Os demais ganham um quadro pessoal novo.

## API (`/api`; sessão obrigatória salvo a lista pública)
| Rota | Quem |
|---|---|
| `GET /auth/methods`, `GET /auth/google/start`, `GET /auth/google/callback` | público |
| `POST /auth/logout` | sessão |
| `GET /me` (`{user}` ou `{user:null}`), `POST /me/profile` `{username, displayName}` | sessão, inclusive pendente |
| `GET /boards`, `POST /boards` `{name}` | sessão |
| `PATCH /boards/:id` `{name}`, `DELETE /boards/:id` (só grupo) | owner |
| `GET /boards/:id/tasks`, `POST /boards/:id/tasks`, `POST /boards/:id/reset` | membro ativo |
| `GET/PATCH/DELETE /tasks/:id`, `PUT /tasks/:id/position` | membro ativo do quadro **da linha** |
| `GET /boards/:id/members` | membro ativo |
| `POST /boards/:id/invites` `{handle}`, `DELETE /boards/:id/members/:userId` | owner (remover); o próprio membro (sair) |
| `GET /invites`, `POST /invites/:boardId/accept` ou `decline` (sem corpo) | sessão |
| `GET /calendar/events` | sessão; `enabled:false` para quem não é admin |
| `POST /auth/dev/login` | só no `e2eEntry` |

- Saem `GET/POST /api/tasks` e `POST /api/board/reset`.
- `Task` ganha `boardId`.
- As regras de `shared/src/move.ts` não mudam: são aplicadas ao estado de um quadro só (`readPositions(boardId)`).

## Código: o que muda e onde
- **shared (`schemas.ts`):**
  - `usernameSchema`, `displayNameSchema` e `boardNameSchema`, sem `Cc`/`Cf`;
  - `handle` com formatar e analisar;
  - `Me`, `Board`, `Member`, `Invite` e `Task.boardId`;
  - os códigos de erro novos.
- **server:**
  - **configuração e identidade:**
    - `auth/config.ts` (`loadAuthConfig`, espelhando `calendar/config.ts`; `APP_ORIGIN` com padrão `http://127.0.0.1:${webPort}`, que precisa estar nas origens do guard);
    - `auth/googleProvider.ts`;
    - `auth/identity.ts` (o `IdentityProvider` e o `IdentityError`);
  - **login e sessão:**
    - `auth/pendingLogins.ts` (o mapa com TTL);
    - `auth/session.ts` (o hook de sessão e a negação por padrão);
    - `routes/auth.ts`;
  - **repositórios:** `users`, `sessions`, `boards` e `members`; o `taskRepository` vira um `TaskStore` com `forBoard(boardId, actorId)` e `boardOf(id)`;
  - **rotas:** `routes/boards.ts` e `routes/invites.ts`; `routes/tasks.ts` e `routes/calendar.ts` ajustados;
  - **o resto:**
    - `http/guard.ts` (`Origin` exigido);
    - `app.ts`, com a ordem `headers → guard → erros → cookie → sessão → rotas`;
    - `index.ts`;
    - `e2eEntry.ts`;
    - `test/helpers/testApp.ts` (entra como admin pela API pública, `t.signIn(email)` para o segundo usuário, cookie e `Origin` automáticos) e `test/helpers/fakeIdentity.ts`.
- **web:**
  - `api/client.ts`, com as rotas por quadro e as de conta;
  - `api/BoardContext.tsx`, com `useBoardId()`;
  - `api/queries.ts`, com a chave `['boards', id, 'tasks']`, sem retry para 4xx e com 401 limpando a sessão;
  - `Shell.tsx`, que decide entre login, primeiro acesso e app;
  - `components/auth/LoginScreen` e `ProfileScreen`;
  - `components/session/SessionBar`, com o handle num `<bdi>` e o "Sair";
  - `BoardPicker`, `GroupModal` (membros, convidar, remover, sair, renomear, apagar) e `InvitesModal`;
  - o `App.tsx` atual não muda e vira a área do quadro escolhido (`<BoardProvider><App key={boardId}/></BoardProvider>`);
  - o `localStorage` guarda só `quadro:board`, validado contra "meus quadros";
  - os testes atuais continuam com o `createWrapper(api, qc, boardId = 1)`;
  - o `fakeApi` filtra por quadro e tem `me` e `setMe`.
- **e2e:**
  - `ports.ts` (as fixtures não importam o config);
  - o fixture `request` passa a ser o `page.request`, que compartilha os cookies com a página;
  - a fixture `account` faz login com um e-mail único por teste (`e2e-<testId>-<repeat>@example.com`), e o quadro pessoal de cada um isola os dados. A `cleanDatabase` sai;
  - `CLIENT_HEADERS` ganha `Origin`;
  - o `webServer` usa `npm run dev:e2e`, com `APP_ORIGIN = BASE_URL` e `QUADRO_ADMIN_EMAIL = admin@example.com`;
  - o comentário "sempre `npm run dev`" é atualizado.

## Dependências (exatas, com pelo menos 2 semanas em 18/11/2026)
- `openid-client` 6.8.9 (02/11), que traz `oauth4webapi` 3.8.8;
- `jose` fixado em 6.2.15 (01/11) por `overrides` na raiz, porque a 6.2.17 tem 9 dias;
- `@fastify/cookie` 11.1.5 (27/10), que traz `fastify-plugin` 6.0.1.

São 5 pacotes novos no lockfile, nenhum com script de instalação. Depois do install, `npm ls`, `npm audit` e `npm audit signatures`. O `CLAUDE.md` passa a listar `openid-client`, `oauth4webapi`, `jose` e `@fastify/cookie` entre as dependências que tocam conteúdo externo.

## Configuração (`.env.example`; agentes nunca leem o `.env`)
`APP_ORIGIN`, `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (os dois juntos ou nenhum) e `QUADRO_ADMIN_EMAIL` (com trim e em minúsculas). Sem o Google configurado, a tela de login diz o que falta. O README explica como criar o OAuth client "Aplicativo da Web" com o redirect `http://127.0.0.1:5173/api/auth/google/callback`.

## Ordem de implementação (cada passo vai para o `test-runner` antes do seguinte)
0. Andamento no `docs/roteiro.md`: a 2a aprovada, o cadastro aberto com as mitigações e o que fica para a 2b, mais duas notas:
   - **Fase 4:** decidir se conectar a agenda da Apple exige aprovação do admin;
   - **o cookie entre portas.**
1. Dependências e o override do `jose`; a suíte atual continua verde.
2. Guard com `Origin` obrigatório, o `testApp` e o E2E mandando `Origin`; tudo verde sem outra mudança.
3. `guardedFetch` generalizado, com os testes de provedor cruzado; o CalDAV intocado.
4. Os schemas e tipos do `shared`.
5. A migração 3 e o `migrations.test.ts`. Corrigir o helper `insert` com `board_id`: hoje os 8 `rejeita %s` passariam pelo motivo errado. A v2 passa a ser testada com `MIGRATIONS.slice(0, 2)`.
6. O `TaskStore` (`forBoard`, `boardOf`, `version`); as rotas antigas usam `forBoard(1)` temporariamente.
7. O `auth/config.ts`, o `index.ts` e o `e2eEntry.ts`, com os testes de recusa de subida.
8. Login e sessão: os repositórios, o cookie, o hook, as rotas de auth e de `/me`, o `testApp` com login e a auditoria do 401.
9. As rotas por quadro, saindo as antigas; IDOR, agenda só para o admin e o serializer do log.
10. Quadros, membros e convites, mais o `audit_log`.
11. O provider Google com um `fetch` falso: discovery, token e JWKS assinados por uma chave RSA gerada no teste com `node:crypto`, e os tempos tirados de `systemNow()` do `clock.ts`. Depois, o `start` e o `callback` com o IdP falso.
12. Web:
    1. `client`, `fakeApi`, `BoardContext` e `queries`, com os testes atuais verdes;
    2. `Shell`, login e perfil;
    3. o seletor de quadro;
    4. o modal do grupo e os convites.
13. E2E:
    1. as 12 jornadas atuais verdes, agora logadas;
    2. as jornadas novas.
14. Documentação:
    - `CLAUDE.md`: a premissa de autenticação, o contrato com as URLs novas (logout, aceitar e `reset` vão sem corpo), as regras de sessão, IDOR e `e2eEntry`, a rede de saída por provedor, as dependências e o cookie entre portas. Mantém a proibição de `--host`, túnel e IP de rede até a 2b;
    - README e `.env.example`;
    - o andamento do roteiro, inclusive as correções que o revisor listou: B2, `__Host-quadro_oauth`, `viewer` e R10.
15. Teste humano e commit (só com o pedido do usuário).

## Testes essenciais
- **server:**
  - **migração e repositório:** a migração v2→v3 com dados (`foreign_key_check` vazio, a mesma célula em outro quadro aceita, a tarefa não muda de quadro, apagar o quadro apaga as tarefas); o `seq 0` do admin mesmo entrando por último; um segundo `sub` com o e-mail do admin vira usuário comum;
  - **login:**
    - IdP falso: callback sem cookie, com `state` errado ou reutilizado, ou com `email_verified=false` dá 303 sem sessão; a sessão é nova a cada login; o desativado não entra;
    - provider Google: JWKS e assinatura conferidos, host fora da lista recusado, o teste falha se `globalThis.fetch` for chamado, `inspect` sem o secret;
    - o `next` aberto (`//evil.com`, `/\evil.com`, `/%2F%2Fevil.com`, `https://evil.com`, `javascript:`) vai para `/`;
  - **acesso:**
    - IDOR, inclusive o admin como intruso: `PATCH` em tarefa de outro quadro com o próprio `boardId` dá 404;
    - convites, sair e remover; o convidado pendente não lista membros;
    - mutação sem `Origin` dá 403; cookie com `Origin :3000` dá 403;
    - `NEEDS_USERNAME`;
    - a agenda não chama o `getWeek` para quem não é admin;
    - o log sem segredos;
  - **`e2eEntry`:** todas as recusas de subida, mais "a sessão `dev:` dá 401 no servidor normal" e "o `/auth/dev/*` dá 404 no servidor normal".
- **web:** login, perfil, seletor, grupo e convites com a API fake; o 401 leva ao login e limpa o cache; a troca de conta não mostra os dados da conta anterior; os nomes com bidi não chegam à tela.
- **shared:** os schemas novos, inclusive `Cc`/`Cf`.

## Verificação
- `test-runner`: typecheck (5 alvos), `npm test`, testes irmãos, greps do CLAUDE.md, audit e assinaturas.
- E2E: o `e2e-validator` roda as jornadas afetadas. Se recusar pela regra do runbook, o usuário roda `npm run test:e2e`.
- **Teste humano:**
  1. criar o OAuth client e preencher o `.env`;
  2. entrar com o e-mail do admin e ver o `nome_00` e as tarefas de antes;
  3. numa janela anônima, entrar com outra conta e ver o `_01`;
  4. criar um grupo, convidar e aceitar;
  5. na janela anônima, abrir `http://127.0.0.1:5173/api/boards/1/tasks` e ver o 404;
  6. sair e ver que a URL pede login.
