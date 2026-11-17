<!-- Plano original de 13/11/2026, a referência das decisões de base (stack, schema, API, regras de troca, segurança).
     As decisões posteriores, inclusive o que mudou em relação a este plano, estão em docs/roteiro.md. -->
# Plano — Quadro de Tarefas semanal (local, pt-BR)

## Contexto
O usuário quer um serviço simples de gestão de tarefas: **deck de tarefas à esquerda** e **quadro à direita** com colunas Segunda–Sexta e linhas de 30 min de `05:00 – 05:30` a `21:30 – 22:00` (34 linhas). As tarefas ficam num banco e são arrastadas do deck para as células. Fora do quadro aparece a informação do calendário brasileiro (mês, "Semana N de M", feriados). Há botões para resetar o quadro, criar, editar e apagar tarefas. Cada tarefa abre um modal com um editor rico que permite, por exemplo, checklists.

Decisões do usuário:
- Há um **quadro único**. "Resetar" devolve tudo ao deck e não há histórico por semana.
- Arrastar **move** a tarefa, e ela ocupa **1 slot**.
- Stack: **React + Vite / Node (Fastify) + SQLite**.
- Calendário: **mês + Semana N de M (domingo→sábado) + feriados nacionais**.

Premissas:
- Um único usuário local, sem autenticação.
- A API escuta só em `127.0.0.1`.
- Projeto novo na pasta do repositório, com `git init` e sem commits até o usuário pedir.

## Stack (versões exatas, `.npmrc save-exact=true`, `engines.node >=24`)
| Uso | Pacotes |
|---|---|
| UI | react / react-dom 19.3.1, vite 8.3.8, @vitejs/plugin-react 6.3.0 |
| Estado do servidor | @tanstack/react-query 5.107.1 |
| Drag & drop | @dnd-kit/core 6.3.1, @dnd-kit/utilities 3.2.2 |
| Editor rico | TipTap v3 3.34.0: @tiptap/react, core, pm, starter-kit, extension-list (TaskList/TaskItem), extensions (Placeholder) |
| Validação (compartilhada) | zod 4.6.7 |
| API | fastify 5.12.8 |
| Banco | **`node:sqlite` embutido (DatabaseSync)**, sem dependência nativa. O `better-sqlite3` foi descartado por exigir build no Windows. |
| Dev | tsx, concurrently, typescript 6.0.3 |
| Testes | vitest 5.1.0, jsdom, @testing-library/react / dom / user-event / jest-dom |

As versões foram conferidas no registry npm.
- Se o install falhar, **pare e reporte**. Nenhuma versão fora desta tabela entra sem revisão.
- O `.npmrc` leva `save-exact=true` e `ignore-scripts=true`, validado no passo 1. Se algum pacote precisar de script, só esse pacote é liberado.

## Estrutura (npm workspaces)
```
quadro-tarefas/
  package.json  (dev = concurrently api+web, test = vitest run, typecheck)
  .npmrc .gitignore (node_modules, server/data/, .env, dist) .gitattributes .env.example README.md
  tsconfig.base.json  vitest.config.ts (projects: shared, server, web)
  shared/src/  slots.ts days.ts colors.ts richDoc.ts schemas.ts move.ts   (+ *.test.ts)
  server/src/  index.ts config.ts clock.ts app.ts
               db/{connection,migrations,transaction}.ts
               repositories/taskRepository.ts
               routes/{tasks,board,health}.ts  http/{validate,errors,guard}.ts
         test/helpers/tempDb.ts
  web/src/     main.tsx App.tsx styles/
               api/{client.ts,ApiContext.tsx,queries.ts}
               lib/{calendar,clock,useToday,dnd,board,devToday}.ts
               components/{CalendarHeader,Deck,Board,BoardCell,TaskCard,Modal,ConfirmDialog,TaskModal,ColorPicker}.tsx
               components/editor/{TaskEditor,EditorToolbar}.tsx + extensions.ts
               test/setup.ts
```

