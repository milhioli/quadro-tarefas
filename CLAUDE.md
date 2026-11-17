# Quadro de tarefas

Quadro semanal local, em pt-BR: deck de tarefas à esquerda e quadro à direita, com colunas de segunda a sexta e 34 linhas de 30 min (`05:00 – 05:30` a `21:30 – 22:00`). Arrastar move a tarefa, que ocupa 1 slot, e soltar numa célula ocupada troca as tarefas. O "Resetar quadro" devolve tudo ao deck. Cada tarefa tem um modal com editor rico (TipTap) que permite checklist.

- O repositório usa npm workspaces: `shared/` (regras puras e zod), `server/` (Fastify + `node:sqlite`) e `web/` (React + Vite).
- Exige Node ≥ 24.
- O plano original é a referência de decisões: `%USERPROFILE%\.claude\plans\quero-levantar-um-servi-o-snappy-goblet.md`. Ele tem stack, schema, API, regras de troca, casos de teste do calendário, segurança e verificação manual. O arquivo fica fora do repositório e só existe na máquina onde o plano foi feito.
- O remoto é `origin` = `https://github.com/milhioli/quadro-tarefas.git`, na branch `main`. Commit e push só quando o usuário pedir.

## Regras deste projeto
- O agente principal não roda testes, typecheck, `git diff` nem `git status`. A validação vai para o subagente `test-runner`; se o Stop hook pedir, vai também para o `e2e-validator`.
- Nunca leia `.env`. Use o `.env.example`.
- As versões são exatas e o `.npmrc` tem `ignore-scripts=true`. Nenhuma dependência fora da tabela do plano entra sem revisão. As únicas dependências de runtime que acessam conteúdo externo são `sax` 1.6.1 e `ical.js` 2.2.1, e ficam só no `server`.
- `new Date()` sem argumento só pode aparecer em `server/src/clock.ts` e `web/src/lib/clock.ts`, inclusive nos testes. Para datas fixas use `new Date(2026, 10, 13, 12)` ou `fixedClock(...)`.
- Estes termos devem ter 0 ocorrências:
  - `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(` e `new Function`
  - `0.0.0.0`, `host: true`, `--host`, `'::'`, `allowedHosts`, `changeOrigin: true` e `@fastify/cors`
  - Exceções aceitas: este arquivo, `web/vite.config.test.ts` (afirma que `allowedHosts` é `undefined`), `server/src/config.test.ts` e `server/src/http/guard.test.ts` (testam que `0.0.0.0` é ignorado ou rejeitado).
- Todo `.ts`/`.tsx` tem um `*.test.ts(x)` irmão. A exceção são os helpers em `server/test/helpers/` e `web/src/test/`.
- Os testes da API rodam contra SQLite real em arquivo temporário, sem mock do banco. No web, testes de componente usam a API fake (`web/src/test/fakeApi.ts`) injetada via `ApiProvider`.
- Para testar manualmente, rode `npm run dev` e abra `http://127.0.0.1:5173`. Use `127.0.0.1`, não `localhost`.

## Agenda da Apple (iCloud CalDAV, somente leitura)
- **Agentes nunca ligam a agenda.** Nunca rode `npm run dev:agenda` nem passe `--agenda` ao servidor. Isso vale para o test-runner, o e2e-validator e qualquer outro agente: servidor subido por agente usa sempre `npm run dev`. Os títulos reais da agenda (consultas, nomes de terceiros) não podem entrar no DOM, no JSON nem nos traces que um agente lê. A integração real só se valida na verificação manual do usuário.
- **A ativação vem da linha de comando:** a agenda só liga com `--agenda` na linha de comando **e** `ICLOUD_APPLE_ID`/`ICLOUD_APP_PASSWORD` no `.env`. A flag nunca vem do `.env`.
- **Credencial:**
  - `server/src/calendar/config.ts` apaga as chaves de `process.env` depois de lê-las.
  - A senha só existe na closure de `authorization()`, e o header só é montado pelo `guardedFetch` depois de validar a URL.
  - Não exponha a credencial em objeto, log ou erro.
- **Rede de saída:**
  - `server/src/calendar/guardedFetch.ts` é a **única** chamada a `fetch` em `server/src`.
  - Só são aceitos os hosts `caldav.icloud.com` e `^p\d+-caldav\.icloud\.com$`, por HTTPS, sem porta nem userinfo. Nunca use curinga.
  - Não use `rejectUnauthorized`, `dispatcher` nem nada que desligue TLS.
