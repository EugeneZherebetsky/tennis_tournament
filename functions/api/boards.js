import { handleBoards } from '../../lib/boards.mjs';

export function onRequest({ request, env }) {
  return handleBoards(request, env.TENNIS_DB);
}
