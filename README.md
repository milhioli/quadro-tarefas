# Quadro de tarefas

Quadro semanal de tarefas, em pt-BR, com contas e grupos. Por enquanto roda só na própria máquina (`127.0.0.1`).

- **Contas:** cada pessoa entra com Google e escolhe um nome de usuário. O sistema acrescenta um número, e o resultado (ex.: `ana_07`) é o nome pelo qual os outros a encontram.
- **Quadros:** cada conta tem o seu quadro pessoal. Um **grupo** tem um quadro compartilhado: quem criou convida pelo nome de usuário, e a pessoa aceita ou recusa.
- **Deck** à esquerda com as tarefas ainda não agendadas.
- **Quadro** à direita, com colunas de segunda a sexta da semana atual e 34 linhas de 30 minutos (`05:00 – 05:30` até `21:30 – 22:00`).
- Arraste uma tarefa do deck para uma célula, entre células ou de volta para o deck. Cada horário tem uma tarefa só.
- Uma tarefa pode ter **duração**: uma faixa de 30 min ou várias seguidas no mesmo dia (ex.: 05:00 – 20:00).
  - Ela aparece como um cartão alto, que começa na célula do início.
  - Para mudar a duração, **puxe a borda de baixo** do cartão (de 30 em 30 min) ou use o campo **Até** do modal.
- Ao soltar sobre outra tarefa:
  - se as duas têm o mesmo tamanho, elas **trocam** de lugar;
  - se não, aparece o aviso de horário ocupado e nada muda.
- Também dá para agendar sem arrastar: no modal da tarefa, o campo **Quando** escolhe o dia, o horário e até quando vai. Horários ocupados aparecem desabilitados.
- Fora do quadro aparece o calendário brasileiro: mês, "Semana N de M", hoje e o próximo feriado.
- **Feriados** aparecem como **bolinhas** no topo e nos cabeçalhos dos dias: vermelha para feriado nacional, azul para ponto facultativo (Carnaval e Corpus Christi). Clicar numa bolinha abre o modal com os feriados.
- **Resetar quadro** devolve todas as tarefas ao deck, sem apagar nenhuma.
- Cada tarefa abre um modal com título, cor e um editor rico com títulos, listas, **checklist**, citação e desfazer/refazer.

## Requisitos

- Node.js 24 ou mais novo (a API usa o `node:sqlite` embutido)
- npm 10 ou mais novo

## Como rodar

```sh
npm install
npm run dev
```

Abra <http://127.0.0.1:5173>. Use `127.0.0.1`, não `localhost`.

**O app exige login com Google** (veja abaixo). Sem ele configurado, a tela de entrada explica o que falta.

- A API Fastify sobe em `127.0.0.1:3001` e o Vite em `127.0.0.1:5173`, com proxy de `/api` para a API.
- Os dados ficam em `server/data/quadro.sqlite`, que é criado na primeira execução e fica fora do git.
- As portas e o caminho do banco podem ser trocados com um `.env` na raiz (veja o `.env.example`).

### Login com Google

