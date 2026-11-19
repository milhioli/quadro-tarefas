# Plano de incidente

O que fazer se dados pessoais do Quadro de tarefas forem (ou puderem ter sido) expostos. O procedimento vale a partir da Fase 2b (deploy). As etapas da agenda entram na Fase 4.

**Contato:** o `QUADRO_CONTACT_EMAIL` é o canal de privacidade. Ele aparece na `/privacidade` e no rodapé, e é dele que saem os avisos.

## 1. Conter (na hora)

```sh
docker compose --env-file /etc/quadro/deploy.env -f deploy/compose.yaml stop app
```

O site fica fora do ar, e o Caddy responde com erro. Se a suspeita for só da conta de alguém, desative a conta na tela "Contas": as sessões dela caem na hora.

## 2. Derrubar todas as sessões

Com o app parado, apague as sessões. Todo mundo vai precisar entrar de novo.

```sh
docker compose --env-file /etc/quadro/deploy.env -f deploy/compose.yaml run --rm --no-deps --entrypoint node app -e \
  "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/data/quadro.sqlite');console.log('sessões apagadas:',db.prepare('DELETE FROM sessions').run().changes)"
```

## 3. Trocar os segredos

- **Login Google:** no Google Cloud Console, crie um novo segredo para o client OAuth de produção, apague o antigo e atualize `GOOGLE_CLIENT_SECRET` no `/etc/quadro/deploy.env`.
- **Bucket:** crie uma nova chave restrita ao bucket, apague a antiga e atualize `LITESTREAM_ACCESS_KEY_ID` e `LITESTREAM_SECRET_ACCESS_KEY`.
- Suba de novo: `docker compose --env-file /etc/quadro/deploy.env -f deploy/compose.yaml up -d`.

## 4. Avaliar o que foi exposto

Guarde os logs do período sem espalhar dados pessoais: copie-os para um lugar com acesso restrito e não os cole em ferramentas de terceiros. Responda:
- **O quê:** contas (e-mail, nome de usuário), tarefas ou grupos? E o backup?
- **Desde quando e até quando?**
- **Quem foi atingido:** todas as contas ou algumas?

## 5. Avisar as pessoas e a ANPD

- **Lista de e-mails:** a tela "Contas" do admin mostra o e-mail de cada conta. Mande o aviso em **cópia oculta**, pela caixa do `QUADRO_CONTACT_EMAIL`. Se forem mais do que a caixa envia por dia (algumas centenas num Gmail comum), mande em lotes.
- **Conteúdo do aviso:** o que aconteceu, quais dados, o que já foi feito e o que a pessoa deve fazer (por exemplo, sair e entrar de novo).
- **Prazo:** comunique a ANPD e as pessoas atingidas em até **3 dias úteis** depois de saber que dados pessoais foram atingidos (Resolução CD/ANPD nº 15/2024). Para agente de pequeno porte, o prazo é dobrado: 6 dias úteis.

## 6. Registrar

Guarde o registro do incidente: o que aconteceu, a linha do tempo, os dados atingidos, as medidas tomadas e os avisos enviados. A ANPD pode pedir esse registro; confira o prazo atual de guarda na resolução.

## A partir da Fase 4 (agendas por pessoa)

- Apagar todas as conexões de agenda e trocar a chave mestra de cifra.
- Revogar os tokens do Google pelo endpoint `revoke`. O app consegue fazer isso sozinho.
- As senhas de app da Apple, **só a própria pessoa** consegue revogar. O aviso precisa pedir: "revogue a senha de app 'quadro-tarefas' em account.apple.com e conecte de novo".
- **Aviso no topo do app** (`POST /api/admin/notice`): entra na Fase 4, junto com a custódia das senhas de app.
