# Deploy (Fase 2b)

Como subir o Quadro de tarefas fora da sua máquina, e como testar o mesmo pacote localmente antes. O plano da fase está em `docs/fase-2b.md`.

```
navegador ──HTTPS──▶ Caddy (TLS, portas 80/443) ──▶ Node em 127.0.0.1:3001 (o mesmo namespace de rede)
                                                     └─ SQLite em /data (volume "dados")
                     Litestream ──▶ réplica contínua do banco (arquivo no teste local; bucket na VPS)
```

- O Node nunca escuta fora de `127.0.0.1`: quem fala com a internet é o Caddy, no mesmo namespace de rede.
- O servidor só sobe em modo público com `NODE_ENV=production` (o Dockerfile define) **e** `APP_ORIGIN` em `https://`. Ele recusa subir sem o login Google, o `QUADRO_ADMIN_EMAIL`, o `QUADRO_CONTACT_EMAIL` e o `QUADRO_OPERATOR_NAME`, e recusa a agenda global (`--agenda` ou `ICLOUD_*`).
- O arquivo de ambiente fica **fora do repositório** e vai sempre por `--env-file`. Um `deploy/.env` seria carregado sozinho por qualquer `docker compose` e entraria na tela num `config`.

## Arquivos

| Arquivo | O que é |
|---|---|
| `deploy/Dockerfile` | Imagem do app: build do web, dependências de runtime e o servidor com `tsx`. Usuário `node`, código só de leitura, sem npm. |
| `deploy/compose.yaml` | Caddy (dono da rede), app (entra na rede do Caddy) e Litestream. Cada serviço recebe só as próprias chaves. |
| `deploy/Caddyfile` | Um site só, HSTS, compressão fora de `/api`, sem log de acesso, log de erro sem IP inteiro nem query. |
| `deploy/litestream.yml` | Backup num bucket S3 compatível (B2, R2 ou AWS), retenção de 7 dias. |
| `deploy/litestream.local.yml` | Backup em arquivo, só para o teste local, com poda de 1 h. |
| `deploy/.env.example` | As chaves do arquivo de ambiente, comentadas. |
| `.dockerignore` | Allowlist: só `package*.json`, `.npmrc`, `tsconfig.base.json`, `shared/`, `server/` e `web/` entram no build. |

As imagens estão fixadas por versão e digest, com pelo menos 2 semanas de lançamento: Node 24.22.2, Caddy 2.11.9 e Litestream 0.5.18. Para atualizar, troque a tag **e** o digest (`docker buildx imagetools inspect <imagem>:<tag>`). O Node 24.22.3 é um release de segurança de 10/11/2026; ele cumpre as 2 semanas em 24/11/2026.

## Teste local no Windows (https://localhost)

1. **Google:** no client OAuth **de teste**, cadastre o redirect `https://localhost/api/auth/google/callback`.
2. **Ambiente:** copie `deploy/.env.example` para `%USERPROFILE%\.quadro\deploy.env` e preencha o Google, o admin, o contato e o responsável. Deixe `APP_DOMAIN=localhost`, `APP_ORIGIN=https://localhost`, `BIND_IP=127.0.0.1`, `HSTS_MAX_AGE=0` e `LITESTREAM_CONFIG=./litestream.local.yml`.
3. **Subir:**
   ```powershell
   docker compose --env-file "$env:USERPROFILE\.quadro\deploy.env" -f deploy/compose.yaml up -d --build
   docker compose --env-file "$env:USERPROFILE\.quadro\deploy.env" -f deploy/compose.yaml ps
   ```
   O `app` precisa ficar `healthy`.
4. **Confiar na CA local do Caddy** (só na sua conta do Windows, e por pouco tempo):
   ```powershell
   docker compose --env-file "$env:USERPROFILE\.quadro\deploy.env" -f deploy/compose.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt "$env:TEMP\caddy-root.crt"
   $cert = Import-Certificate -FilePath "$env:TEMP\caddy-root.crt" -CertStoreLocation Cert:\CurrentUser\Root
   $cert.Thumbprint   # anote: é por ele que você remove depois
   ```
   Reinicie o navegador e abra <https://localhost>. O Firefox usa a loja dele; teste no Chrome ou no Edge.
5. **Ao terminar**, remova a CA e o volume dela. A chave dessa CA emite certificado para qualquer site enquanto ela for confiável.
   ```powershell
   Remove-Item "Cert:\CurrentUser\Root\<impressão digital>"
   docker compose --env-file "$env:USERPROFILE\.quadro\deploy.env" -f deploy/compose.yaml down
   docker volume rm quadro_caddy_data
   ```
   Use `down`, não `down -v`: o `-v` apaga também o banco.

## Publicar na VPS