1. No [Google Cloud Console](https://console.cloud.google.com), crie um projeto e configure a **tela de consentimento OAuth**.
   - Os escopos são só os padrão (`openid`, `email` e `profile`), que não exigem verificação do app.
   - Enquanto o app estiver em modo de teste, só entram as contas listadas como usuários de teste.
2. Em **Credenciais → Criar credenciais → ID do cliente OAuth**, escolha **Aplicativo da Web** e cadastre este URI de redirecionamento:
   ```
   http://127.0.0.1:5173/api/auth/google/callback
   ```
3. No `.env` da raiz, preencha:
   ```
   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxx
   QUADRO_ADMIN_EMAIL=seu-email@gmail.com
   ```
4. Rode `npm run dev`, abra <http://127.0.0.1:5173> e clique em **Entrar com Google**.

- **Quem entra com o `QUADRO_ADMIN_EMAIL`** recebe o número `00` (ex.: `ana_00`) e fica com as tarefas que já existiam no banco. Isso é decidido uma vez só, no primeiro acesso.
- **Qualquer conta Google pode entrar** e ganha um quadro pessoal vazio. Como o app só escuta em `127.0.0.1`, na prática são as contas usadas nesta máquina.
- **A agenda da Apple** continua sendo a do `.env` e só aparece para o admin.

### Em outra máquina

```sh
git clone https://github.com/milhioli/quadro-tarefas.git
cd quadro-tarefas
npm install
npx playwright install chromium   # só para o E2E; o ignore-scripts não baixa o navegador
npm test && npm run test:e2e      # confere que está tudo de pé
```

- **O `.env` não vai pelo git.** Recrie a partir do `.env.example`, com as chaves do login Google (e as da agenda da Apple, se for usar).
- **As tarefas também não vão pelo git.** Elas ficam em `server/data/quadro.sqlite`. Para levar as tarefas:
  1. Na máquina de origem, pare o `npm run dev`.
  2. Copie `quadro.sqlite` e também `quadro.sqlite-wal` e `quadro.sqlite-shm`, se existirem: parte dos dados pode estar no `-wal`.
  3. Na máquina nova, coloque os arquivos em `server/data/` antes de subir o servidor.
- As decisões do projeto estão em `docs/plano-original.md` (a base) e `docs/roteiro.md` (as fases e o andamento).
- Quem usa o Claude Code: o fluxo do `CLAUDE.md` depende de agentes e hooks que ficam na configuração do usuário (`~/.claude`), fora do repositório.

### Simular outra data (só em desenvolvimento)

Acrescente `?hoje=AAAA-MM-DD` à URL, por exemplo:

- `http://127.0.0.1:5173/?hoje=2026-11-15`: a semana de 16 a 20/11, com a Consciência Negra na sexta
- `http://127.0.0.1:5173/?hoje=2026-02-15`: a semana do Carnaval
- `http://127.0.0.1:5173/?hoje=2026-12-31`: a semana que atravessa o ano novo

## No celular

Em telas de até 768 px, o quadro com arraste dá lugar a uma **agenda por toque**. Três tags trocam a visualização, e a escolha fica salva no navegador:

- **Dia:** só os horários ocupados do dia escolhido nas abas Seg–Sex.
- **Dia completo:** as 34 faixas do dia. Tocar em "+ livre" abre "Nova tarefa" já com aquele horário.
- **Semana:** os cinco dias em lista.

As tarefas sem horário ficam em "Sem horário", no fim. Para agendar ou mudar o horário, toque na tarefa e use o campo **Quando**.

**Como abrir no celular:** o app só aceita conexões da própria máquina (`127.0.0.1`). Ele já tem login, mas ainda não tem HTTPS nem as proteções para ficar exposto na rede (isso é da fase 2b do `docs/roteiro.md`). Por isso, abrir pelo Wi-Fi continua proibido. Há duas formas:

- Numa janela estreita no computador, ou no modo dispositivo do DevTools.
- No celular Android ligado por cabo USB, com `adb reverse tcp:5173 tcp:5173`, abrindo `http://127.0.0.1:5173` no celular. Enquanto o `adb reverse` estiver ativo, os outros apps do celular também alcançam essa porta.

## Agenda da Apple (opcional)

O quadro pode mostrar os eventos da sua agenda do iCloud. Os dias com evento ganham **uma bolinha roxa**, e clicar nela lista os eventos do dia com o horário à direita.

A integração é **só leitura**: nada é criado nem alterado na sua agenda. De cada evento só saem título, início e fim. Descrição, local e participantes nunca saem do servidor. Os eventos ficam 5 minutos em memória e não vão para o banco.

### Como ligar

1. Em [account.apple.com](https://account.apple.com), vá em **Entrar e segurança → Senhas de app** e gere uma senha chamada **quadro-tarefas**. Não use a senha do Apple ID: ela é recusada.
2. No `.env` da raiz (veja o `.env.example`), preencha:
   ```
   ICLOUD_APPLE_ID=seu-email@icloud.com
   ICLOUD_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
   ICLOUD_CALENDARS=Pessoal          # opcional: só estes calendários
   ```
3. Rode **`npm run dev:agenda`**. O `npm run dev` de sempre **não** liga a agenda, mesmo com as chaves no `.env`.

Se a senha for recusada, o topo mostra "A Apple recusou a senha de app" e o app espera 15 minutos antes de tentar de novo. Isso evita bloquear o seu Apple ID.

### Antes de ligar, saiba que

- **A senha de app não tem escopo.** Ela vale para todo o iCloud: e-mail (ler e enviar), contatos e agenda com escrita. O "somente leitura" é do código, não da senha. Para revogar, apague a senha "quadro-tarefas" em account.apple.com.
- **Ela fica em texto puro no `.env`.** Qualquer programa rodando com o seu usuário consegue ler o arquivo. Confira que a pasta do projeto não está sincronizada no OneDrive ou em outra nuvem.
- **Em rede corporativa com inspeção de TLS,** o proxy vê a credencial. Com `NODE_TLS_REJECT_UNAUTHORIZED=0` no ambiente, o app se recusa a ligar a agenda.
- **LGPD:** se a agenda tiver compromissos de trabalho que citem colegas ou associados, a exceção de uso particular da LGPD (art. 4º, I) pode não se aplicar. Prefira listar só os calendários pessoais em `ICLOUD_CALENDARS` e consulte o encarregado de dados antes de incluir os de trabalho.

## Testes

```sh
npm test            # Vitest: shared, server e web
npm run typecheck   # TypeScript nos três pacotes e no e2e
npm run test:e2e    # Playwright no navegador (desktop e celular)
```

- Os testes da API usam SQLite real em arquivo temporário.
- Os testes do frontend rodam no jsdom, com uma API fake em memória que aplica as mesmas regras de posição do servidor.
- O arraste, o layout de celular e as jornadas completas rodam no **Playwright**, na pasta `e2e/`:
  - antes da primeira vez, rode `npx playwright install chromium`;
  - o teste sobe o próprio servidor (`npm run dev:e2e`) nas portas 3101/5273, com um banco temporário, então dá para rodar com o seu `npm run dev` aberto;
  - esse servidor troca o Google por um login de teste que só aceita e-mails `@example.com`, e nunca liga a agenda. Cada teste entra com uma conta nova;
  - para ver o relatório, use `npx playwright show-report e2e/playwright-report`.

## Estrutura

```
shared/   regras puras e validação (slots, dias, cores, schemas zod, movimentos, whitelist do conteúdo rico)
server/   API Fastify + SQLite (node:sqlite), guard de Host/Origin, login e sessão, rotas e repositórios
web/      React + Vite: login, quadros e grupos, deck, quadro, calendário, modal da tarefa e editor TipTap
```

## Segurança

O app é pensado para **uso local, em `127.0.0.1`, com login Google e quadros compartilhados entre as contas desta máquina**.

- **Só loopback:** a API e o Vite escutam apenas em `127.0.0.1`. Abrir para a rede (Wi-Fi, túnel ou o Vite escutando fora do loopback) exige HTTPS, limites de uso e as outras proteções da fase 2b, que ainda não existem.
- **Login:**
  - O login Google usa authorization code com PKCE, `state` e `nonce`, guardados no servidor por 10 minutos.
  - A assinatura do ID token é conferida pelas chaves do Google, e só entra e-mail verificado.
  - O endereço de volta sai do `APP_ORIGIN`, nunca do `Host` da requisição.
- **Sessão:**
  - O cookie é `HttpOnly` e `SameSite=Lax`, com um token aleatório de 256 bits. O banco guarda só o sha256 dele.
  - A sessão vence com 30 dias sem uso ou 90 dias no total. Conta desativada perde o acesso na hora.
  - Toda rota exige sessão, menos uma lista fechada que é conferida em teste.
- **Acesso aos quadros:** é decidido no servidor, pela lista de membros. A tarefa de um quadro que não é seu responde 404, igual a uma que não existe.
- **Horário ocupado:** criar ou editar com `position` numa célula ocupada responde 409 dentro de uma transação, e nada é gravado. Só o arraste (`PUT /position`) troca as tarefas.
- **Guard da API:**
  - O `Host` é conferido por igualdade (contra DNS rebinding).
  - Um `Origin` estranho ou `null` recebe 403, e toda mutação precisa mandar o `Origin`.
  - No `127.0.0.1` o cookie não separa porta. Por isso o guard também é o que barra outros projetos locais.
  - Toda mutação exige o header `X-Quadro-Client: 1`, o que força preflight e bloqueia CSRF.
- **CORS:** está desligado no Vite e não existe na API.
- **Headers:** a API e o Vite respondem com `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` e CSP com `frame-ancestors 'none'`.
- **Conteúdo rico:**
  - É gravado como JSON do ProseMirror validado por uma whitelist estrita de nós, marcas e atributos, com profundidade máxima de 32 e corpo de até 256 KiB.
  - Só é renderizado pelo próprio editor. Nenhum HTML é montado à mão.
  - Links e imagens não existem no editor.
- **Erros e log:** mensagens genéricas em pt-BR, sem stack trace. O log guarda só o método, o caminho sem a query e o status: nunca o corpo, os cookies, o `code` do Google ou o e-mail.
- **Dependências:** versões exatas, lockfile versionado e `ignore-scripts=true` no `.npmrc`.
- **Rede de saída:**
  - A única saída de rede é o `server/src/calendar/guardedFetch.ts`, com uma lista de hosts por provedor, sempre por HTTPS.
  - O login Google só fala com `accounts.google.com`, `oauth2.googleapis.com` e `www.googleapis.com`, sem seguir redirecionamentos.
  - A agenda (só com `npm run dev:agenda`) só fala com `caldav.icloud.com` e `pNN-caldav.icloud.com`.
  - A URL é validada em toda requisição e em cada redirecionamento, antes de o `Authorization` ser enviado.
  - Há limites de tempo e de tamanho.
  - O XML (`sax`) e o iCalendar (`ical.js`) são tratados como conteúdo não confiável: DOCTYPE é recusado e há limite de iterações em eventos recorrentes.
  - O log nunca registra a senha, os títulos nem as URLs do iCloud.
