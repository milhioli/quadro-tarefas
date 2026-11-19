# Quadro de tarefas

Quadro semanal em pt-BR, com contas (login Google), quadro pessoal e grupos. O desenvolvimento roda só em `127.0.0.1`; fora da máquina, só pelo pacote de deploy (`deploy/`, Fase 2b; ver "Produção e deploy"). Em cada quadro: deck de tarefas à esquerda e quadro à direita, com colunas de segunda a sexta e 34 linhas de 30 min (`05:00 – 05:30` a `21:30 – 22:00`). Uma tarefa ocupa `span` slots seguidos (1 a 34) a partir de `slot`. Arrastar move a tarefa; soltar sobre outra do mesmo tamanho troca as duas, e sobre qualquer outra sobreposição o servidor recusa com 409. O "Resetar quadro" devolve tudo ao deck. Cada tarefa tem um modal com editor rico (TipTap) que permite checklist.

- O repositório usa npm workspaces: `shared/` (regras puras e zod), `server/` (Fastify + `node:sqlite`) e `web/` (React + Vite).
- Exige Node ≥ 24.
- O plano original (13/11/2026) é a referência das decisões de base: `docs/plano-original.md`. Ele tem stack, schema, API, regras de troca, casos de teste do calendário, segurança e verificação manual. O que mudou depois está em `docs/roteiro.md`.
- O roteiro da evolução multiusuário está em `docs/roteiro.md`. Ele define as fases 0 a 4 e, para cada uma, os E2E e o teste humano. Siga a ordem das fases e atualize o arquivo quando uma decisão mudar.
- **Sempre atualize o andamento do plano.** Atualize a seção "Andamento" do `docs/roteiro.md` na mesma leva de mudanças sempre que acontecer uma destas:
  - uma etapa terminar (fase, subetapa ou plano aprovado);
  - uma decisão nova for tomada;
  - uma correção relevante for feita;
  - uma validação passar ou falhar.

  Registre o que foi feito, quem validou e com que resultado, o que falta e qual é o próximo passo. Em seguida, diga ao usuário numa linha o que mudou no andamento. Quando a etapa tiver commit, o andamento vai no mesmo commit.
- O remoto é `origin` = `https://github.com/milhioli/quadro-tarefas.git`, na branch `main`. Commit e push só quando o usuário pedir.

## Regras deste projeto
- O agente principal não roda testes, typecheck, `git diff` nem `git status`. A validação vai para o subagente `test-runner`; se o Stop hook pedir, vai também para o `e2e-validator`.
- Nunca leia `.env`. Use o `.env.example`. O mesmo vale para o arquivo de ambiente do deploy (`deploy/.env`, `%USERPROFILE%\.quadro\deploy.env` ou `/etc/quadro/deploy.env`): use o `deploy/.env.example`.
- As versões são exatas e o `.npmrc` tem `ignore-scripts=true`. Nenhuma dependência fora da tabela do plano entra sem revisão. As dependências de runtime que tocam conteúdo externo ficam só no `server`:
  - `sax` 1.6.1 e `ical.js` 2.2.1 (agenda da Apple);
  - `openid-client` 6.8.9, com `oauth4webapi` 3.8.8 e `jose` fixado em 6.2.15 por `overrides` na raiz (login Google);
  - `@fastify/cookie` 11.1.5 (lê o cookie da sessão).
  - O `tsx` 4.23.15 também é dependência de runtime do `server` (roda o TypeScript em produção: `node --import tsx`).
  - Limites de taxa e estáticos são código próprio (`server/src/http/rateLimit.ts` e `webDist.ts`): nada de `@fastify/rate-limit` nem `@fastify/static`.
- `new Date()` sem argumento só pode aparecer em `server/src/clock.ts` e `web/src/lib/clock.ts`, inclusive nos testes. Para datas fixas use `new Date(2026, 10, 13, 12)` ou `fixedClock(...)`. Menções em texto neste arquivo e em `docs/` não contam.
- Estes termos devem ter 0 ocorrências:
  - `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(` e `new Function`
  - `0.0.0.0`, `host: true`, `--host`, `'::'`, `allowedHosts`, `changeOrigin: true` e `@fastify/cors`
  - Exceções aceitas: este arquivo, os `.md` de `docs/` (descrevem as regras), `web/vite.config.test.ts` (afirma que `allowedHosts` é `undefined`), `server/src/config.test.ts` e `server/src/http/guard.test.ts` (testam que `0.0.0.0` é ignorado ou rejeitado).
  - Os arquivos de `deploy/`, o `.dockerignore` e o `README.md` **não** são exceção. No compose, as portas usam `${BIND_IP}`; no código de IPv6, a divisão é por regex, nunca o literal `'::'` entre aspas.
