<!-- Plano aprovado da Fase 2b (19/11/2026). O andamento fica em docs/roteiro.md. -->
# Plano — Fase 2b: preparar o app para sair do 127.0.0.1 (código + pacote de deploy testado localmente)

## Contexto
A 2a está pronta e foi enviada em 19/11/2026 (`7abcacf`): contas Google, quadros, grupos e convites, tudo no 127.0.0.1. Antes de qualquer exposição na rede, o roteiro e a revisão de segurança exigem:
- admin com auditoria (R10);
- limites e tetos (R7);
- apagar a própria conta (R9);
- `/privacidade` com o `QUADRO_CONTACT_EMAIL`;
- cookies `__Host-` com `Secure`;
- estáticos com CSP estrita (R11);
- `trustProxy` e `secure_delete`;
- retenção.

**Decisões do usuário (19/11/2026):**
- A 2b vem antes da Fase 3.
- Ainda não há VPS, domínio nem bucket. A 2b entrega o código e um **pacote de deploy testado localmente com Docker** (Docker 29 e Compose v5 instalados).
- **Agenda:** cada pessoa vai conectar a própria (Fase 4). Em produção o servidor **recusa** a agenda global (`--agenda`, `ICLOUD_*`). No local, o `npm run dev:agenda` continua funcionando.
- **Apagar a conta:**
  - os grupos que a pessoa criou **passam ao membro ativo mais antigo**, e um grupo sem mais ninguém é apagado;
  - as tarefas que ela criou em grupos alheios **ficam, sem autor**.
- **Admin:** uma **tela simples "Contas"**.
- **Retenção com prazo:** conta **desativada** é apagada depois de **12 meses**; conta **sem uso** depois de **24 meses** (o aviso por e-mail fica para quando o app enviar e-mail).
- **Cadastro:** continua aberto, mitigado pelos limites desta fase.

**Resultado:** o `docker compose` local sobe Caddy (TLS), o Node (sempre em 127.0.0.1, no namespace do Caddy) e o Litestream, servindo `https://localhost`. Na VPS, basta trocar o arquivo de ambiente.

**Revisões feitas:**
- dois agentes de planejamento leram o código;
- o `cybersecurity-reviewer` deu "aprovado com ressalvas", com 1 bloqueante, 10 recomendados, opcionais e 3 itens encaminhados. Todos foram incorporados abaixo, e o resumo está na seção "Revisão de segurança".

## Decisões de desenho

### Modo público (servidor)
- **Dois sinais juntos:** `NODE_ENV=production`, definido no Dockerfile, **e** `APP_ORIGIN` em `https:`. Só um dos dois faz o servidor recusar a subida. O dev e o `dev:e2e` nunca têm `production`.
- **Novo `server/src/deployMode.ts`:** `resolveDeployMode(env, argv, auth)` devolve `'local'` ou `'public'`. As recusas não ecoam valores:
  - http em produção;
  - https sem `production`;
  - `NODE_TLS_REJECT_UNAUTHORIZED=0`;
  - falta de `GOOGLE_*`, `QUADRO_ADMIN_EMAIL`, `QUADRO_CONTACT_EMAIL`, `QUADRO_OPERATOR_NAME` ou de um `DB_PATH` explícito;
  - `--agenda`;
  - qualquer `ICLOUD_*` não vazio.
- **`auth/config.ts`:** o `parseAppOrigin` passa a aceitar loopback http (como hoje) ou `https:` sem path, query, hash e userinfo. Ganha `contactEmail` e `operatorName`. O `isLoopbackOrigin` não muda, e o `e2eEntry` continua só em loopback.
- **Guard:**
  - o `GuardOptions` ganha `publicHost: string | null` (o nome nunca é `allowedHosts`);
  - `publicGuardOptions(appOrigin)` aceita só o Host **igual** a `appOrigin.host` e o Origin igual a `appOrigin.origin`;
  - o guard lê sempre o `request.headers.host` cru, nunca `request.hostname` nem `protocol`.
- **`trustProxy`:** `buildApp({ behindProxy })` usa `trustProxy: '127.0.0.1'` só no modo público. O `Caddyfile` deixa escrito que **não há `trusted_proxies`**: o Caddy sobrescreve o `X-Forwarded-For` que vem do cliente.
- **Cookies:**
  - **Sessão:** já é `__Host-quadro_session` com `Secure` em https.
  - **OAuth:** passa a `__Host-quadro_oauth` com `Path=/` em https; em http continua `quadro_oauth` com `Path=/api/auth`.
  - **Logins pendentes:** o `PENDING_LOGIN_MAX` sobe para 10 000.
