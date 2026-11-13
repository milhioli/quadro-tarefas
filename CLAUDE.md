# Quadro de tarefas

Quadro semanal local, em pt-BR: deck de tarefas à esquerda e quadro à direita, com colunas de segunda a sexta e 34 linhas de 30 min (`05:00 – 05:30` a `21:30 – 22:00`). Arrastar move a tarefa, que ocupa 1 slot, e soltar numa célula ocupada troca as tarefas. O "Resetar quadro" devolve tudo ao deck. Cada tarefa tem um modal com editor rico (TipTap) que permite checklist.

- O repositório usa npm workspaces: `shared/` (regras puras e zod), `server/` (Fastify + `node:sqlite`) e `web/` (React + Vite).
- Exige Node ≥ 24.
- O plano aprovado é a fonte da verdade e precisa ser lido antes de qualquer passo: `%USERPROFILE%\.claude\plans\quero-levantar-um-servi-o-snappy-goblet.md`. Ele tem stack, schema, API, regras de troca, casos de teste do calendário, segurança e verificação manual. O arquivo fica fora do repositório e só existe na máquina onde o plano foi feito.
- O remoto é `origin` = `https://github.com/milhioli/quadro-tarefas.git`, na branch `main`. Commit e push só quando o usuário pedir.

## Regras deste projeto
- O agente principal não roda testes, typecheck, `git diff` nem `git status`. A validação vai para o subagente `test-runner`; se o Stop hook pedir, vai também para o `e2e-validator`.
- Nunca leia `.env`. Use o `.env.example`.
- As versões são exatas e o `.npmrc` tem `ignore-scripts=true`. Nenhuma dependência fora da tabela do plano entra sem revisão.
- `new Date()` sem argumento só pode aparecer em `server/src/clock.ts` e `web/src/lib/clock.ts`, inclusive nos testes. Para datas fixas use `new Date(2026, 10, 13, 12)` ou `fixedClock(...)`.
- Estes termos devem ter 0 ocorrências:
  - `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(` e `new Function`
  - `0.0.0.0`, `host: true`, `--host`, `'::'`, `allowedHosts`, `changeOrigin: true` e `@fastify/cors`
- Todo `.ts`/`.tsx` tem um `*.test.ts(x)` irmão. A exceção são os helpers em `server/test/helpers/` e `web/src/test/`.
- Os testes da API rodam contra SQLite real em arquivo temporário, sem mock do banco. No web, testes de componente usam a API fake injetada via `ApiProvider`.
- Para testar manualmente, rode `npm run dev` e abra `http://127.0.0.1:5173`. Use `127.0.0.1`, não `localhost`.

## Contrato da API que o cliente web precisa respeitar
- Toda mutação manda `X-Quadro-Client: 1` (`CLIENT_HEADER`/`CLIENT_HEADER_VALUE` de `@quadro/shared`). Sem ele o guard responde 403.
- Mande `Content-Type: application/json` só quando houver corpo. `DELETE /api/tasks/:id` e `POST /api/board/reset` vão sem corpo e sem esse header, porque o Fastify responde 400 a um JSON vazio.
- `DELETE` responde 204 sem corpo.
- `PUT /api/tasks/:id/position` devolve `{tasks}` com a lista completa. `POST /api/board/reset` devolve `{tasks, moved}`.
- Os erros vêm como `{ error: { code, message, issues? } }`, com mensagens em pt-BR.
- O guard confere o `Host` por igualdade (`127.0.0.1`/`localhost` × `3001`/`5173`) e o `Origin` contra uma allowlist. O proxy do Vite usa `changeOrigin: false`.

## Status em 2026-11-13
Os passos 1, 3 e 4 do plano estão escritos: scaffold, `shared/` e `server/`. Nada foi executado ainda. O primeiro relatório do `test-runner` pode exigir correções também nesses pacotes.