- Todo `.ts`/`.tsx` tem um `*.test.ts(x)` irmão. As exceções são os helpers em `server/test/helpers/` e `web/src/test/`, e a pasta `e2e/`, onde os próprios arquivos já são testes.
- Os testes da API rodam contra SQLite real em arquivo temporário, sem mock do banco. O `createTestApp` entra como admin pelo login de desenvolvimento, e `t.signIn(email)` traz uma segunda pessoa. O login Google é testado com o IdP falso (`server/test/helpers/fakeIdentity.ts`), e o provider com um Google falso que assina o ID token com uma chave RSA do próprio teste.
- No web, testes de componente usam a API fake (`web/src/test/fakeApi.ts`) injetada via `ApiProvider`. Ela guarda as tarefas por quadro e o estado de conta (`setMe`, `setBoards`, `setMembers`, `setInvites`, `addPerson`, `setInfo`, `setAccounts`).
- Nos testes da API, `createTestApp` aceita `now` (relógio mutável), `rateLimits` e `taskLimits` (números menores para testar os limites) e `publicOrigin` (simula o deploy: guard público, cookies `__Host-`, `trustProxy`).

## Ambiente do Claude Code (fora do repositório)
- O fluxo deste arquivo pressupõe a configuração global do usuário em `~/.claude`:
  - os agentes `test-runner`, `e2e-validator` e `cybersecurity-reviewer`;
  - os hooks que impedem o agente principal de rodar testes e exigem a validação antes de encerrar.
- Se algum deles não existir na máquina, **avise o usuário**. Não rode os testes no agente principal para compensar.
- O runbook da skill `e2e-validation` ainda não cobre este projeto. O `e2e-validator` pode recusar a suíte inteira ou o `--repeat-each`. Nesse caso, peça ao usuário para rodar `npm run test:e2e`, em vez de contornar com outro agente.
- No Windows, a ferramenta Bash (Git Bash) transforma `\\` em `\` dentro de heredoc e às vezes falha em blocos longos. Grave regex, escapes e caminhos com Write/Edit, e depois confira com Grep por `\\`.
- Memórias locais do Claude não vão para outra máquina. O que precisa sobreviver fica neste arquivo ou em `docs/`.
- **Docker (pacote de deploy):** agentes podem rodar `docker build -f deploy/Dockerfile .`, `docker compose --env-file deploy/.env.example -f deploy/compose.yaml config --quiet` e `caddy validate` com variáveis fictícias. Agentes **nunca** leem o arquivo de ambiente do deploy, sobem o compose com ele, montam/copiam/leem os volumes do deploy (há contas reais no banco e a chave da CA local no `caddy_data`) nem rodam `docker logs`, `docker inspect` ou `exec env` no stack real. Se o Docker Desktop estiver parado, peça ao usuário para abri-lo; não o inicie por conta própria.

## E2E (Playwright, pasta `e2e/`)
- `npm run test:e2e` sobe dois servidores, cada um com um banco novo numa pasta temporária. Nenhum usa `dev:agenda` nem `--agenda`, e nenhum toca no `server/data/quadro.sqlite`:
  - o `npm run dev:e2e`, nas portas 3101 (API) e 5273 (Vite), para os projetos `desktop` e `mobile`;
  - o `npm run dev:e2e:static` (build do web + `e2eEntry --static`), na porta única 3201, para o projeto `producao`. Ele roda as jornadas marcadas com `{ tag: '@producao' }` contra o build servido pelo Fastify, o único lugar com a CSP estrita do HTML. Jornada com `?hoje=` não entra nele (o `?hoje=` só vale no dev).
- Na primeira vez, rode `npx playwright install chromium`, porque o `ignore-scripts` não baixa o navegador sozinho.
- Toda jornada usa as fixtures de `e2e/fixtures.ts`:
  - a fixture `account` entra com uma conta nova (e-mail `e2e-...@example.com` único por teste), então o quadro pessoal começa vazio. `test.use({ loggedIn: false })` começa sem sessão;
  - o `request` das fixtures é o `page.request`, que divide os cookies com a página;
  - uma segunda pessoa entra por `openAs`, num contexto de navegador próprio;
  - um erro no console do navegador (CSP, React) reprova o teste.
- O Chromium escreve no console toda resposta 4xx da página. Uma checagem de 401/403/404 vai pelo `request` (ou pelo `context.request`), não por navegação.
- Nada de `new Date()` nos specs: data fixa só com `?hoje=AAAA-MM-DD`. A rota da agenda só aceita semanas a até 1 ano da data do servidor, então um teste com `?hoje=` fixa a resposta da agenda com `page.route`.
- Não crie rota "só para teste" no servidor. Prepare os dados pela API pública, com `clientHeaders()` (`X-Quadro-Client: 1` e o `Origin` do projeto em execução, tirado do `baseURL`). O login de teste (`POST /api/auth/dev/login`) não conta como rota de teste: ele só existe no `e2eEntry` (ver "Login e sessão").
- `e2e/test-results/` e `e2e/playwright-report/` ficam fora do git.
- Para testar manualmente, rode `npm run dev` (com o login Google no `.env`) e abra `http://127.0.0.1:5173`. Use `127.0.0.1`, não `localhost`: em outro host, o login volta para o `APP_ORIGIN`.