- **Health check:** o guard não ganha exceção. O `HEALTHCHECK` usa `node:http` em `127.0.0.1:3001/api/health` com o `Host` do `APP_ORIGIN`.
- **Pragmas e desligamento:** `secure_delete=ON` e `busy_timeout=5000`; no desligamento, um fallback de 10 s.

### Estáticos e CSP (servidor)
- **Novo `server/src/http/webDist.ts`, sem `@fastify/static`:** a rota curinga dele quebraria a lista fechada de rotas públicas.
  - O `loadWebDist(dir)` lê para a memória, uma vez, o `index.html` e os arquivos diretos de `assets/`, com nome em whitelist e extensão num mapa fixo.
  - As rotas são `GET /` e `GET /privacidade` (servem o index) e `GET /assets/:file`, todas `config.public`.
  - Não há fallback de SPA.
- **Headers do HTML:**
  - CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
  - `no-store`;
  - uma `Permissions-Policy` mínima (`camera=(), microphone=(), geolocation=()`).
- **Outros headers:**
  - `/assets/*`: `public, max-age=31536000, immutable`;
  - toda resposta ganha COOP e CORP `same-origin`;
  - o JSON mantém a CSP de hoje;
  - o HSTS fica só no Caddy.
- **Quando liga:** só quando o `buildApp` recebe um `webDist`, ou seja, no modo público ou no E2E de produção.
- **Novo `GET /api/info`, público:** devolve `{contactEmail, operatorName}`.

### Limites de taxa e tetos (servidor)
- **Novo `server/src/http/rateLimit.ts`, sem dependência:**
  - janela fixa em memória com o relógio injetado, poda por ordem de inserção e `maxKeys`;
  - `ipRateKey` usa o IPv4 ou o /64 do IPv6, dividindo por regex: o literal `'::'` entre aspas nunca aparece;
  - código novo `RATE_LIMITED` (429). Os tetos respondem 409 `CONFLICT`.

| Limite | Onde | Chave | Regra | Ao estourar |
|---|---|---|---|---|
| `loginStart` | `GET /auth/google/start` | IP | 20 / 10 min | 303 `/?login=limite`, sem cookie |
| `signupGlobal` | callback, só se `findBySub` for nulo | global | 30 / 1 h | 303 `/?login=limite`, sem conta |
| `signupPerIp` | idem | IP | 5 / 24 h | idem |
| `signupPerSub` | idem | sha256 do `sub` | 2 / 24 h | idem (corta o ciclo cadastrar → apagar → cadastrar) |
| `mutation` | hook raiz, método não seguro com sessão | usuário | 300 / 5 min | 429 |
| `groupCreate` | `POST /boards` | usuário | 10 / 1 h | 429 |
| `invite` | `POST /boards/:id/invites`, depois de checar o dono e antes de buscar o handle | usuário | 30 / 24 h | 429 |

- **Tetos no banco, dentro da transação:**
  - 20 grupos por dono;
  - 50 membros por grupo, contando os convidados;
  - 20 convites pendentes por grupo;
  - 500 tarefas por quadro (O4);
  - `content` somado de 8 MiB por quadro e de **32 MiB por dono**, somando o quadro pessoal e os grupos dele.
- **Disjuntor global de disco:** se `page_count × page_size` passar de `QUADRO_DB_MAX_MB` (padrão 1024), criar e editar tarefa respondem 503 `STORAGE_FULL`, com mensagem em pt-BR. Ler e apagar continuam funcionando.
- **Convites:**
  - no máximo **1 convite pendente por par** (quem convida × convidado), somando todos os grupos;
  - recusar apaga os outros pendentes do mesmo convidante para essa pessoa;
  - **um convite pendente expira em 30 dias**, pelo job de retenção.
- **Bloqueio de reconvite:**
  - vale por par, durante 30 dias;
  - é gravado quando a pessoa recusa ou sai do grupo, e então vale contra o dono **atual** do grupo;
  - não vale quando o dono a remove;
  - a mensagem é neutra: "Não é possível convidar essa pessoa agora."