## Banco (SQLite em `server/data/quadro.sqlite`, sobrescrevível por `DB_PATH`)
```sql
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  color TEXT NOT NULL DEFAULT 'amarelo' CHECK (color IN ('amarelo','azul','verde','rosa','roxo','laranja','cinza')),
  content TEXT NOT NULL CHECK (json_valid(content)),      -- JSON do TipTap/ProseMirror
  day INTEGER CHECK (day BETWEEN 0 AND 4),                 -- 0=Segunda
  slot INTEGER CHECK (slot BETWEEN 0 AND 33),              -- 0=05:00–05:30
  deck_order INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((day IS NULL AND slot IS NULL AND deck_order IS NOT NULL)
      OR (day IS NOT NULL AND slot IS NOT NULL AND deck_order IS NULL))
);
CREATE UNIQUE INDEX tasks_cell_unique ON tasks(day, slot) WHERE day IS NOT NULL;
```
- As migrações ficam em `MIGRATIONS: string[]`, controladas por `PRAGMA user_version` e executadas no startup dentro de transação.
- O banco abre com `journal_mode=WAL` e `busy_timeout=3000`.
- O helper `withTransaction`, de poucas linhas, usa `BEGIN IMMEDIATE`.
- A troca entre células é gravada em duas fases para nunca violar o índice único:
  1. Quem muda de posição vai para o deck com `deck_order=-id`.
  2. Grava-se a posição final.

## API REST (`/api`, DTOs em zod em `shared/schemas.ts`)
| Rota | Corpo | Resposta |
|---|---|---|
| `GET /api/health` | — | `{ok:true}` |
| `GET /api/tasks` | — | `{tasks: Task[]}` |
| `GET /api/tasks/:id` | — | `Task` ou 404 |
| `POST /api/tasks` | `{title, color?, content?}` (strict) | 201, entra no fim do deck |
| `PATCH /api/tasks/:id` | `{title?, color?, content?}` (strict, pelo menos 1 chave) | `Task` |
| `DELETE /api/tasks/:id` | — | 204 (libera a célula) |
| `PUT /api/tasks/:id/position` | `{to:{kind:'deck'} \| {kind:'cell',day,slot}}` | `{tasks}` (lista completa) |
| `POST /api/board/reset` | — | `{tasks, moved}` |

**Regra ao soltar numa célula ocupada:** cada célula tem uma tarefa só, e a operação é uma **troca**.
- Célula A → B ocupada: o ocupante de B vai para A.
- Deck → B ocupada: o ocupante volta ao deck, na posição da tarefa arrastada.
- Soltar no mesmo lugar não faz nada.
- Célula → deck: a tarefa vai para o fim do deck.

A lógica fica numa função pura em `shared/move.ts` (`planMove`, `planReset`, `applyPositions`). O servidor a usa dentro da transação e o cliente a usa na atualização otimista, então as regras são idênticas nos dois lados.

**Conteúdo rico** (`shared/richDoc.ts`) é um schema zod recursivo com whitelist:
- Nós permitidos: doc, paragraph, text, heading(1–3), bulletList, orderedList, listItem, taskList, taskItem(checked: boolean), blockquote, codeBlock, hardBreak, horizontalRule.
- Marcas permitidas: bold, italic, strike, underline, code.
- **`attrs` são declarados por nó**, e todo objeto de nó, marca e attrs usa `.strict()`. Nunca `z.record` nem `.passthrough()`.
  - A lista de attrs sai do `editor.getJSON()` real no passo 2 (por exemplo `orderedList.start`/`type` e `codeBlock.language`).
  - `language` aceita só `null` ou `^[a-z0-9+#-]{1,32}$`.
- A profundidade máxima é 32, verificada antes do zod.
- `bodyLimit` é de 256 KiB, e acima disso a resposta é 413.
- Casos negativos no teste:
  - nó `image`/`iframe`
  - marca `link`
  - attrs `href`/`onclick`/`style`
  - `level: 4`
  - `checked: "true"`
  - profundidade 33

## Frontend
- **App**:
  - Barra superior com CalendarHeader, "Nova tarefa" e "Resetar quadro" (com confirmação; desabilitado se o quadro estiver vazio).
  - Grid de 2 colunas: Deck à esquerda e Board à direita.
  - É dono do `DndContext` e do `DragOverlay`.
