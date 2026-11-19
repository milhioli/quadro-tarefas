import { useInfo } from '../../api/account';
import { contactHref } from '../AppFooter';

/** Data desta versão do texto (nunca a data de hoje: o texto muda só quando alguém o revisa). */
export const PRIVACY_UPDATED_AT = '19 de novembro de 2026';

/** Os prazos da retenção (os mesmos do server/src/retention.ts e da sessão). */
export const RETENTION_ROWS: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['Sessão de login', '30 dias sem uso (no máximo 90). Depois disso, é preciso entrar de novo.'],
  ['Login em andamento', '10 minutos.'],
  ['Conta que nunca concluiu o primeiro acesso', '7 dias sem uso. Depois, é apagada.'],
  ['Conta que você apaga', 'Na hora. Os grupos que você criou passam para o membro mais antigo.'],
  ['Conta desativada pelo administrador', '12 meses depois da desativação. Depois, é apagada.'],
  ['Conta sem nenhum acesso', '24 meses. Depois, é apagada.'],
  ['Convite sem resposta', '30 dias.'],
  ['Bloqueio de novo convite (depois de recusar ou sair)', '30 dias.'],
  ['Registro de auditoria (quem fez o quê, sem conteúdo)', '180 dias. Depois, é apagado.'],
  ['Endereço IP e identificador da conta Google (só na memória, para limitar abusos)', 'Até 24 horas.'],
  ['Cópia de segurança (backup)', 'O que foi apagado some também do backup em até 10 dias.'],
]);

/**
 * Página de privacidade (LGPD, art. 9º). Abre sem login. O texto é um rascunho
 * versionado: precisa ser revisado por quem responde pelo app antes de publicar.
 */
export function PrivacyPage() {
  const info = useInfo();
  const email = info.data?.contactEmail ?? null;
  const href = contactHref(email);
  const operator = info.data?.operatorName ?? null;

  const contact = info.isPending ? (
    <span>carregando…</span>
  ) : href ? (
    <a href={href}>{email}</a>
  ) : (
    <span>o contato ainda não foi configurado neste servidor</span>
  );

  return (
    <main className="legal-page">
      <article>
        <h1>Privacidade</h1>
        <p className="legal-page__updated">Última atualização: {PRIVACY_UPDATED_AT}</p>

        <section>
          <h2>Quem é o responsável</h2>
          <p>
            O Quadro de tarefas é operado por {operator ?? 'quem administra este servidor'}. Para qualquer assunto de
            privacidade, escreva para {contact}.
          </p>
        </section>

        <section>
          <h2>O que coletamos</h2>
          <ul>
            <li>Do Google, quando você entra: seu nome, seu e-mail e o identificador da sua conta Google.</li>
            <li>O que você digita: nome de usuário, nome de exibição, tarefas e grupos.</li>
            <li>A data do seu último acesso.</li>
            <li>Um registro de auditoria das ações (por exemplo, "criou um grupo"), sem o conteúdo das tarefas.</li>
            <li>Registros técnicos do servidor, só com o método, o caminho e o resultado de cada requisição.</li>
            <li>
              Seu endereço IP e um identificador da sua conta Google, só na memória do servidor e por até 24 horas, para
              limitar abusos (como contas criadas em série).
            </li>
          </ul>
          <p>Esta versão não se conecta à sua agenda.</p>
        </section>

        <section>
          <h2>Para que usamos</h2>
          <p>Só para mostrar seus quadros e os grupos de que você participa. Nada de anúncio, venda de dados ou perfil.</p>
        </section>

        <section>
          <h2>Quem vê</h2>
          <ul>
            <li>As tarefas de um quadro: as pessoas que participam dele.</li>
            <li>Seu nome de usuário e seu nome de exibição: quem sabe o seu nome de usuário e os membros dos seus grupos.</li>
            <li>
              Seu e-mail, nome de usuário, situação da conta e último acesso: só o administrador, na lista de contas. O
              administrador não vê suas tarefas nem seus quadros.
            </li>
            <li>O login usa o Google, que fica sabendo que você entrou neste app.</li>
          </ul>
        </section>

        <section>
          <h2>Onde ficam e por quanto tempo</h2>
          <p>
            Os dados ficam num servidor em [PROVEDOR E PAÍS DO SERVIDOR], com cópia de segurança em [PROVEDOR E PAÍS DO
            BACKUP].
          </p>
          <div className="legal-page__table">
            <table>
              <caption>Prazos de guarda</caption>
              <thead>
                <tr>
                  <th scope="col">Dado</th>
                  <th scope="col">Quanto tempo</th>
                </tr>
              </thead>
              <tbody>
                {RETENTION_ROWS.map(([what, howLong]) => (
                  <tr key={what}>
                    <th scope="row">{what}</th>
                    <td>{howLong}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>Quando você apaga a conta</h2>
          <p>
            Some na hora: seu quadro pessoal e as tarefas dele, suas sessões, seus convites e sua participação nos grupos.
            Cada grupo que você criou passa para a pessoa que participa dele há mais tempo; um grupo sem mais ninguém é
            apagado com as tarefas. As tarefas que você criou em grupos de outras pessoas continuam lá, sem o seu nome.
          </p>
        </section>

        <section>
          <h2>Cookies</h2>
          <p>
            Só dois, estritamente necessários: o da sua sessão e o do login em andamento. Não usamos cookies de análise
            nem scripts de terceiros.
          </p>
        </section>

        <section>
          <h2>Seus direitos</h2>
          <p>
            Você pode ver e corrigir seus dados e apagar a sua conta pelo próprio app, em "Minha conta". Para qualquer
            outro pedido (inclusive se a sua conta estiver desativada ou se você não concluiu o primeiro acesso), escreva
            para {contact}.
          </p>
        </section>

        <section>
          <h2>Incidentes</h2>
          <p>
            Se algum dado pessoal for exposto, avisamos as pessoas atingidas e a Autoridade Nacional de Proteção de Dados
            (ANPD) no prazo da lei.
          </p>
        </section>

        <section>
          <h2>Mudanças nesta página</h2>
          <p>Quando este texto mudar, a data no topo muda junto.</p>
        </section>

        <p>
          <a href="/">Voltar ao Quadro de tarefas</a>
        </p>
      </article>
    </main>
  );
}