- **Fora dos limites:** o login de teste (só no `e2eEntry` e nos testes) e as GETs.
- **Log:** só `{kind, status}`, nunca o IP.

### Migração 4
- **`invite_blocks(invitee_id, inviter_id, created_at)`:** chave primária no par, um `CHECK` contra o próprio par e cascata.
- **`users.disabled_at`:** permite contar os 12 meses da conta desativada.
- **Índices:** `sessions(expires_at)`, `audit_log(actor_user_id)`, `audit_log(target_kind, target_id)`, `tasks(created_by)`, `board_members(invited_by)` e `users(status, last_seen_at)`.
- **Teste:** o `migrations.test.ts:175` passa a usar `MIGRATIONS.length` em vez do 3 fixo. Entra também um teste da migração v3→v4.
- **`AuditAction`:** ganha `account.delete`, `board.transfer`, `user.disable`, `user.enable` e `admin.users.list`.

### Admin, sessão e último acesso
- **`last_seen_at`:** o `startSession` passa a chamar o `touch`, e o hook de sessão chama no máximo uma vez por hora. Hoje ele nunca é chamado.
- **Conta desativada:** o hook apaga a sessão dela. Hoje o `resolve` renova a sessão antes de checar.
- **`userRepository`:** ganha `listForAdmin()` e `setStatus(id, status)`. Ao desativar, `setStatus` apaga as sessões e grava o `disabled_at`.
- **`routes/admin.ts`:**
  - O `preHandler requireAdmin` responde com o 404 de rota desconhecida.
  - `GET /api/admin/users` (exige `X-Quadro-Client`, como no O3; teto de 500 linhas) devolve `AdminUser = {id, handle|null, email, status, lastSeenAt}`, sem nada além (R10). A chamada grava `admin.users.list`.
  - `POST /api/admin/users/:userId/disable`, `/enable` e `/delete` (este último só para conta **desativada**, reaproveitando o `accountRepository`), sem corpo, respondem 204.
  - A própria conta dá 409.
  - A auditoria só grava quando algo muda.
- **Login de conta desativada:** volta com `?login=desativada`. No login de teste, continua 403.

### Apagar a própria conta: `DELETE /api/me`
- **A rota:**
  - é `allowPending` e não tem corpo;
  - o admin recebe 409;
  - **exige uma sessão criada há no máximo 10 minutos** (`sessions.created_at`). Fora disso, 403 `REAUTH_REQUIRED`, e o diálogo oferece "Entrar de novo";
  - a resposta é 204 e limpa o cookie;
  - a rota apaga a sugestão de nome (`suggestions.delete`).
- **`repositories/accountRepository.ts`**, `deleteAccount(id)` (usado também pela retenção e pelo admin), numa **única** `withTransaction` com SQL próprio:
  1. Em cada grupo de que a pessoa é dona:
     - o herdeiro é o membro `active` mais antigo, de preferência com a conta ativa;
     - apaga a linha de dono, promove o herdeiro e incrementa o `version`;
     - sem herdeiro, `DELETE` do quadro, com cascata.
  2. Cancela os convites pendentes que ela enviou.
  3. Incrementa o `version` dos grupos em que ela era editora.
  4. Apaga o `target_id` da auditoria quando o alvo é ela.
  5. `DELETE FROM users`.
     - **Vai em cascata:** sessões, quadro pessoal e tarefas, convites recebidos e bloqueios.
     - **Vira NULL:** o `created_by` (as tarefas de grupo ficam sem autor), o `invited_by` e o `actor`.
- **Auditoria depois do commit:** `board.transfer`, `board.delete` e `account.delete`.

### Retenção
**Novo `server/src/retention.ts`:** `runRetention(db, now)` devolve só as contagens.

| O quê | Prazo | O que acontece |
|---|---|---|
| Sessões | `expires_at` vencido | são apagadas |
| Auditoria | 180 dias | a linha é **apagada** (anonimizar não basta: o id do quadro, junto com o dono, reidentifica quem agiu) |
| Bloqueios de reconvite | 30 dias | são apagados |
| Convites pendentes | 30 dias | são apagados |
| Contas sem perfil | 7 dias sem uso | são apagadas |
| Contas desativadas | 12 meses depois do `disabled_at` | `deleteAccount` |
| Contas sem uso | 24 meses de `last_seen_at` | `deleteAccount`; **o admin fica fora** |