**Antes:**
- [ ] Uma VPS Linux com Docker, um registro DNS `A` do domínio apontando para ela e o firewall aberto só para 22, 80 e 443.
- [ ] Um **client OAuth só de produção**, de preferência num projeto do Google separado do de teste. Ele precisa do redirect `https://<domínio>/api/auth/google/callback` e do app **publicado**: no modo "Testing" só entram os usuários de teste. Os escopos `openid email profile` não exigem verificação do Google.
- [ ] A verificação em duas etapas ligada na conta Google do admin.
- [ ] O e-mail de contato criado.
- [ ] O texto da `/privacidade` revisado, com o provedor e o país da VPS e do bucket preenchidos. Isso define se há transferência internacional (LGPD, art. 33); vale uma revisão jurídica.
- [ ] O bucket (seção abaixo).

**Subir:**
1. `git clone` do repositório e checkout de um commit conhecido (`git checkout <commit>`).
2. Crie `/etc/quadro/deploy.env` a partir do exemplo e rode `chmod 600 /etc/quadro/deploy.env`. Preencha `APP_DOMAIN`, `APP_ORIGIN=https://<domínio>`, `BIND_IP=<IPv4 público da VPS>`, `HSTS_MAX_AGE=31536000`, `LITESTREAM_CONFIG=./litestream.yml` e as chaves do bucket.
3. `docker compose --env-file /etc/quadro/deploy.env -f deploy/compose.yaml up -d --build`
4. **Confira:**
   - `curl -sI https://<domínio>/` mostra `strict-transport-security: max-age=31536000` e a CSP do HTML;
   - o login Google funciona, e quem entra com o `QUADRO_ADMIN_EMAIL` ganha o `_00`;
   - **o IP real chega ao Node.** Com o `userland-proxy` do Docker, todo cliente pode aparecer como o mesmo IP, e o limite por IP passa a valer para todos. Faça 21 inícios de login seguidos de um computador: o 21º deve voltar com "Muitas tentativas"; de outro computador, ainda deve funcionar.
5. **Para levar um banco que já existe**, pare o servidor de origem e gere uma cópia consistente com `VACUUM INTO`. Copiar só o `.sqlite` perde o que está no `-wal`.

## Bucket do backup

- **Privado**, com **uma chave que vale só para esse bucket** (ou só para o prefixo `quadro/`), nunca a chave mestra da conta.
- **Versionamento**, com uma regra de ciclo de vida que **expira as versões antigas em até 2 dias**: na AWS, `NoncurrentVersionExpiration` de 1 dia; no B2, `daysFromHidingToDeleting` de 1. O R2 não versiona. Sem essa regra, a poda do Litestream só cria marcadores, e as contas apagadas ficariam no bucket para sempre, o que contradiz a `/privacidade`.
- **Cifra** do lado do provedor ligada.
- **Endpoints:** na AWS, deixe `LITESTREAM_ENDPOINT` vazio e preencha `LITESTREAM_REGION`. No B2, `LITESTREAM_ENDPOINT=s3.<região>.backblazeb2.com`. No R2, `LITESTREAM_ENDPOINT=<conta>.r2.cloudflarestorage.com` com `LITESTREAM_REGION=auto`.

## Restaurar o backup

**Ensaio (faça uma vez, num volume separado, sem parar o app):**
```sh
# --user 0: o volume novo nasce do root (o contêiner continua sem nenhuma capability).
docker compose --env-file <arquivo> -f deploy/compose.yaml run --rm --no-deps --user 0 \
  -v quadro_restore:/restore litestream restore -integrity-check -o /restore/quadro.sqlite /data/quadro.sqlite
docker run --rm -v quadro_restore:/restore --entrypoint node quadro-tarefas:local -e \
  "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/restore/quadro.sqlite',{readOnly:true});for(const t of ['users','boards','tasks'])console.log(t,db.prepare('SELECT COUNT(*) AS n FROM '+t).get().n)"
docker volume rm quadro_restore
```
O comando mostra só as contagens. No teste local, confira também que a réplica em `/data/replica` não guarda arquivos com mais de 1 h: é a poda funcionando.

**Restauração de verdade:** pare o `app` e o `litestream`, restaure para um volume novo, troque o volume e suba de novo. Restaure **sempre até o ponto mais recente**. Um ponto anterior (`-timestamp`) ressuscita contas que as pessoas apagaram depois dele; use-o só num incidente, e registre.

## Atualizar

1. `git pull` (ou `git checkout <commit novo>`).
2. `docker compose --env-file <arquivo> -f deploy/compose.yaml up -d --build app`, e confira o health.
3. **Rollback:** as migrações do banco só andam para a frente. Para voltar o código, volte também o banco para um ponto anterior à atualização (`restore -timestamp`), sabendo que isso desfaz o que aconteceu depois.
4. **Reiniciar o Caddy:** o app está no namespace de rede dele, então reinicie os dois juntos (`restart caddy app`).

## O que os agentes podem e não podem fazer

Agentes (Claude Code e subagentes) **podem**:
- `docker build -f deploy/Dockerfile .`;
- `docker compose --env-file deploy/.env.example -f deploy/compose.yaml config --quiet`;
- `caddy validate` com variáveis fictícias.

Agentes **nunca**:
- leem o arquivo de ambiente do deploy;
- sobem o compose com ele;
- montam, copiam ou leem os volumes do deploy;
- rodam `docker logs`, `docker inspect` ou `exec env` no stack real.