## Agenda da Apple (iCloud CalDAV, somente leitura)
- **Agentes nunca ligam a agenda.** Nunca rode `npm run dev:agenda` nem passe `--agenda` ao servidor. Isso vale para o test-runner, o e2e-validator e qualquer outro agente: servidor subido por agente usa `npm run dev`, `npm run dev:e2e` ou `npm run dev:e2e:static` (os do Playwright). Em produção, o servidor recusa a agenda global. Os títulos reais da agenda (consultas, nomes de terceiros) não podem entrar no DOM, no JSON nem nos traces que um agente lê. A integração real só se valida na verificação manual do usuário.
- **A ativação vem da linha de comando:** a agenda só liga com `--agenda` na linha de comando **e** `ICLOUD_APPLE_ID`/`ICLOUD_APP_PASSWORD` no `.env`. A flag nunca vem do `.env`.
- **Credencial:**
  - `server/src/calendar/config.ts` apaga as chaves de `process.env` depois de lê-las.
  - A senha só existe na closure de `authorization()`, e o header só é montado pelo `guardedFetch` depois de validar a URL.
  - Não exponha a credencial em objeto, log ou erro.
- **Rede de saída:**
  - `server/src/calendar/guardedFetch.ts` é a **única** chamada a `fetch` em `server/src`. A allowlist é **por provedor**: credencial da Apple nunca vai a host do Google, e vice-versa.
  - Apple: só os hosts `caldav.icloud.com` e `^p\d+-caldav\.icloud\.com$`, por HTTPS, sem porta nem userinfo. Nunca use curinga.
  - Google (`createOidcFetch`, o `customFetch` do openid-client): só `accounts.google.com`, `oauth2.googleapis.com` e `www.googleapis.com`, só GET e POST, sem seguir redirecionamento, com corpo de até 256 KiB.
  - Não use `rejectUnauthorized`, `dispatcher` nem nada que desligue TLS.
- **Sem dependência de cliente CalDAV:** o cliente é próprio (`caldavClient.ts`, com XML via `sax` em `xml.ts`). Não troque por `tsdav` ou outro cliente que monte URLs e siga redirecionamentos sozinho.
- **Minimização:** de cada evento só saem `id`, `title`, `start`, `end` e `allDay` (`parseEvents.ts`). O cache guarda só isso, nunca o ICS bruto.
- **Log:** só `{ kind, status }`. Nunca erro cru, mensagem, URL do iCloud (que leva o DSID), título, corpo nem credencial.
- **Fixtures** (`server/test/helpers/caldavFixtures.ts`): só escritas à mão, com DSID `000000000`, host `p00-caldav` e endereços `@example.com`. Nunca capture respostas da conta real. Nenhum teste fala com a Apple, e o teste do cliente falha se `globalThis.fetch` for chamado.
- **`GET /api/calendar/events?week=AAAA-MM-DD`:**
  - `week` precisa ser uma segunda-feira a até 1 ano da data do servidor.
  - A rota exige `X-Quadro-Client: 1` mesmo sendo GET, porque é a única GET com efeito externo.
  - Erros: 502 `UPSTREAM` ou `UPSTREAM_AUTH`. Depois de um 401/403, o servidor espera 15 min sem chamar a Apple.