- **Execução:** roda na subida e depois a cada 24 h, com `setInterval(...).unref()` limpo no `onClose`.
- **Log:** só as contagens.
- **Onde não roda:** no `e2eEntry`.

### Web
- **TipTap:** `injectCSS: false` no `TaskEditor`. As regras base do `.ProseMirror` são copiadas literalmente de `@tiptap/core` 3.34.0 `src/style.ts` para o `app.css`. Um teste confere que não existe `style[data-tiptap-style]`.
- **Cliente:**
  - métodos `getInfo`, `deleteAccount`, `listAccounts` (com `X-Quadro-Client`), `setAccountStatus` e `deleteDisabledAccount`;
  - um 429 sem JSON vira `RATE_LIMITED`;
  - tratamento de `REAUTH_REQUIRED` e `STORAGE_FULL`.

  Os hooks `useAccounts` usam `gcTime: 0` e não refazem a busca no foco. A API fake acompanha.
- **Avisos de login:**
  - `limite` e `desativada` entram na lista fechada da URL;
  - `conta-apagada` é um aviso interno do `Shell`, nunca lido da URL;
  - o aviso informativo usa `role="status"`.
- **`/privacidade`:** o `main.tsx` decide pelo `pathname` (sem `Shell` e sem `/api/me`). O contato e o responsável vêm do `/api/info`. O texto declara (art. 9):
  - o que é coletado: o Google como provedor de login, o nome, o e-mail e o id;
  - o que é digitado: tarefas e grupos;
  - o último acesso;
  - a auditoria sem conteúdo;
  - o IP, só em memória, por até 24 h, junto com o hash do `sub`, para os limites;
  - os logs técnicos e seus limites;
  - o backup: até 10 dias depois da exclusão;
  - o provedor e o país da VPS e do bucket, como **rascunho, com marcadores para você preencher**;
  - que o admin vê o e-mail, o handle, o status e o último acesso;
  - o destino dos grupos e das tarefas de grupo quando a conta é apagada;
  - todos os prazos da retenção;
  - os dois cookies estritamente necessários;
  - os direitos do art. 18 e como exercê-los, inclusive com a conta desativada (pelo contato).
- **`AppFooter`:** links para "Privacidade" e o `mailto:`, no login, no primeiro acesso e no app.
- **"Minha conta":**
  - o `DeleteAccountDialog` é um `alertdialog` e explica a transferência dos grupos, as tarefas que ficam e o backup;
  - lista os grupos que a pessoa criou;
  - pede que ela **digite o handle**;
  - com `REAUTH_REQUIRED`, mostra "Por segurança, entre de novo" com o link do login Google.
- **"Contas" (só aparece para `role === 'admin'`; quem decide é o servidor):**
  - a lista mostra o handle em `<bdi>`, o e-mail, o status e o último acesso;
  - os botões são "Desativar" (com confirmação), "Reativar" e "Apagar" (só em conta desativada, com confirmação);
  - a linha do próprio admin não tem botão.

### E2E
- **Projeto `producao`:**
  - um segundo `webServer` roda `npm run dev:e2e:static`, que faz o build e sobe o `e2eEntry --static` na porta única 3201;
  - o `--static` vem só da linha de comando e recusa subir sem o `web/dist`;
  - as recusas do `e2eEntry` continuam valendo.
- **Fixtures:**
  - o `clientHeaders()` tira o `Origin` do `baseURL` do projeto, e o `openAs` também;
  - os servidores recebem um contato e um responsável fictícios.
- **`producao.spec.ts`:**
  - a CSP exata e o `no-store` no HTML;
  - o `immutable` no JS;
  - 404 em `/.env` e em `/nao-existe`;
  - nenhum `<style>` com o editor aberto;
  - `white-space: break-spaces` no editor.

  As jornadas do editor e do arraste ganham `@producao`. A do feriado (`?hoje=`) fica fora.
- **`privacidade.spec.ts`:** a página abre sem login e mostra o contato, e o link do rodapé funciona.
- **`contas.spec.ts`:**
  - apagar a conta, com o grupo passando para a Bia (a sessão é recém-criada, então a reautenticação já está satisfeita);
  - o admin desativa a Bia, ela cai, e ao reativar ela volta;
  - o admin apaga a conta desativada;
  - quem não é admin não vê "Contas" e recebe 404.