O que já existe no `web/`:
- `tsconfig.json` (src) e `tsconfig.node.json` (arquivos de config). O `typecheck` da raiz já inclui os dois.
- `vite.config.ts`, que exporta `buildViteConfig`, `parsePort`, `securityHeaders` e `WEB_HOST`. Ele lê `WEB_PORT`/`API_PORT` com `loadEnv` na raiz.
- `vitest.config.ts`, com jsdom e `setupFiles`. O `include` cobre `src/**/*.test.{ts,tsx}` e `vite.config.test.ts`.
- `vite.config.test.ts`, com `// @vitest-environment node`. Sobe um Vite real e testa os headers, o preflight de `http://localhost:8080` sem `Access-Control-Allow-Origin` e o Host `evil.com` → 403.
- `src/test/setup.ts`, que carrega o jest-dom, faz o `cleanup` e instala os polyfills de `Range.getBoundingClientRect`/`getClientRects`, `elementFromPoint`, `scrollIntoView` e `ResizeObserver`. Também roda no ambiente node, por isso tudo fica atrás de `typeof window`.
- `index.html`, sem script inline.

## Próximos passos (em ordem; cada arquivo com seu teste)
O design abaixo já foi pensado contra as versões instaladas. Siga-o, a menos que o código real contradiga.

### 1. Helpers de teste (`web/src/test/`)
- `fakeApi.ts`:
  - Implementa um `ApiClient` em memória com `planMove`/`planReset`/`applyPositions` de `@quadro/shared`.
  - Devolve cópias com `structuredClone`.
  - Tem `failNext(method, error?)` e `holdNext(method)`, que devolve `{ release }` para observar a atualização otimista.
  - Exporta `makeTask(overrides)`.
- `render.tsx`:
  - `createTestQueryClient()`, com `retry: false` e `refetchOnWindowFocus: false`.
  - `renderWithProviders(ui, { api, queryClient })`, que devolve também `user` (do `userEvent.setup()`).
  - Um wrapper para usar com `renderHook`.

### 2. `web/src/lib/` (passo 5)
- **`clock.ts`**
  - `type Clock = () => Date`.
  - `systemClock`.
  - `fixedClock(iso | Date)`, que lança `RangeError` se a data for inválida.
- **`calendar.ts`**
  - É puro e trabalha com "datas civis": `Date` à meia-noite UTC, usando só os getters `getUTC*`.
  - `civilDate(y, mês1a12, d)` valida a data.
  - `toCivilDate(instante)` usa os getters locais.
  - Funções de data: `addDays`, `dayOfWeek`, `daysInMonth`, `weekOfMonth`, `weeksInMonth`, `currentWorkWeek` (segunda a sexta da semana de domingo a sábado) e `easterSunday` (Meeus).
  - `brazilianHolidays(y)` devolve `{date, name, kind: 'feriado' | 'facultativo'}` ordenado.
    - Nomes: Confraternização Universal, Carnaval (×2, facultativo), Sexta-feira Santa, Tiradentes, Dia do Trabalho, Corpus Christi (facultativo), Independência do Brasil, Nossa Senhora Aparecida, Finados, Proclamação da República, Dia Nacional de Zumbi e da Consciência Negra (a partir de 2024) e Natal.
  - Consultas de feriado:
    - `holidaysOn`
    - `holidaysForDates`, que devolve `Map<iso, Holiday[]>` e atravessa o ano novo
    - `nextHoliday(d)`, estritamente depois de `d`, olhando também `y+1`
  - Formatação, com arrays próprios em pt-BR e sem `Intl`:
    - `isoDate` e `parseIsoDate`, que devolve `null` se a data for inválida
    - `monthLabel` → "Novembro de 2026"
    - `weekLabel` → "Semana 2 de 5"
    - `formatDayHeader` → "Seg 09/11"
    - `formatLongDate` → "sexta-feira, 13/11"
    - `formatDayMonth`
  - Os casos de teste estão no plano.
- **`useToday.ts`**
  - `useToday(clock, refreshMs = 60_000)`.
  - Relê o relógio por intervalo e no `visibilitychange`.
  - Mantém a mesma referência enquanto o dia não muda.
- **`devToday.ts`**
  - `resolveClock(search, isDev, base)`: `?hoje=AAAA-MM-DD` vale só em dev e fixa o relógio ao meio-dia local.
  - Com data inválida ou fora de dev, devolve `base`.
- **`board.ts`**
  - `boardColumns(today)` devolve `{day, date, label, isToday, holidays}[]`.
  - `cellKey(day, slot)`.
  - `deckTasks`, ordenado por `deckOrder` e depois `id`.
  - `placedTasksByCell`, que devolve um `Map`.
