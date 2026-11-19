import type { AuthMethods, BoardSummary, Invite, MeResponse, Member } from '@quadro/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useApi } from './ApiContext';
import type { ApiError, ProfileInput } from './client';
import { AUTH_METHODS_KEY, BOARDS_KEY, INVITES_KEY, LOGGED_OUT, ME_KEY, membersKey, resetSession } from './queries';

// ---------- Sessão ----------

export function useMe() {
  const api = useApi();
  return useQuery<MeResponse, ApiError>({ queryKey: ME_KEY, queryFn: () => api.getMe() });
}

export function useAuthMethods() {
  const api = useApi();
  return useQuery<AuthMethods, ApiError>({ queryKey: AUTH_METHODS_KEY, queryFn: () => api.getAuthMethods() });
}

/** Login de desenvolvimento (só no servidor de E2E). Zera o cache: é outra conta. */
export function useDevLogin() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<MeResponse, ApiError, string>({
    mutationFn: (email) => api.devLogin(email),
    onSuccess: (me) => resetSession(queryClient, me),
  });
}

/** Sair: apaga a sessão no servidor e tudo da conta no cache. */
export function useLogout(onLoggedOut?: () => void) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () => api.logout(),
    onSuccess: () => {
      onLoggedOut?.();
      resetSession(queryClient, LOGGED_OUT);
    },
  });
}

export function useCreateProfile() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<MeResponse, ApiError, ProfileInput>({
    mutationFn: (input) => api.createProfile(input),
    onSuccess: (me) => {
      queryClient.setQueryData<MeResponse>(ME_KEY, me);
    },
  });
}

// ---------- Quadros ----------

export function useBoards() {
  const api = useApi();
  return useQuery<BoardSummary[], ApiError>({ queryKey: BOARDS_KEY, queryFn: () => api.listBoards() });
}

/** Tira um quadro do cache: a lista, as tarefas e os membros dele. */
function forgetBoard(queryClient: QueryClient, boardId: number): void {
  queryClient.setQueryData<BoardSummary[]>(BOARDS_KEY, (old) => old?.filter((b) => b.id !== boardId));
  queryClient.removeQueries({ queryKey: ['boards', boardId] });
}

export function useCreateBoard() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<BoardSummary, ApiError, string>({
    mutationFn: (name) => api.createBoard(name),
    onSuccess: (board) => {
      queryClient.setQueryData<BoardSummary[]>(BOARDS_KEY, (old) => [...(old ?? []).filter((b) => b.id !== board.id), board]);
    },
  });
}

export function useRenameBoard(boardId: number) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<BoardSummary, ApiError, string>({
    mutationFn: (name) => api.renameBoard(boardId, name),
    onSuccess: (board) => {
      queryClient.setQueryData<BoardSummary[]>(BOARDS_KEY, (old) => old?.map((b) => (b.id === board.id ? board : b)));
    },
  });
}

export function useDeleteBoard(boardId: number) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () => api.deleteBoard(boardId),
    onSuccess: () => forgetBoard(queryClient, boardId),
  });
}

// ---------- Membros ----------

export function useMembers(boardId: number) {
  const api = useApi();
  return useQuery<Member[], ApiError>({ queryKey: membersKey(boardId), queryFn: () => api.listMembers(boardId) });
}

export function useInviteMember(boardId: number) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<Member, ApiError, string>({
    mutationFn: (handle) => api.inviteMember(boardId, handle),
    onSuccess: (member) => {
      queryClient.setQueryData<Member[]>(membersKey(boardId), (old) => [
        ...(old ?? []).filter((m) => m.userId !== member.userId),
        member,
      ]);
    },
  });
}

/** O dono remove alguém (ou cancela um convite pendente). */
export function useRemoveMember(boardId: number) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, number>({
    mutationFn: (userId) => api.removeMember(boardId, userId),
    onSuccess: (_data, userId) => {
      queryClient.setQueryData<Member[]>(membersKey(boardId), (old) => old?.filter((m) => m.userId !== userId));
    },
  });
}

/** A própria pessoa sai do grupo. */
export function useLeaveBoard(boardId: number, userId: number) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () => api.removeMember(boardId, userId),
    onSuccess: () => forgetBoard(queryClient, boardId),
  });
}

// ---------- Convites recebidos ----------

export function useInvites() {
  const api = useApi();
  return useQuery<Invite[], ApiError>({ queryKey: INVITES_KEY, queryFn: () => api.listInvites() });
}

export function useAcceptInvite() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<BoardSummary, ApiError, number>({
    mutationFn: (boardId) => api.acceptInvite(boardId),
    onSuccess: (board) => {
      queryClient.setQueryData<Invite[]>(INVITES_KEY, (old) => old?.filter((i) => i.boardId !== board.id));
      queryClient.setQueryData<BoardSummary[]>(BOARDS_KEY, (old) => [...(old ?? []).filter((b) => b.id !== board.id), board]);
    },
  });
}

export function useDeclineInvite() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, number>({
    mutationFn: (boardId) => api.declineInvite(boardId),
    onSuccess: (_data, boardId) => {
      queryClient.setQueryData<Invite[]>(INVITES_KEY, (old) => old?.filter((i) => i.boardId !== boardId));
    },
  });
}