- **Os limites** ficam só nos testes de API.

### Pacote de deploy (`deploy/`)
- **`tsx` em produção:** vai para `dependencies`, na mesma versão exata.
  - `server start` = `node --import tsx src/index.ts`.
  - A raiz ganha `build`, `start` e `dev:e2e:static`.
- **`.dockerignore` em allowlist:** o contexto do build é a raiz, e um `.env` no `.dockerignore` excluiria só o da raiz.
  - Ele começa com `*` e libera `package.json`, `package-lock.json`, `.npmrc`, `tsconfig.base.json`, `server/`, `shared/` e `web/`.
  - Depois volta a excluir `**/.env*`, `server/data/`, os testes, `server/test/`, `web/src/test/` e `web/dist/`.
- **`deploy/Dockerfile`:**
  - multi-stage, com `npm ci --ignore-scripts` explícito em todos os estágios;
  - Node 24 slim fixado por digest, `NODE_ENV=production` e usuário `node`;
  - código só de leitura, só o `/data` gravável e o npm removido do runtime;
  - o `HEALTHCHECK` com o Host público;
  - nenhum script de shell.
- **`deploy/compose.yaml`:**
  - **Rede:** o Caddy é dono do namespace, e o app entra com `network_mode: "service:caddy"`.
  - **Portas:** `${BIND_IP:-127.0.0.1}:80/443`.
  - **Variáveis:** `environment:` com **chaves explícitas por serviço**, sem `env_file`. As credenciais do bucket ficam só no Litestream, e o segredo do Google só no app. `HSTS_MAX_AGE` é `${HSTS_MAX_AGE:?}`, obrigatório.
  - **Endurecimento nos três serviços:** `cap_drop: [ALL]`, `no-new-privileges` e `read_only` quando dá. O Caddy recebe `NET_BIND_SERVICE`. O Litestream roda com usuário não root, no uid do volume.
  - **Armazenamento e logs:** volumes nomeados e `json-file` com rotação.
- **`deploy/Caddyfile`:**
  - `admin off`, um único site `{$APP_DOMAIN}` e `request_body max_size 1MB`;
  - compressão só fora de `/api`;
  - `header -Server`, o HSTS e `reverse_proxy 127.0.0.1:3001`;
  - sem `bind`, sem log de acesso e sem `trusted_proxies`, com comentário explicando;
  - o log de erro passa pelo encoder `filter`, com o IP mascarado e a query apagada. Se a versão não suportar, o prazo do log é declarado na `/privacidade`.
- **Litestream 0.5:**
  - `deploy/litestream.yml` (S3 compatível): snapshot a cada 24 h, retenção de 168 h;
  - `deploy/litestream.local.yml`: réplica em arquivo, com **retenção curta (1 h)** para conferir no teste local que a poda apaga de fato.
- **Arquivo de ambiente fora do repositório:** `%USERPROFILE%\.quadro\deploy.env` no Windows e `/etc/quadro/deploy.env` na VPS, com `chmod 600`. Ele vai sempre por `--env-file`. O `deploy/.env.example` documenta as chaves.
- **`.gitattributes`:** `eol=lf` para `deploy/`.
- **Versões:** Node 24.x, Caddy 2.11.x e Litestream 0.5.x, fixadas por digest, com no mínimo 2 semanas de idade.

### Documentação
- **`docs/fase-2b.md`:** cópia deste plano.
- **`docs/deploy.md`:**
  - **Teste local no Windows:**
    - importar a CA do Caddy em `CurrentUser\Root` e removê-la depois pela impressão digital;
    - no fim, `docker volume rm` do `caddy_data`.
  - **Checklist da VPS:**
    - DNS, firewall, `chmod 600` e `HSTS_MAX_AGE` de 31536000 ou mais, conferido com `curl -sI`;
    - verificação em duas etapas na conta Google do admin;
    - **um client OAuth próprio para produção**, de preferência num projeto Google separado, só com o redirect do domínio, e publicado;
    - com o IP real atrás do Docker conferido.
  - **Bucket:**
    - **privado**, com **chave restrita a ele ou ao prefixo**;
    - **versões não correntes expirando em 2 dias ou menos**;
    - cifra no provedor.
  - **Restauração:**
    - o ensaio é feito num volume separado;
    - restaurar **sempre até o ponto mais recente**, porque um ponto anterior ressuscita contas apagadas;
    - para levar um banco existente para a VPS, usar `VACUUM INTO`.
  - **Atualização e rollback.**