- **`dnd.ts`**
  - IDs: `taskDragId` (`task:{id}`) e `parseTaskDragId`.
  - Alvos: `DECK_DROP_ID = 'deck'`, `cellDropId` (`cell:{d}:{s}`) e `parseDropId`, que devolve `MoveTarget | null`.
  - `dropToMove(state, activeId, overId)` devolve `{taskId, to} | null`. É `null` quando o movimento é um no-op, conferido via `planMove`.
  - `describeDropTarget(id)` dá o texto em pt-BR para os anúncios do dnd-kit.

### 3. `web/src/api/` (passo 6)
- **`client.ts`**
  - A interface `ApiClient` tem `listTasks`, `createTask`, `updateTask`, `deleteTask`, `moveTask` e `resetBoard`.
  - `ApiError(status, code, message, issues)`, em que `code` também pode ser `'NETWORK'` ou `'UNKNOWN'`.
  - `createApiClient({ baseUrl?, fetch? })`:
    - O fetch padrão é `(i, init) => globalThis.fetch(i, init)`.
    - Usa `credentials: 'same-origin'` e `cache: 'no-store'`.
  - `describeError(err, fallback)` monta "fallback. <primeiro issue ou mensagem>".
- **`ApiContext.tsx`**: `ApiProvider` e `useApi`, que lança erro se usado sem provider.
- **`queries.ts`**
  - `TASKS_KEY = ['tasks']`, `createQueryClient` e `useTasks`.
  - `useCreateTask`/`useUpdateTask`/`useDeleteTask` atualizam o cache com `setQueryData`.
  - `useMoveTask` é otimista:
    - `onMutate` faz `cancelQueries`, guarda o snapshot e aplica `applyPositions(prev, planMove(...))`.
    - `onError` faz rollback e `invalidateQueries`.
    - `onSuccess` grava a lista do servidor.
  - `useResetBoard`.
  - As assinaturas da TanStack Query 5.107 são `onMutate(vars, ctx)` e `onError(err, vars, onMutateResult, ctx)`.

### 4. Componentes (passo 7)
- **`Modal`**
  - É renderizado num portal em `document.body`, com `role` `dialog` ou `alertdialog`, `aria-modal` e `aria-labelledby`.
  - Escape chama `stopPropagation`.
  - O clique no backdrop só fecha se `target === currentTarget`.
  - Prende o foco com Tab, mas ignora eventos com `defaultPrevented`, porque o TaskItem do TipTap usa Tab.
  - Recebe `initialFocusRef` e devolve o foco ao fechar.
- **`ConfirmDialog`**: abre com o foco inicial em Cancelar.
- **`ColorPicker`**: um `fieldset` de rádios, com o nome de cada cor num label visualmente oculto.
- **`TaskCardView` / `TaskCard`**
  - `TaskCardView` é só apresentação e também é usado no `DragOverlay`.
  - `TaskCard` usa `useDraggable`. Clique, Enter ou Espaço abrem o modal; o dnd-kit já suprime o clique depois de um arraste.
  - O título é renderizado como texto, a cor vem por classe e o progresso do checklist vem de `checklistProgress`.
- **`Deck`**
  - A `section` inteira é droppable.
  - Título "Tarefas (N)" e estado vazio em pt-BR.
- **`BoardCell`**: um `td` droppable com `aria-label` "Segunda 09/11, 05:00 – 05:30".
- **`Board`**
  - É um `table`, com cabeçalho e coluna de horários sticky.
  - A coluna de hoje leva `aria-current="date"`.
  - Badges "Feriado · X" e "Ponto facultativo · X".
- **`CalendarHeader`** mostra três linhas:
  - "Novembro de 2026 · Semana 2 de 5"
  - "Hoje: sexta-feira, 13/11", com o feriado do dia se houver
  - "Próximo feriado: X · domingo, 15/11"