## Login e sessão (Fase 2a; o plano é `docs/fase-2a.md`)
- **Premissa:** o dev (`npm run dev`, `dev:e2e`) fica só em `127.0.0.1`. Fora da máquina, só pelo pacote de deploy (ver "Produção e deploy"), que liga HTTPS, cookies `__Host-`, limites, admin e `/privacidade`.
- **Login Google** (`server/src/auth/googleProvider.ts`): authorization code com PKCE S256, `state` e `nonce`, e `enableNonRepudiationChecks` para conferir a assinatura do ID token. Sem ele, a assinatura não é verificada.
  - `state`, `nonce` e `code_verifier` ficam no servidor (`pendingLogins.ts`, 10 min, até 10 000 em andamento). O navegador guarda só o id no cookie `quadro_oauth` (`Path=/api/auth`) no local, ou `__Host-quadro_oauth` (`Secure`, `Path=/`) no deploy.
  - O callback consome o login pelo cookie, confere o `state` antes do provedor e monta a URL de volta pelo `APP_ORIGIN`, nunca pelo `Host`.
  - O `next` passa por `sanitizeNext` (`redirect.ts`): só caminho da mesma origem.
  - O `email_verified` é conferido na rota, não no provider, para o IdP falso dos testes passar pela mesma regra.
  - Erro do provedor vira `IdentityError({kind})`, sem `cause`, corpo, URL nem claims. Toda falha volta para `/?login=<resultado>`, sem sessão. A lista fechada é `LOGIN_OUTCOMES` no shared: `erro`, `cancelado`, `indisponivel`, `limite` (limite de taxa) e `desativada` (conta desativada).
  - O segredo do cliente é apagado do `env` na leitura e só existe na closure do `ClientAuth`.
- **Sessão:** cookie `quadro_session` no local, `__Host-quadro_session` com `Secure` no deploy (`HttpOnly`, `SameSite=Lax`, `Path=/`), 256 bits aleatórios, sha256 no banco. Vence com 30 dias sem uso ou 90 no total, e a conta precisa estar ativa a cada requisição: a sessão de uma conta desativada é apagada no primeiro uso. O último acesso da conta (`users.last_seen_at`) é renovado no login e no máximo uma vez por hora.
- **Negação por padrão:** toda rota exige sessão, salvo as marcadas com `config.public`. A lista pública é fechada e conferida em `guard.test.ts` (inclui `GET /api/info`; com o build do web, também `GET /`, `/privacidade` e `/assets/:file`). Quem ainda não criou o perfil só alcança as rotas `allowPending` (`GET`/`DELETE /me`, `/me/profile`, `/auth/logout`); as outras dão 403 `NEEDS_USERNAME`.
- **Handle:** `username_NN`. O `seq 0` e o papel de admin são gravados uma vez, no perfil de quem tem o e-mail verificado igual a `QUADRO_ADMIN_EMAIL`, e nunca recalculados. A conta é achada só pelo `google_sub`.
- **Acesso aos quadros:** só pela tabela `board_members`, pelo helper `requireMember`. Em `/api/tasks/:id`, o quadro vem da própria linha da tarefa (`taskBoardForMember`): não é membro ativo, 404, igual a "não existe".
- **Login de desenvolvimento:** só em `server/src/e2eEntry.ts` (`npm run dev:e2e`). O `index.ts` não o conhece.
  - O e2eEntry não lê o `.env`, não liga o Google nem a agenda, exige `DB_PATH` explícito e diferente do padrão, e recusa subir com `GOOGLE_*`, `ICLOUD_*` ou um banco com contas reais.
  - As contas dele têm `sub` com o prefixo `dev:` e só e-mail `@example.com`. No servidor normal, a sessão delas dá 401 e o callback do Google recusa esse prefixo.
- **Cookie entre portas:** cookie nenhum separa porta, nem com `__Host-`. No 127.0.0.1, qualquer servidor local recebe o cookie, e a defesa entre projetos locais é o guard (`Origin` e `X-Quadro-Client`). No teste do deploy em `https://localhost`, o Chrome também manda o `__Host-quadro_session` para o `http://localhost` de outras portas. Em produção, a garantia vem de um host usado só pelo app.
- **Log:** o serializer do Fastify guarda só método, caminho sem a query e status. Nunca `code`, `state`, cookie, e-mail, `sub` ou token.