- **`docs/incidente.md`:** passos que o usuário consegue executar na 2b:
  1. Conter o incidente: `docker compose stop app`.
  2. Derrubar todas as sessões, com um comando pronto.
  3. Trocar o `GOOGLE_CLIENT_SECRET` e a chave do bucket.
  4. Levantar os e-mails a avisar pela tela "Contas" e mandar em cópia oculta.
  5. Comunicar a ANPD e as pessoas afetadas em até 3 dias úteis (6 para agente de pequeno porte).
  6. Guardar o registro do incidente.

  As etapas da Apple e do Google ficam "a partir da Fase 4", e o aviso no app (`POST /api/admin/notice`) fica registrado na Fase 4.
- **CLAUDE.md:**
  - **Premissa:** o dev continua só em loopback, e a produção só pelo `deploy/`.
  - **Agentes nunca:**
    - leem o arquivo de ambiente do deploy;
    - montam, copiam ou leem volumes do deploy;
    - rodam `docker logs`, `inspect`, `exec env` ou `up` no stack real.
  - **Comando permitido, escrito por extenso:** `docker compose --env-file deploy/.env.example -f deploy/compose.yaml config --quiet`, além do `docker build`.
  - **Também entram:**
    - os arquivos de deploy não são exceção aos termos proibidos;
    - o contrato novo da API (`REAUTH_REQUIRED`, `RATE_LIMITED`, `STORAGE_FULL` e os 409 dos tetos);
    - a lista pública e os cookies;
    - as armadilhas da CSP;
    - **a nota "cookie entre portas" é reescrita, não dada por resolvida:** o `__Host-` não isola porta. Em produção, a garantia vem de um host usado só pelo app. No teste em `https://localhost`, o Chrome também manda o cookie para o `http://localhost` de outras portas.
- **README:** a seção "Deploy".
- **`.env.example`:** `QUADRO_CONTACT_EMAIL`, `QUADRO_OPERATOR_NAME`, `QUADRO_DB_MAX_MB` e o que é obrigatório em produção.
- **`docs/roteiro.md`:**
  - o Andamento;
  - a tabela de retenção: backup até 10 dias, auditoria **apagada** aos 180 dias, conta sem perfil 7 dias, convite pendente 30 dias, desativada 12 meses, sem uso 24 meses, IP e hash do `sub` em memória por 24 h;
  - o registro da troca de `@fastify/static` e `@fastify/rate-limit` por código próprio;
  - o aviso do admin vai para a Fase 4.

## Ordem de implementação (cada passo vai ao `test-runner` antes do seguinte)
0. `docs/fase-2b.md` e o Andamento.
1. **shared:** os códigos `RATE_LIMITED`, `REAUTH_REQUIRED` e `STORAGE_FULL`, os tipos `PublicInfo`, `AdminUser` e `UserStatus`, os schemas de parâmetros, o `PRIVACY_PATH` e o `LOGIN_OUTCOMES` (`limite` e `desativada`).
2. **Banco:** a migração 4 e os pragmas.
3. **`rateLimit.ts`:** o módulo sozinho.
4. **Modo público:** configuração, guard, `deployMode`, `/api/info` e `index.ts`.
5. **Servidor web:** o `webDist`, a CSP do HTML, o `behindProxy` e o `--static` do `e2eEntry`.
6. **Cookies e testes:** os cookies `__Host-`, o `PENDING_LOGIN_MAX` e o `createTestApp({publicOrigin})`.
7. **Limites:** os limites ligados, os tetos (incluindo o conteúdo por dono e o disjuntor de disco) e as regras de convite e de bloqueio.
8. **Admin:** a sessão da conta desativada, o `last_seen_at`, as rotas de admin (inclusive apagar a conta desativada) e o `?login=desativada`.
9. **Apagar a conta:** `DELETE /api/me` com reautenticação, e o `accountRepository`.
10. **Retenção:** com os prazos novos.
11. **Web, parte 1:** o TipTap, o `tsx` em `dependencies` e os scripts (`npm ls`, `npm audit` e as assinaturas).
12. **Web, parte 2:** o cliente, os hooks e a API fake; os avisos e o rodapé; a `/privacidade`; a "Minha conta"; a "Contas".
13. **E2E:** o projeto `producao`, o `clientHeaders()` e as specs novas, com as jornadas atuais verdes.
14. **Pacote de deploy.** O `test-runner` valida com:
    - `docker build`;
    - o `docker run --rm --entrypoint node <imagem> -e ...`, que **falha se houver `.env`, `.git` ou `server/data`** na imagem;
    - o `compose config --quiet` com o exemplo, e o `--format json` também com o exemplo, para conferir que cada serviço só recebe as próprias chaves;
    - o `caddy validate`;
    - os greps em `deploy/`.