### 5. Editor (passo 8, em `components/editor/`)
- **`extensions.ts`**
  - `createEditorExtensions()` junta:
    - `StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false })`
    - `TaskList`
    - `TaskItem.configure({ nested: true, a11y: { checkboxLabel } })`, com o label em pt-BR
    - `Placeholder`, de `@tiptap/extensions`
  - **Não defina `textDirection`**: ele adicionaria um attr `dir`, que a whitelist rejeita.
  - `extensions.test.ts` fecha o de-risk do passo 2:
    - Um HTML com todos os nós e marcas, passado por `editor.getJSON()`, precisa passar em `validateRichDoc`.
    - `<a>` e `<img>` são descartados.
    - `<h4>` não gera `level: 4`.
- **`EditorToolbar`**
  - Lê o estado com `useEditorState({ editor, selector })` e marca cada botão com `aria-pressed`.
  - Botões em pt-BR: Negrito, Itálico, Riscado, Título 1/2/3, Lista com marcadores, Lista numerada, Lista de tarefas (checkbox), Citação, Desfazer e Refazer.
  - Desfazer e Refazer usam `disabled`, não `aria-pressed`.
- **`TaskEditor`**
  - `useEditor` com `immediatelyRender: true` e `shouldRerenderOnTransaction: false`.
  - As extensões são criadas uma vez, via `useState(() => ...)`.
  - O `onUpdate` passa por uma ref.
  - `editorProps.attributes` leva `aria-labelledby`.
- No jsdom, digitar no ProseMirror não é confiável. Teste pelos botões da toolbar, pelos comandos do editor e pelo clique no checkbox.
- **`TaskModal`**
  - A prop `task?` define o modo: sem ela, é criação.
  - O estado guarda título, cor e conteúdo.
  - Com alterações pendentes, fechar pergunta "Descartar alterações não salvas?".
  - Valida no cliente com `titleSchema` e `validateRichDoc`.
  - O PATCH leva só os campos alterados.
  - Excluir pede confirmação.
  - Erros aparecem em `role="alert"`, via `describeError`.
  - Os `ConfirmDialog` ficam como **irmãos** do `Modal`, não filhos, para os eventos não borbulharem pela árvore do React.

### 6. Montagem (passo 9)
- **`App.tsx`**
  - Props: `{ clock }`.
  - O estado do modal guarda uma **cópia da tarefa** (`{kind: 'edit', task}`), não o id. Assim o modal não desmonta no meio da mutação de exclusão.
  - Drag and drop:
    - `DndContext` só com `PointerSensor` (`distance: 5`), sem `KeyboardSensor`, porque Enter abre o modal.
    - Colisão por `pointerWithin`, com fallback para `rectIntersection`.
    - `DragOverlay` com `dropAnimation={null}`.
    - Anúncios em pt-BR.
  - "Resetar quadro" pede confirmação e fica desabilitado sem tarefas no quadro.
  - Mostra um aviso (toast) com o resultado das ações e os erros.
- **`main.tsx`**
  - `resolveClock(location.search, import.meta.env.DEV, systemClock)`.
  - Monta `StrictMode`, `QueryClientProvider` e `ApiProvider(createApiClient())`.
  - `main.test.tsx` faz `vi.mock('./App')` com uma factory que importa `createElement` de forma dinâmica.
- **`styles/app.css`**
  - Layout de 2 colunas, tabela sticky, as 7 cores das tarefas, o modal e o editor.
  - O editor precisa de CSS para o checklist (`ul[data-type="taskList"]`) e para o placeholder (`p.is-editor-empty:first-child::before`).
- **`README.md`**: requisitos, `npm install`, `npm run dev`, `npm test`/`typecheck`, `?hoje=` e as notas de segurança.

### 7. Validação
1. Delegue ao `test-runner`, passando a lista completa de arquivos criados (`shared/`, `server/`, `web/` e os da raiz). Ele deve cobrir:
   - `npm run typecheck` e `npm test`, com 0 falhas e 0 testes pulados
   - `npm audit --audit-level=high` e `npm audit signatures`
   - os greps de "Regras deste projeto"
2. Corrija o que ele apontar e valide de novo.
3. Se o Stop hook pedir, rode o `e2e-validator`.
4. Reporte o veredito ao usuário e mostre a verificação manual do plano.
5. Ao concluir, apague as seções "Status" e "Próximos passos" deste arquivo e mantenha o resto.
