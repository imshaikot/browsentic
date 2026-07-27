/**
 * Reduce an utterance to the flat form the grammar matches against, so that
 * "Hey VoiceLink, could you scroll down a bit please?" and "scroll down" arrive as the same
 * two words. Everything here is lossy on purpose: the original text is kept alongside, and
 * it — not this — is what gets escalated to the agent.
 */
export interface Utterance {
  /** Lowercased, depunctuated, opener- and trailer-free. The grammar matches this. */
  text: string;
  /** What the user actually said or typed, trimmed. Escalation sends this. */
  raw: string;
  /**
   * Phrased as a question, so it wants an answer rather than an action. A trailing "?" only
   * counts when nothing polite was stripped off: "could you go back please?" is a request
   * wearing a question mark, while a bare "back?" really is one.
   */
  question: boolean;
}

/** Speech-to-text hears a spoken domain as separate words: "github dot com". */
const SPOKEN_TLD = /\b([a-z0-9][a-z0-9-]*)\s+dot\s+(com|net|org|io|dev|co|ai|app|edu|gov|me|uk|xyz)\b/g;

/** Address and politeness ahead of the command. Stripped repeatedly — they stack. */
const OPENER =
  /^(?:hey|hi|ok|okay|yo|um|uh|please|voicelink|assistant|can you|could you|would you|will you|i want you to|i would like you to|id like you to|lets|just|now|go ahead and)\s+/;

/** Softeners that trail a complete command without changing what it asks for. */
const TRAILER =
  /\s+(?:please|thanks|thank you|for me|now|a bit|a little|a lot|some more|more|slightly|real quick|quickly)$/;

/**
 * Characters a URL needs, kept; everything else is sentence punctuation and becomes a space.
 * The question mark goes too, but only after {@link normalize} has noted that it was there.
 */
const PUNCTUATION = /[^a-z0-9\s./:&=@_+#-]/g;

export function normalize(input: string): Utterance {
  const raw = input.trim();

  // Apostrophes are dropped rather than spaced, so "what's" stays one token ("whats").
  let text = raw.toLowerCase().replace(/['‘’]/g, '');
  text = text.replace(SPOKEN_TLD, '$1.$2');
  text = text.replace(PUNCTUATION, ' ').replace(/\s+/g, ' ').trim();

  let softened = false;
  let previous;
  do {
    previous = text;
    text = text.replace(OPENER, '').replace(TRAILER, '').trim();
    softened ||= text !== previous;
  } while (text !== previous);

  // A sentence-ending period survives PUNCTUATION because "github.com" needs dots.
  return { text: text.replace(/\.$/, ''), raw, question: /\?\s*$/.test(raw) && !softened };
}