15. **Documentação:** `deploy.md`, `incidente.md`, CLAUDE.md, README, `.env.example` e roteiro.
16. **Teste humano e commit**, só com o seu pedido.

## Testes essenciais
- **Servidor:**
  - **Modo público:**
    - todas as recusas do `deployMode`, sem ecoar valores;
    - o guard com `publicHost`: host exato e em maiúsculas passam; `127.0.0.1:3001`, `host:443`, `host.evil.com`, outro Origin e `X-Forwarded-Host` são recusados;
    - num `main()` público, o health responde 200 com o Host público e 403 com o de loopback.
  - **Estáticos:**
    - a CSP exata, sem `unsafe-*`, e a `Permissions-Policy`;
    - o `no-store` e o `immutable` nos lugares certos;
    - 404 para traversal, dotfile e `/index.html`.
  - **Proxy e cookies:**
    - o `X-Forwarded-For` só vale com `behindProxy`, e nunca vai para o log;
    - os cookies `__Host-` têm `Secure`, `HttpOnly`, `Lax`, `Path=/` e não têm `Domain`.
  - **Limites e tetos:**
    - cada limite, com relógio mutável, inclusive o ciclo de cadastrar, apagar e cadastrar de novo cortado pelo `signupPerSub`;
    - cada teto responde 409 e desfaz a transação;
    - o disjuntor de disco responde 503 em criar e editar, mas apagar continua funcionando;
    - 1 convite pendente por par, recusar limpa os outros, e o bloqueio dura 30 dias.
  - **Admin:**
    - quem não é admin recebe o 404 de rota desconhecida, e o anônimo recebe 401;
    - a lista sem `X-Quadro-Client` dá 403;
    - desativar a si mesmo dá 409;
    - a pessoa desativada recebe 401 na sessão e `desativada` no login;
    - apagar uma conta ativa é recusado;
    - o IDOR continua coberto.
  - **Apagar a conta:**
    - uma sessão com mais de 10 minutos recebe `REAUTH_REQUIRED`;
    - o grupo passa ao membro mais antigo, e o grupo sem mais ninguém some;
    - os convites enviados são cancelados;
    - o `created_by` vira NULL;
    - as outras sessões da pessoa recebem 401;
    - a auditoria fica anonimizada;
    - o `foreign_key_check` volta vazio;
    - o admin recebe 409.
  - **Retenção:** cada linha da tabela, nas bordas (179 e 181 dias, 12 meses, 24 meses), e o admin nunca é apagado por falta de uso.
- **Web:**
  - o cliente e os hooks;
  - o `login.ts` (o aviso `conta-apagada` não vem da URL);
  - a `PrivacyPage` (sem `getMe`);
  - o `AppFooter`;
  - o `DeleteAccountDialog` (pede o handle; com `REAUTH_REQUIRED` oferece entrar de novo);
  - o `AccountsModal` (sem botão na própria linha; "Apagar" só em conta desativada);
  - a `SessionBar`;
  - o `Shell`;
  - o `TaskEditor` sem `<style>`.
- **E2E:** o que está na seção E2E.

## Verificação
- **`test-runner`:**
  - typecheck dos 5 alvos;
  - `npm test`;
  - os testes irmãos;
  - os greps, inclusive em `deploy/`;
  - `npm audit` e as assinaturas;
  - no passo 14, as checagens de imagem e de compose.
