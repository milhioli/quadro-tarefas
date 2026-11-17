# Quadro de tarefas

Quadro semanal de tarefas, local e em pt-BR.

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

- A API Fastify sobe em `127.0.0.1:3001` e o Vite em `127.0.0.1:5173`, com proxy de `/api` para a API.
- Os dados ficam em `server/data/quadro.sqlite`, que é criado na primeira execução e fica fora do git.
- As portas e o caminho do banco podem ser trocados com um `.env` na raiz (veja o `.env.example`). Nenhuma chave é obrigatória.

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

**Como abrir no celular:** o app só aceita conexões da própria máquina (`127.0.0.1`). Ele não tem login, então abrir pelo Wi-Fi deixaria qualquer pessoa da rede ler e editar as tarefas. Há duas formas:

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
  - o teste sobe o próprio servidor nas portas 3101/5273, com um banco temporário, então dá para rodar com o seu `npm run dev` aberto;
  - para ver o relatório, use `npx playwright show-report e2e/playwright-report`.

## Estrutura

```
shared/   regras puras e validação (slots, dias, cores, schemas zod, movimentos, whitelist do conteúdo rico)
server/   API Fastify + SQLite (node:sqlite), guard de Host/Origin, rotas e repositório
web/      React + Vite: deck, quadro, calendário, modal da tarefa e editor TipTap
```

## Segurança

O app é pensado para **uso local, por um único usuário, sem autenticação**.

- **Só loopback:** a API e o Vite escutam apenas em `127.0.0.1`. Abrir para a rede (Wi-Fi, túnel ou o Vite escutando fora do loopback) exigiria autenticação e TLS, que o app não tem.
- **Horário ocupado:** criar ou editar com `position` numa célula ocupada responde 409 dentro de uma transação, e nada é gravado. Só o arraste (`PUT /position`) troca as tarefas.
- **Guard da API:**
  - O `Host` é conferido por igualdade (contra DNS rebinding).
  - Um `Origin` estranho ou `null` recebe 403.
  - Toda mutação exige o header `X-Quadro-Client: 1`, o que força preflight e bloqueia CSRF.
- **CORS:** está desligado no Vite e não existe na API.
- **Headers:** a API e o Vite respondem com `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` e CSP com `frame-ancestors 'none'`.
- **Conteúdo rico:**
  - É gravado como JSON do ProseMirror validado por uma whitelist estrita de nós, marcas e atributos, com profundidade máxima de 32 e corpo de até 256 KiB.
  - Só é renderizado pelo próprio editor. Nenhum HTML é montado à mão.
  - Links e imagens não existem no editor.
- **Erros:** mensagens genéricas em pt-BR, sem stack trace, e o corpo das requisições não vai para o log.
- **Dependências:** versões exatas, lockfile versionado e `ignore-scripts=true` no `.npmrc`.
- **Rede de saída (só com `npm run dev:agenda`):**
  - A única saída de rede é o `server/src/calendar/guardedFetch.ts`. Ele só fala com `caldav.icloud.com` e `pNN-caldav.icloud.com`, por HTTPS.
  - A URL é validada em toda requisição e em cada redirecionamento, antes de o `Authorization` ser enviado.
  - Há limites de tempo e de tamanho.
  - O XML (`sax`) e o iCalendar (`ical.js`) são tratados como conteúdo não confiável: DOCTYPE é recusado e há limite de iterações em eventos recorrentes.
  - O log nunca registra a senha, os títulos nem as URLs do iCloud.
