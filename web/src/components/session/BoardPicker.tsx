import type { BoardSummary, MeUser } from '@quadro/shared';
import { useId, useState } from 'react';
import { GroupModal } from './GroupModal';
import { NewGroupModal } from './NewGroupModal';

export interface BoardPickerProps {
  user: MeUser;
  boards: readonly BoardSummary[];
  boardId: number;
  onChoose: (boardId: number) => void;
}

export function boardLabel(board: BoardSummary): string {
  return board.kind === 'personal' ? 'Meu quadro' : board.name;
}

/** Escolhe o quadro aberto, cria grupos e abre as pessoas do grupo atual. */
export function BoardPicker({ user, boards, boardId, onChoose }: BoardPickerProps) {
  const [modal, setModal] = useState<'none' | 'new' | 'group'>('none');
  const selectId = useId();
  const current = boards.find((board) => board.id === boardId);

  return (
    <div className="board-picker">
      <label className="board-picker__label" htmlFor={selectId}>
        Quadro
      </label>
      <select
        id={selectId}
        className="input board-picker__select"
        value={boardId}
        onChange={(event) => onChoose(Number(event.target.value))}
      >
        {boards.map((board) => (
          <option key={board.id} value={board.id}>
            {boardLabel(board)}
          </option>
        ))}
      </select>
      {current?.kind === 'group' ? (
        <button type="button" className="button" onClick={() => setModal('group')}>
          Pessoas do grupo
        </button>
      ) : null}
      <button type="button" className="button" onClick={() => setModal('new')}>
        Novo grupo
      </button>

      {modal === 'new' ? (
        <NewGroupModal
          onClose={() => setModal('none')}
          onCreated={(board) => {
            setModal('none');
            onChoose(board.id);
          }}
        />
      ) : null}
      {modal === 'group' && current ? (
        <GroupModal
          board={current}
          user={user}
          onClose={() => setModal('none')}
          onLeft={() => {
            setModal('none');
            onChoose(user.personalBoardId);
          }}
        />
      ) : null}
    </div>
  );
}
