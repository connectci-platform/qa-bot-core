import {
  addMessageToSession,
  clearAllSessions,
  getAllSessions,
} from './session-utils';

beforeEach(() => {
  localStorage.clear();
  addMessageToSession('qa_bot_session_a', 'a1', 'First question', 'USER', 'string');
  addMessageToSession('qa_bot_session_b', 'b1', 'Second question', 'USER', 'string');
});

describe('clearAllSessions', () => {
  it('removes every stored conversation', () => {
    clearAllSessions();

    expect(getAllSessions()).toEqual([]);
  });
});