## Contrato da API que o cliente web precisa respeitar
- Toda mutação manda `X-Quadro-Client: 1` (`CLIENT_HEADER`/`CLIENT_HEADER_VALUE` de `@quadro/shared`) e o `Origin` do app. Sem eles o guard responde 403. O navegador manda o `Origin` sozinho; o `request` do Playwright e os testes, não.
- Toda rota, salvo a lista pública, exige a sessão. Um 401 no web zera o cache e volta para o login (`resetSession` em `web/src/api/queries.ts`), e sair e o login de teste também zeram.
- Mande `Content-Type: application/json` só quando houver corpo. `DELETE /api/tasks/:id`, `POST /api/boards/:id/reset`, `POST /api/auth/logout`, `POST /api/invites/:boardId/accept` ou `decline`, `DELETE /api/me` e os `POST /api/admin/users/:userId/disable|enable|delete` vão sem corpo e sem esse header, porque o Fastify responde 400 a um JSON vazio.
- `DELETE` responde 204 sem corpo.
- As tarefas são de um quadro: `GET` e `POST /api/boards/:boardId/tasks` e `POST /api/boards/:boardId/reset`. O resto vai pelo id da tarefa (`/api/tasks/:id`), e o servidor acha o quadro pela linha.
- `PUT /api/tasks/:id/position` devolve `{tasks}` com a lista completa do quadro. `POST /api/boards/:boardId/reset` devolve `{tasks, moved}`.
- Quadros, membros e convites: `GET`/`POST /api/boards`, `PATCH`/`DELETE /api/boards/:boardId` (dono; o pessoal não é apagado), `GET /api/boards/:boardId/members`, `POST /api/boards/:boardId/invites {handle}` (dono, só grupo), `DELETE /api/boards/:boardId/members/:userId` (dono remove, membro sai), `GET /api/invites` e `POST /api/invites/:boardId/accept` ou `decline`.
- `POST /api/boards/:boardId/tasks` e `PATCH /api/tasks/:id` aceitam `position` (`{kind:'deck'}` ou `{kind:'cell',day,slot}`):
  - Uma faixa que cruza **outra** tarefa responde **409 `CONFLICT`** ("Esse horário já está ocupado"), dentro da transação: na criação a tarefa não é criada; na edição nenhum campo muda.
  - A regra pura é `planPlacement` em `shared/src/move.ts`.
  - Só o arraste (`PUT /position`, `planMove`) troca as tarefas, e só quando a faixa cruza exatamente uma tarefa do mesmo tamanho. Nesse caso a arrastada assume o início da outra. Qualquer outra sobreposição dá 409.
- `span` (1 a 34) é aceito em `POST` e `PATCH`.
  - `PATCH` só com `span` valida a faixa na própria célula: é o redimensionar.
  - Uma faixa que passa de 22:00 responde 400 `VALIDATION` ("A tarefa não cabe até 22:00").
  - O `span` é da tarefa: vai junto para o deck e volta com ela.
  - No banco, os triggers `tasks_no_overlap_*` recusam sobreposição como defesa extra. Por isso o repositório grava o `span` enquanto a tarefa está fora do quadro (fase do meio de `writePositions`).
- Conta e admin:
  - `GET /api/info` (público) devolve `{contactEmail, operatorName}` para o rodapé e a `/privacidade`.
  - `DELETE /api/me` apaga a própria conta e responde 204. Ele exige uma sessão criada há no máximo 10 minutos; fora disso, 403 `REAUTH_REQUIRED`. O admin recebe 409. Os grupos da pessoa passam ao membro ativo mais antigo; um grupo sem mais ninguém é apagado; as tarefas dela em grupos ficam sem autor.
  - Admin: `GET /api/admin/users` (exige `X-Quadro-Client` também no GET, porque grava auditoria) e `POST /api/admin/users/:userId/disable`, `enable` ou `delete` (só conta desativada). Para quem não é admin, a resposta é a de uma rota que não existe (404). O admin não muda nem apaga a própria conta (409) e não ganha acesso a quadros de ninguém.
