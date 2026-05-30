import { useState, useRef, useEffect, useMemo } from 'react';
import { IconSparkles, IconSend, IconTrash } from '@tabler/icons-react';
import { ANATOMY, type OrganId } from '../data/anatomyData';
import { DISCLAIMER, type AssistantAction } from '../utils/mockAIResponses';
import type { ChatMessage } from '../hooks/useChatAssistant';

function suggestionsFor(organId: OrganId | null): string[] {
  const base = [
    'What am I looking at?',
    'Explain Sections mode.',
    'What does segmentation confidence mean?',
    'Tell me about the Visible Human dataset.',
  ];
  if (organId && ANATOMY[organId]) {
    const name = ANATOMY[organId].name.toLowerCase();
    const extras: Record<OrganId, string[]> = {
      liver: ['What are the Couinaud segments?', 'Why does the liver have so many ligaments?'],
      kidney: ['Explain the renal pyramids.', 'What is the renal hilum?'],
      lung: ['What are bronchopulmonary segments?', 'Compare upper and lower lobes.'],
      pancreas: ['What does the uncinate process do?', 'Compare head, body, and tail of pancreas.'],
      colon: ['Walk me through the colonic flow.', 'What is the ileocecal valve?'],
    };
    return [
      `Tell me about the ${name}.`,
      ...(extras[organId] || []),
      ...base,
    ].slice(0, 5);
  }
  return ['What are the visible organs?', ...base].slice(0, 5);
}

interface Props {
  messages: ChatMessage[];
  isTyping: boolean;
  onSend: (text: string) => void;
  onClear: () => void;
  organId: OrganId | null;
  onAction: (a: AssistantAction) => void;
  aiMode: string;
}

export default function AIAssistant({
  messages,
  isTyping,
  onSend,
  onClear,
  organId,
  onAction,
  aiMode,
}: Props) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const chips = useMemo(() => suggestionsFor(organId), [organId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    onSend(text);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="syn-card syn-ai-card syn-fadeup" style={{ ['--syn-delay' as any]: '0.25s' }}>
      <div className="syn-ai-head">
        <div className="av">
          <IconSparkles size={16} />
        </div>
        <div>
          <div className="ti">SYNAPSE AI</div>
          <div className="ts">
            Imaging Assistant{aiMode === 'mock' ? ' • Demo Mode' : ' • API Mode'}
          </div>
        </div>
        <button className="clear" title="Clear conversation" onClick={onClear}>
          <IconTrash size={14} />
        </button>
      </div>

      <div className="syn-ai-msgs" ref={scrollRef}>
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="syn-bubble user">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="syn-bubble ai">
              <div className="label">
                <i />
                SYNAPSE AI
              </div>
              <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span>
              {m.actions && m.actions.length > 0 && (
                <div className="actions">
                  {m.actions.map((a) => (
                    <button key={a.id} onClick={() => onAction(a)}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        )}
        {isTyping && (
          <div className="syn-bubble ai">
            <div className="label">
              <i />
              SYNAPSE AI
            </div>
            <div className="syn-typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>

      <div className="syn-ai-chips">
        {chips.map((c) => (
          <button key={c} onClick={() => onSend(c)} disabled={isTyping}>
            {c}
          </button>
        ))}
      </div>

      <div className="syn-ai-input">
        <input
          value={draft}
          placeholder="Ask about anatomy, modes, or CT slices…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <button onClick={submit} disabled={isTyping || !draft.trim()} title="Send">
          <IconSend size={16} />
        </button>
      </div>

      <div className="syn-ai-disclaimer">{DISCLAIMER}</div>
    </div>
  );
}