- **E2E:** o `e2e-validator` tenta rodar. Se recusar, você roda `npm run test:e2e`.
- **Teste humano (local, com Docker):**
  1. Cadastre no Google o redirect `https://localhost/api/auth/google/callback`, no client de **teste**. Depois preencha o `%USERPROFILE%\.quadro\deploy.env` a partir do exemplo.
  2. Rode `docker compose --env-file "%USERPROFILE%\.quadro\deploy.env" -f deploy/compose.yaml up -d --build`. O app deve ficar `healthy`.
  3. Importe a CA. Confira que `https://localhost` abre com cadeado válido e que o `http` redireciona.
  4. No DevTools, confira:
     - os cookies `__Host-`;
     - a CSP exata;
     - o HSTS com `max-age=0`.

     Depois, sem nenhuma violação no console: crie uma tarefa com checklist, arraste, redimensione, abra os modais e cole rich text de outro site.
  5. Teste o limite por IP com o `X-Forwarded-For` forjado: faça 21 starts com valores diferentes. O 21º precisa ser limitado.
  6. Entre como admin e como uma segunda conta, e monte um grupo. Em "Contas", desative a segunda conta e confira que ela cai. Reative.
  7. Apague a segunda conta: o grupo dela, do qual você é editor, deve passar para você; o grupo só dela deve sumir; e as tarefas que ela criou no seu grupo devem ficar.
  8. Revise o texto da `/privacidade` e preencha os marcadores.
  9. Ensaie a restauração do Litestream num volume separado e confira que a poda de 1 h apaga de fato. Depois rode `down` e `up`, e os dados devem continuar lá.
  10. Remova a CA pela impressão digital, rode `down` e `docker volume rm` do `caddy_data`.

## Revisão de segurança (`cybersecurity-reviewer`, 19/11/2026): aprovado com ressalvas
- **Bloqueante:** o `.dockerignore` em allowlist, mais a checagem de que a imagem não leva `.env`, `.git` nem `server/data`. Incorporado.
- **Recomendados, todos incorporados:**
  1. Bucket privado, chave mínima, versões não correntes expirando em 2 dias ou menos, cifra e poda conferida no teste local.
  2. `--ignore-scripts` explícito, endurecimento nos três serviços e variáveis por serviço.
  3. Arquivo de ambiente fora do repositório; regras de agente sobre volumes e logs; CA removida; client OAuth de produção separado.
  4. HSTS obrigatório, filtro no log de erro, sem `trusted_proxies` e teste de XFF forjado.
  5. Reautenticação de 10 minutos para apagar a conta.
  6. Teto de conteúdo por dono, disjuntor de disco, limite por hash do `sub` e `PENDING_LOGIN_MAX` de 10 000.
  7. 1 convite pendente por par e expiração de 30 dias.
  8. Auditoria apagada aos 180 dias e "Apagar" do admin para contas desativadas.
  9. Conteúdo completo da `/privacidade`.
  10. `incidente.md` executável e o aviso do admin na Fase 4.
- **Opcionais:**
  - **Adotados:** `X-Quadro-Client` e teto na lista de admin; `suggestions.delete`; cancelar os convites de quem apagou a conta; bloqueio contra o dono atual; `header -Server`; `Permissions-Policy`; as notas de restauração e `VACUUM INTO`; 2FA do admin.
  - **Não adotados:** auditar as negativas de admin (encheria o `audit_log`) e o HMAC do IP (a chave só existe em memória).
- **Encaminhados ao usuário:**
  - **Decididos em 19/11:** as tarefas de grupo ficam sem autor, e as contas desativadas e sem uso têm prazo.
  - **Pendente antes de publicar:** o provedor e o país da VPS e do bucket (transferência internacional, art. 33), com revisão jurídica do texto.

## Riscos e pontos em aberto
- **Os números dos limites são estimativas.**
  - Um NAT de operadora pode barrar cadastros legítimos.
  - Os contadores zeram a cada deploy.
  - O mapa de logins pendentes ainda pode encher num ataque distribuído.
- **O modo "Testing" do Google** limita o login aos usuários de teste. Para abrir o cadastro, é preciso publicar o app OAuth de produção. Os escopos básicos dispensam verificação.
- **O `userland-proxy` do Docker** pode esconder o IP real. Conferir na VPS.
- **Reiniciar o Caddy** exige reiniciar o app junto.
- **A regra das 2 semanas** pode bater de frente com um release de segurança do Node. A exceção é sua, caso a caso.
- **O herdeiro do grupo** é escolhido por `board_members.created_at`, que é a data do convite e não a do aceite.
- **O aviso de 24 meses sem uso** depende de o app enviar e-mail, o que ainda não existe. Até lá, a regra só vale com a `/privacidade` dizendo isso.
