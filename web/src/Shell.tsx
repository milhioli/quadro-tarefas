import type { MeUser } from '@quadro/shared';
import { useCallback, useEffect, useState } from 'react';
import { App } from './App';
import { useBoards, useMe } from './api/account';
import { BoardProvider } from './api/BoardContext';
import { describeError } from './api/client';
import { LoginScreen } from './components/auth/LoginScreen';
import { ProfileScreen } from './components/auth/ProfileScreen';
import { SessionBar } from './components/session/SessionBar';
import {
  browserBoardStorage,
  clearBoardChoice,
  loadBoardChoice,
  pickBoard,
  saveBoardChoice,
  type BoardStorage,
} from './lib/boardChoice';
import type { Clock } from './lib/clock';
import type { LoginOutcome } from './lib/login';

export interface ShellProps {
  clock: Clock;
  /** Resultado do último login Google, quando não deu certo (`?login=...`). */
  loginOutcome?: LoginOutcome | null;
  /** Para onde voltar depois do login Google. */
  next?: string;
  storage?: BoardStorage;
}

/**
 * Decide a tela pela sessão: entrar, primeiro acesso (nome de usuário) ou o
 * quadro. Quem decide o acesso é o servidor; aqui só se escolhe o que mostrar.
 */
export function Shell({ clock, loginOutcome = null, next = '/', storage = browserBoardStorage }: ShellProps) {
  const me = useMe();
  const [outcome, setOutcome] = useState(loginOutcome);
  const forgetBoard = useCallback(() => clearBoardChoice(storage), [storage]);
  const data = me.data;

  // O aviso do último login só vale até alguém entrar.
  useEffect(() => {
    if (data?.user || data?.pendingProfile) setOutcome(null);
  }, [data]);

  if (data === undefined) {
    if (me.isError) {
      return (
        <main className="auth-screen">
          <div className="app-status app-status--error" role="alert">
            <p>{describeError(me.error, 'Não foi possível falar com o servidor')}</p>
            <button type="button" className="button" onClick={() => void me.refetch()}>
              Tentar novamente
            </button>
          </div>
        </main>
      );
    }
    return (
      <p className="app-status" role="status">
        Carregando…
      </p>
    );
  }
  if (data.pendingProfile) return <ProfileScreen suggestedName={data.pendingProfile.suggestedName} onLoggedOut={forgetBoard} />;
  if (!data.user) return <LoginScreen outcome={outcome} next={next} />;
  // A chave por conta garante que nada da conta anterior sobreviva à troca.
  return <SignedIn key={data.user.id} user={data.user} clock={clock} storage={storage} onLoggedOut={forgetBoard} />;
}

interface SignedInProps {
  user: MeUser;
  clock: Clock;
  storage: BoardStorage;
  onLoggedOut: () => void;
}

function SignedIn({ user, clock, storage, onLoggedOut }: SignedInProps) {
  const boards = useBoards();
  const [chosen, setChosen] = useState<number | null>(() => loadBoardChoice(storage));
  const choose = useCallback(
    (boardId: number) => {
      setChosen(boardId);
      saveBoardChoice(storage, boardId);
    },
    [storage],
  );

  if (boards.data === undefined) {
    return boards.isError ? (
      <div className="app-status app-status--error" role="alert">
        <p>{describeError(boards.error, 'Não foi possível carregar seus quadros')}</p>
        <button type="button" className="button" onClick={() => void boards.refetch()}>
          Tentar novamente
        </button>
      </div>
    ) : (
      <p className="app-status" role="status">
        Carregando quadros…
      </p>
    );
  }

  const boardId = pickBoard(boards.data, chosen, user.personalBoardId);
  return (
    <BoardProvider boardId={boardId}>
      {/* Um App por quadro: trocar de quadro não leva estado (modal, arraste) de um para o outro. */}
      <App
        key={boardId}
        clock={clock}
        toolbar={
          <SessionBar user={user} boards={boards.data} boardId={boardId} onChooseBoard={choose} onLoggedOut={onLoggedOut} />
        }
      />
    </BoardProvider>
  );
}