- Limites e tetos:
  - O excesso de taxa responde 429 `RATE_LIMITED`. Em navegação (login Google), volta com `?login=limite`.
  - Um teto atingido (20 grupos por dono, 50 membros e 20 convites pendentes por grupo, 500 tarefas por quadro, conteúdo por quadro ou por dono) responde 409 `CONFLICT` com a mensagem do teto.
  - Um convite recusado (ou a saída de um grupo) bloqueia o reconvite pelo mesmo dono por 30 dias, com mensagem neutra. Só existe 1 convite pendente por par.
  - O banco acima de `QUADRO_DB_MAX_MB` responde 503 `STORAGE_FULL` ao criar e ao editar tarefa. Ler e apagar continuam funcionando.
- No dev, acesso só pela própria máquina. Não ponha IP da rede nas allowlists, não use `--host` e não abra túnel. Expor o app é só pelo pacote de deploy. O celular entra só pelo cabo USB, com `adb reverse tcp:5173 tcp:5173`. Os testes do guard travam que um Host ou Origin com IP da rede recebe 403.
- Os erros vêm como `{ error: { code, message, issues? } }`, com mensagens em pt-BR.
- O guard confere o `Host` por igualdade (`127.0.0.1`/`localhost` × `3001`/`5173`; no deploy, só o host do `APP_ORIGIN`) e o `Origin` contra uma allowlist. Ele lê sempre o header `Host` cru, nunca `request.hostname`. O proxy do Vite usa `changeOrigin: false`.
- `GET /api/me` responde 200 com `{user: null}` sem sessão, e não 401: o Chromium escreveria o 401 no console, e a fixture do E2E reprovaria as jornadas.

## Produção e deploy (Fase 2b; o plano é `docs/fase-2b.md`, o passo a passo é `docs/deploy.md`)
- **Modo público** (`server/src/deployMode.ts`): só com `NODE_ENV=production` **e** `APP_ORIGIN` em `https:`. Um sinal sem o outro faz o servidor recusar a subida.
  - Ele recusa subir sem `GOOGLE_*`, `QUADRO_ADMIN_EMAIL`, `QUADRO_CONTACT_EMAIL`, `QUADRO_OPERATOR_NAME` e um `DB_PATH` explícito. Também recusa `NODE_TLS_REJECT_UNAUTHORIZED=0`, `--agenda` e qualquer `ICLOUD_*`. A agenda por pessoa é da Fase 4.
  - No modo público: guard com `publicHost` (o Host e o Origin do `APP_ORIGIN`, e só eles; o health check do contêiner manda o Host público), `trustProxy: '127.0.0.1'` (nunca `true`), cookies `__Host-` e o `web/dist` servido pelo próprio Fastify.
- **Estáticos** (`server/src/http/webDist.ts`): o build é lido para a memória na subida, e só existem `GET /`, `/privacidade` e `/assets/:file`. Não há fallback de SPA.
  - O HTML leva a CSP estrita (`default-src 'self'`, sem `unsafe-inline`), `no-store` e uma `Permissions-Policy`. Os assets com hash levam `immutable`. Toda resposta leva COOP e CORP `same-origin`.
  - O HSTS fica só no Caddy.
- **Limites de taxa** (`server/src/http/rateLimit.ts`): em memória, janela fixa, com o relógio injetado. Os números estão em `RATE_LIMITS`. Os tetos e o bloqueio de reconvite ficam no banco (migração 4, `invite_blocks`).
- **Retenção** (`server/src/retention.ts`, `buildApp({ retention: true })` só no `index.ts`): roda na subida e a cada 24 h.
  - Apaga as sessões vencidas, a auditoria com mais de 180 dias, os bloqueios e convites com mais de 30 dias e as contas sem perfil depois de 7 dias.
  - Apaga também as contas desativadas há 12 meses e as sem uso há 24 meses. O admin nunca é apagado por falta de uso.
  - Os prazos aparecem na `/privacidade` (`RETENTION_ROWS` em `web/src/components/privacy/PrivacyPage.tsx`). Mudou um, mude o outro.
- **Apagar conta** (`server/src/repositories/accountRepository.ts`): uma transação só, com SQL próprio, porque `withTransaction` não é reentrante. É usado pelo `DELETE /api/me`, pelo admin e pela retenção.
- **Pacote** (`deploy/`): o Caddy é dono do namespace de rede, e o app entra nele. O Node continua em `127.0.0.1:3001`.
  - Cada serviço recebe só as próprias chaves, por `environment:` explícito, nunca `env_file`.
  - Imagens fixadas por versão e digest, com pelo menos 2 semanas.
  - O `.dockerignore` é uma allowlist.
  - O arquivo de ambiente fica fora do repositório e vai por `--env-file`.