- **Sem dependência de cliente CalDAV:** o cliente é próprio (`caldavClient.ts`, com XML via `sax` em `xml.ts`). Não troque por `tsdav` ou outro cliente que monte URLs e siga redirecionamentos sozinho.
- **Minimização:** de cada evento só saem `id`, `title`, `start`, `end` e `allDay` (`parseEvents.ts`). O cache guarda só isso, nunca o ICS bruto.
- **Log:** só `{ kind, status }`. Nunca erro cru, mensagem, URL do iCloud (que leva o DSID), título, corpo nem credencial.
- **Fixtures** (`server/test/helpers/caldavFixtures.ts`): só escritas à mão, com DSID `000000000`, host `p00-caldav` e endereços `@example.com`. Nunca capture respostas da conta real. Nenhum teste fala com a Apple, e o teste do cliente falha se `globalThis.fetch` for chamado.
- **`GET /api/calendar/events?week=AAAA-MM-DD`:**
  - `week` precisa ser uma segunda-feira a até 1 ano da data do servidor.
  - A rota exige `X-Quadro-Client: 1` mesmo sendo GET, porque é a única GET com efeito externo.
  - Erros: 502 `UPSTREAM` ou `UPSTREAM_AUTH`. Depois de um 401/403, o servidor espera 15 min sem chamar a Apple.

## Contrato da API que o cliente web precisa respeitar
- Toda mutação manda `X-Quadro-Client: 1` (`CLIENT_HEADER`/`CLIENT_HEADER_VALUE` de `@quadro/shared`). Sem ele o guard responde 403.
- Mande `Content-Type: application/json` só quando houver corpo. `DELETE /api/tasks/:id` e `POST /api/board/reset` vão sem corpo e sem esse header, porque o Fastify responde 400 a um JSON vazio.
- `DELETE` responde 204 sem corpo.
- `PUT /api/tasks/:id/position` devolve `{tasks}` com a lista completa. `POST /api/board/reset` devolve `{tasks, moved}`.
- `POST /api/tasks` e `PATCH /api/tasks/:id` aceitam `position` (`{kind:'deck'}` ou `{kind:'cell',day,slot}`):
  - Uma célula ocupada por **outra** tarefa responde **409 `CONFLICT`** ("Esse horário já está ocupado"), dentro da transação: na criação a tarefa não é criada; na edição nenhum campo muda.
  - A regra pura é `planPlacement` em `shared/src/move.ts`.
  - Só o arraste (`PUT /position`, `planMove`) troca as tarefas.
- Acesso só pela própria máquina. Não ponha IP da rede nas allowlists, não use `--host` e não abra túnel: o app não tem autenticação. O celular entra só pelo cabo USB, com `adb reverse tcp:5173 tcp:5173`. Os testes do guard travam que um Host ou Origin com IP da rede recebe 403.
- Os erros vêm como `{ error: { code, message, issues? } }`, com mensagens em pt-BR.
- O guard confere o `Host` por igualdade (`127.0.0.1`/`localhost` × `3001`/`5173`) e o `Origin` contra uma allowlist. O proxy do Vite usa `changeOrigin: false`.

## Armadilhas conhecidas nos testes do web
- O `PointerSensor` do dnd-kit sem restrição de distância começa o arraste no `pointerdown` e engole o clique. Nos testes, envolva os componentes com `TestDndContext` (`web/src/test/dnd.tsx`), que usa a mesma `POINTER_ACTIVATION` do App.
- O `DndContext` injeta um live region com `role="status"`. Para achar o aviso (toast) do App, filtre pelo elemento `.notice`, não use `getByRole('status')` direto.
- No jsdom, digitar no ProseMirror não é confiável. Teste o editor pelos botões da toolbar, pelos comandos do editor e pelo clique no checkbox.
- `extensions.test.ts` garante que o JSON real do TipTap passa na whitelist de `shared/src/richDoc.ts`. Se trocar uma extensão, os dois precisam continuar de acordo. Em particular, não ative `textDirection`, que acrescenta o attr `dir`.
- O layout mobile (≤ 768 px, `MOBILE_QUERY` em `web/src/lib/useMediaQuery.ts`, que precisa bater com o CSS) é escolhido por `matchMedia`. Nos testes, `web/src/test/viewport.ts` simula a largura: chame `setViewport('mobile')` antes do render, ou dentro de `act` depois dele. O setup volta para desktop e limpa o `localStorage` depois de cada teste.
- A visualização da agenda é salva no `localStorage` e lida por `parseAgendaView`, que só aceita os três ids conhecidos. Não guarde ali tarefas nem rascunhos: a origem `127.0.0.1:5173` é compartilhada com outros projetos Vite.
- Dois `<span>` inline seguidos viram um nome acessível colado ("07:00 – 07:30Academia"). Ponha um `{' '}` entre eles quando o nome precisar de espaço.
- `TaskCardView` tem `<span>` na raiz porque também fica dentro de `<button>` na agenda. Não volte para `<div>`.
- Uma bolinha de feriado dentro de outro elemento clicável (ex.: aba de dia) usa `<HolidayDots decorative />`, porque botão dentro de botão é inválido.