- **CalendarHeader**: mostra "Novembro de 2026 · Semana 2 de 5", "Hoje: sexta-feira, 13/11" e "Próximo feriado: …".
- **Deck**: área droppable `deck` com título "Tarefas (N)" e estado vazio em pt-BR.
- **Board**:
  - Grid com cabeçalho e coluna de horários fixos (sticky).
  - Cabeçalhos no formato "Seg 09/11".
  - A coluna de hoje leva `aria-current="date"`.
  - Badges de "Feriado · …" e "Ponto facultativo · …".
- **BoardCell**: droppable `cell:{day}:{slot}`.
- **TaskCard**: draggable `task:{id}`. O título é renderizado como texto e a cor vem por classe CSS. Um clique abre o modal; o `PointerSensor` tem distância de 5 px para distinguir clique de arraste.
- **TaskModal**:
  - Campos de título, cor e editor TipTap.
  - Botões Salvar, Cancelar e Excluir (com confirmação).
  - Ao fechar com alterações pendentes, pergunta "Descartar alterações não salvas?".
- **Editor**:
  - StarterKit com headings 1–3 e **link desativado**, mais TaskList, TaskItem (nested) e Placeholder.
  - Toolbar em pt-BR com `aria-pressed`, via `useEditorState`: Negrito, Itálico, Riscado, Título 1/2/3, Lista com marcadores, Lista numerada, **Lista de tarefas (checkbox)**, Citação, Desfazer, Refazer.
- **Estado**:
  - TanStack Query com a chave `['tasks']`.
  - O move é otimista com `planMove` e faz rollback em caso de erro, mostrando "Não foi possível mover a tarefa".
  - `ApiContext` permite injetar uma API fake nos testes de componente.

## Calendário (`web/src/lib/calendar.ts`, puro, aritmética em UTC)
**Funções**
- `weekOfMonth(d) = floor((dow(dia 1) + dia − 1)/7) + 1`
- `weeksInMonth(y,m) = ceil((dow(dia 1) + diasNoMês)/7)`, com a semana de domingo a sábado
- `currentWorkWeek(d)`: segunda a sexta da semana (domingo a sábado) que contém `d`. No domingo mostra a semana que começa; no sábado, a que termina.
- `easterSunday(y)`, pelo algoritmo de Meeus
- `brazilianHolidays(y)`:
  - Feriados fixos: 01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 20/11 (a partir de 2024) e 25/12.
  - Sexta-feira Santa: Páscoa −2.
  - Pontos facultativos: Carnaval (Páscoa −48 e −47) e Corpus Christi (Páscoa +60).
- `holidaysOn` e `holidaysForDates`: cobrem semanas que atravessam o ano novo.
- `nextHoliday`, `monthLabel`, `formatDayHeader`

O mês e a "Semana N de M" seguem sempre a data de hoje.

**Relógio injetável**
- `lib/clock.ts` (`systemClock`/`fixedClock`) é o único lugar que chama `new Date()` sem argumento. No servidor, o equivalente é `server/src/clock.ts`.
- `useToday` relê o relógio a cada 60 s e no `visibilitychange`.
- Só em dev, `?hoje=AAAA-MM-DD` permite simular uma data.

**Casos de teste já verificados**
- Páscoa: 2026-04-05, 2025-04-20, 2024-03-31, 2000-04-23, 2285-03-22, 2038-04-25.
- Datas móveis de 2026:
  - Carnaval: 16 e 17/02.
  - Sexta Santa: 03/04.
  - Corpus Christi: 04/06.
- Contagem de entradas: 2026 tem 13 (10 feriados e 3 pontos facultativos); 2023 tem 12 (ainda sem o 20/11).
- Em 21/04/2000 caem 2 feriados ao mesmo tempo (Tiradentes e Sexta Santa).
- `weeksInMonth`: 2026-11 → 5, 2026-02 → 4, 2026-05 → 6, 2026-08 → 6, 2027-02 → 5.
- `weekOfMonth`: 13/11/2026 → 2 ("Semana 2 de 5"), 29/11 → 5, 02/08/2026 → 2.
- `currentWorkWeek`:
  - Sex 13/11 → 09 a 13/11.
  - Dom 15/11 → 16 a 20/11, e a sexta mostra Consciência Negra.
  - Qui 31/12/2026 → 28/12 a 01/01/2027.