## Armadilhas conhecidas nos testes do web
- O `PointerSensor` do dnd-kit sem restrição de distância começa o arraste no `pointerdown` e engole o clique. Nos testes, envolva os componentes com `TestDndContext` (`web/src/test/dnd.tsx`), que usa a mesma `POINTER_ACTIVATION` do App.
- O `DndContext` injeta um live region com `role="status"`. Para achar o aviso (toast) do App, filtre pelo elemento `.notice`, não use `getByRole('status')` direto.
- No jsdom, digitar no ProseMirror não é confiável. Teste o editor pelos botões da toolbar, pelos comandos do editor e pelo clique no checkbox.
- `extensions.test.ts` garante que o JSON real do TipTap passa na whitelist de `shared/src/richDoc.ts`. Se trocar uma extensão, os dois precisam continuar de acordo. Em particular, não ative `textDirection`, que acrescenta o attr `dir`.
- O layout mobile (≤ 768 px, `MOBILE_QUERY` em `web/src/lib/useMediaQuery.ts`, que precisa bater com o CSS) é escolhido por `matchMedia`. Nos testes, `web/src/test/viewport.ts` simula a largura: chame `setViewport('mobile')` antes do render, ou dentro de `act` depois dele. O setup volta para desktop e limpa o `localStorage` depois de cada teste.
- A visualização da agenda é salva no `localStorage` e lida por `parseAgendaView`, que só aceita os três ids conhecidos. Além dela, só o id do quadro aberto (`quadro:board`, conferido contra os quadros da pessoa e apagado ao sair). Não guarde ali tarefas, nomes nem rascunhos: a origem `127.0.0.1:5173` é compartilhada com outros projetos Vite.
- O `renderWithProviders` abre o quadro 1 por padrão (`BoardProvider`). Para o `Shell` e as telas de conta, que escolhem o quadro, passe `boardId: null`.
- O `Modal` foca o primeiro elemento focável, que é o X do cabeçalho. Um modal com formulário passa `initialFocusRef` para o primeiro campo.
- Handle de pessoa na tela vai sempre num `<bdi>`, com `{' '}` antes, para não colar no nome de exibição.
- **CSP estrita do HTML (projeto `producao`):** nada de `<style>` inline, `setAttribute('style')`, script ou fonte de fora. O `style` do React (CSSOM) pode.
  - O `TaskEditor` usa `injectCSS: false`. As regras base do ProseMirror estão copiadas no `app.css`, e ao atualizar o TipTap é preciso conferir de novo o `src/style.ts` do `@tiptap/core`.
- A `/privacidade` é escolhida pelo `pathname` no `main.tsx`, sem `Shell` e sem `/api/me`. O servidor precisa ter a mesma rota em `webDist.ts` (`PRIVACY_PATH` do shared).
- O aviso `conta-apagada` da tela de entrada é interno (vem do `Shell`) e nunca é lido da URL.
- A lista de contas do admin (`useAccounts`) usa `gcTime: 0` e não refaz a busca no foco, porque cada busca grava auditoria.
- O `Modal` tem dois botões "Fechar" quando o rodapé tem um: o X do cabeçalho e o do rodapé. Nos testes, use `getAllByRole`.
- Dois `<span>` inline seguidos viram um nome acessível colado ("07:00 – 07:30Academia"). Ponha um `{' '}` entre eles quando o nome precisar de espaço.
- `TaskCardView` tem `<span>` na raiz porque também fica dentro de `<button>` na agenda. Não volte para `<div>`.
- O quadro é uma `<table>` com uma célula droppable para cada (dia, slot), inclusive as cobertas por uma tarefa longa.
  - O cartão é desenhado só na célula de início, com `position: absolute` e altura `--span × --board-row-h` (`boardLayout` em `web/src/lib/board.ts`).
  - O jsdom não faz layout: para testar o redimensionar, faça stub do `getBoundingClientRect` da `<td>`. Veja `TaskCard.test.tsx`.
- A borda de redimensionar (`.task-card__resize`) dá `stopPropagation` no `pointerdown` para não acionar o `PointerSensor` do dnd-kit. Não mova esse handler para o `div` do cartão.
- Uma bolinha de feriado dentro de outro elemento clicável (ex.: aba de dia) usa `<HolidayDots decorative />`, porque botão dentro de botão é inválido.
