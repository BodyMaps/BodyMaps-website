import { useState, useCallback, useRef } from 'react';
import { askAssistant } from '../services/aiService';
import type { ViewerState } from '../utils/aiContextBuilder';
import type { AssistantAction } from '../utils/mockAIResponses';

let idCounter = 0;
const nextId = () => `m${++idCounter}`;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  actions: AssistantAction[];
}

const WELCOME: ChatMessage = {
  id: nextId(),
  role: 'assistant',
  text:
    "Welcome to SYNAPSE AI. The 3D model is a Visible Human Project segmentation loaded from the PanTS-Demo assets. " +
    "Pick an organ on the focus rail or ask me about any anatomical structure, sub-segment, or visualization mode.",
  actions: [],
};

export function useChatAssistant(getViewerState: () => ViewerState) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [isTyping, setIsTyping] = useState(false);
  const getState = useRef(getViewerState);
  getState.current = getViewerState;

  const send = useCallback(
    async (text: string) => {
      const trimmed = (text || '').trim();
      if (!trimmed || isTyping) return;

      const userMsg: ChatMessage = { id: nextId(), role: 'user', text: trimmed, actions: [] };
      setMessages((m) => [...m, userMsg]);
      setIsTyping(true);

      try {
        const { text: replyText, actions } = await askAssistant(trimmed, getState.current(), []);
        setMessages((m) => [
          ...m,
          { id: nextId(), role: 'assistant', text: replyText, actions: actions || [] },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setMessages((m) => [
          ...m,
          { id: nextId(), role: 'assistant', text: `Something went wrong: ${msg}`, actions: [] },
        ]);
      } finally {
        setIsTyping(false);
      }
    },
    [isTyping]
  );

  const clear = useCallback(() => {
    setMessages([{ ...WELCOME, id: nextId() }]);
  }, []);

  return { messages, isTyping, send, clear };
}