## Slots (`shared/slots.ts`)
- Constantes: `SLOT_COUNT=34`, início 300 min, passo de 30 min.
- `slotLabel(0)='05:00 – 05:30'` e `slotLabel(33)='21:30 – 22:00'`; índices inválidos lançam `RangeError`.
- `shared/days.ts` define Segunda a Sexta.

## Segurança
Esta seção incorpora a revisão do `cybersecurity-reviewer`. Os 2 itens bloqueantes já estão resolvidos aqui.

**Rede e dev server** (`web/vite.config.ts`)
- O Vite usa `host: '127.0.0.1'` e `strictPort`, e o script `dev` **não** usa `--host`.
- `server.allowedHosts` não é definido (fica o padrão).
- **`server.cors: false`.** O padrão do Vite 8 aceita qualquer origem localhost e responderia o preflight antes do proxy.
- O proxy `/api` aponta para `http://127.0.0.1:3001` com **`changeOrigin: false`**, para que o Fastify veja o `Host` original.
- `server.headers`:
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Content-Security-Policy: frame-ancestors 'none'; connect-src 'self' ws://127.0.0.1:5173 ws://localhost:5173; img-src 'self' data:; object-src 'none'; base-uri 'self'`

  Enquanto o app rodar só em dev, ficam de fora `default-src` e `script-src`, porque o preâmbulo inline do React Refresh quebra com eles. Num build futuro servido pelo Fastify, entra `script-src 'self'`.
- O Fastify escuta em `127.0.0.1` (fixo), com `trustProxy` desligado e sem `@fastify/cors`.

**`http/guard.ts`**
- É um hook `onRequest` **registrado na raiz** do `buildApp`, antes das rotas, para valer para todas.
- **Host**: hostname e porta vêm de `request.hostname`/`request.port` e são comparados **por igualdade** com `{127.0.0.1, localhost} × {3001, 5173}`. `Host` ausente ou fora da lista → 403. Nada de `startsWith`/`includes`.
- **Origin**: se o header vier, a comparação é por igualdade de string com uma allowlist fixa da config (`http://127.0.0.1:5173`, `http://localhost:5173`). `Origin: null` ou qualquer outro valor → 403.
- **Mutação** é qualquer método fora de {GET, HEAD}, inclusive OPTIONS, e exige `X-Quadro-Client: 1`; sem ele → 403.
- Testes:
  - `Host` = `localhost.evil.com`, `127.0.0.1.evil.com`, `evil.com` e ausente.
  - `Origin` = `http://localhost:8080` e `null`, tanto em GET quanto em POST.
  - Um teste coleta as rotas via `onRoute` e confere que **todo** método não-GET sem o header recebe 403.

**Respostas da API**
- `X-Content-Type-Options: nosniff`
- `Cache-Control: no-store`
- `X-Frame-Options: DENY`
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`

**Conteúdo**
- É salvo só como JSON validado por whitelist estrita e renderizado só pelo ProseMirror.
- **Nunca** se usa `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` ou `new Function`.
- O Link do TipTap fica desativado.

**Erros e logs**
- O error handler devolve mensagens genéricas em pt-BR, sem stack trace.
- O corpo das requisições não é registrado.

**Dependências**
- Versões exatas, lockfile commitado e `ignore-scripts=true`.
- `npm audit --audit-level=high` sem achados e `npm audit signatures`.

## Ordem de implementação (cada passo com seus testes)
1. **Scaffold**: git init, arquivos raiz e workspaces. Depois o install com `ignore-scripts=true`; se falhar, pare e reporte.
2. **De-risk**:
   - teste do `node:sqlite` rodando sob o Vitest
   - `setup.ts` do jsdom (polyfills de Range, `elementFromPoint` e ResizeObserver)
   - render mínimo do TipTap, capturando o `getJSON()` real para fechar a lista de attrs do `richDoc`
   - preflight no Vite com `Origin: http://localhost:8080`, que não pode retornar `Access-Control-Allow-Origin`
