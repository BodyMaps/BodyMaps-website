import { generateMockResponse, type AssistantResponse } from '../utils/mockAIResponses';
import { buildAIContext, type ViewerState } from '../utils/aiContextBuilder';

// Vite injects these. They're optional — without them we default to mock mode.
const MODE: string = (import.meta.env.VITE_AI_MODE as string) || 'mock';
const ENDPOINT: string = (import.meta.env.VITE_AI_API_ENDPOINT as string) || '/api/chat';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  text: string;
}

export async function askAssistant(
  userText: string,
  viewerState: ViewerState,
  history: ChatHistoryEntry[] = []
): Promise<AssistantResponse> {
  const context = buildAIContext(viewerState);

  if (MODE === 'api') {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...history, { role: 'user', text: userText }],
          context,
        }),
      });
      if (!res.ok) throw new Error(`Backend responded ${res.status}`);
      const data: { text?: string; actions?: AssistantResponse['actions'] } = await res.json();
      return {
        text: data.text ?? 'No response received from the AI backend.',
        actions: Array.isArray(data.actions) ? data.actions : [],
      };
    } catch (err) {
      const fallback = generateMockResponse(userText, context);
      const msg = err instanceof Error ? err.message : String(err);
      return {
        text:
          `⚠️ Could not reach the AI backend (${msg}). Showing a local mock response instead:\n\n` +
          fallback.text,
        actions: fallback.actions,
      };
    }
  }

  // Mock mode — small artificial delay for the typing animation.
  await delay(550 + Math.random() * 500);
  return generateMockResponse(userText, context);
}

export function getAIMode(): string {
  return MODE;
}
