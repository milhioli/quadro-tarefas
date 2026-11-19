import { createContext, useContext, type ReactNode } from 'react';

const BoardContext = createContext<number | null>(null);

/** O quadro aberto. As queries de tarefas usam este id; o servidor confere se a pessoa é membro. */
export function BoardProvider({ boardId, children }: { boardId: number; children: ReactNode }) {
  return <BoardContext value={boardId}>{children}</BoardContext>;
}

export function useBoardId(): number {
  const boardId = useContext(BoardContext);
  if (boardId === null) throw new Error('useBoardId precisa estar dentro de <BoardProvider>');
  return boardId;
}