3. **`shared`**: slots, days, colors, richDoc, schemas e move. Casos do `move`:
   - deck→vazia
   - deck→ocupada
   - célula→vazia
   - troca
   - →deck
   - no-op
   - id inexistente
   - ordem do reset
4. **`server`**: config, clock, db, repository, guard/validate/errors, rotas, `buildApp({db, now})` e index.
5. **`web/lib`**: calendar, clock, useToday, dnd (`dropToMove`), board e devToday.
6. **API do cliente**: client.ts e queries.ts, com o move otimista e o rollback.
7. **Componentes**: Modal, ConfirmDialog, TaskCard, Deck, BoardCell, Board e CalendarHeader.
8. **Editor**: extensions, EditorToolbar, TaskEditor e TaskModal.
9. **Montagem**: App com DnD, DragOverlay e reset, `main.tsx`, CSS e textos em pt-BR.

**Testes**
- Todo arquivo `.ts`/`.tsx` tem um `*.test.ts(x)` irmão.
- Testes de integração da API usam `app.inject()` contra um SQLite real em arquivo temporário, **sem mock do banco**. Cobrem:
  - os 400s de validação
  - os 404s
  - as 4 trocas
  - o reset
  - o guard (403)
  - a persistência ao recriar o app
- Componentes são testados com relógio fixo.
- O drag real não é simulável no jsdom, então a lógica fica em funções puras e o arraste é verificado manualmente.

## Verificação
**Automática**: delegada ao subagente `test-runner` com a lista de arquivos criados. O agente principal não roda testes.
- `npm run typecheck` e `npm test`, com 0 falhas e 0 testes pulados.
- `npm audit --audit-level=high` sem achados e `npm audit signatures`.
- Grep com 0 ocorrências:
  - injeção de HTML ou código: `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`
  - exposição de rede: `0.0.0.0`, `host: true`, `--host`, `'::'`, `allowedHosts`, `changeOrigin: true`, `@fastify/cors`
- `new Date()` sem argumento só nos dois `clock.ts`.

Se o Stop hook pedir, a validação de jornada fica com o `e2e-validator`.

**Manual** (`npm run dev` e depois `http://127.0.0.1:5173`):
1. O cabeçalho mostra "Novembro de 2026 · Semana 2 de 5", as colunas vão de Seg 09/11 a Sex 13/11 e a sexta aparece como hoje.
2. Com `?hoje=2026-11-15`, a sexta 20/11 mostra Consciência Negra. Com `?hoje=2026-02-15`, aparece o Carnaval. Com `?hoje=2026-12-31`, aparece o 01/01.
3. São 34 linhas, de 05:00 a 22:00, e o cabeçalho e os horários continuam visíveis ao rolar.
4. Criar uma tarefa, recarregar com F5 e ver que ela persiste.
5. Testar todos os arrastes (deck→célula, célula→célula, troca, deck→ocupada, →deck), cada um seguido de F5. Um clique simples deve abrir o modal.
6. No modal, criar um título, uma lista, um **checklist** e um negrito, salvar, reabrir e conferir. Ao digitar `<img onerror>`, ele deve aparecer como texto.
7. Excluir uma tarefa posicionada libera a célula. O reset com Cancelar não muda nada; confirmando, tudo volta ao deck.
8. Reiniciar o servidor e conferir que os dados persistem.
9. Testes de bloqueio:
   - `curl.exe -X POST http://127.0.0.1:3001/api/board/reset` → 403.
   - `Host: localhost.evil.com` → 403.
   - Um preflight `OPTIONS` em `:5173/api/tasks` com `Origin: http://localhost:8080` não traz `Access-Control-Allow-Origin`.
   - `curl.exe -I http://127.0.0.1:5173/` mostra `X-Frame-Options` e `frame-ancestors`.
   - `netstat` mostra as portas 3001 e 5173 só em 127.0.0.1.

## Arquivos críticos
- `shared/src/move.ts`
- `shared/src/richDoc.ts`
- `server/src/repositories/taskRepository.ts`
- `server/src/app.ts`
- `server/src/http/guard.ts`
- `web/src/lib/calendar.ts`
- `web/src/App.tsx`
- `web/src/components/TaskModal.tsx`
- `web/src/components/editor/TaskEditor.tsx`
