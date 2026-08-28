export interface Utterance {
  text: string;
  raw: string;
  question: boolean;
}

const SPOKEN_TLD = /\b([a-z0-9][a-z0-9-]*)\s+dot\s+(com|net|org|io|dev|co|ai|app|edu|gov|me|uk|xyz)\b/g;

const OPENER =
  /^(?:hey|hi|ok|okay|yo|um|uh|please|browsentic|assistant|can you|could you|would you|will you|i want you to|i would like you to|id like you to|lets|just|now|go ahead and)\s+/;

const TRAILER =
  /\s+(?:please|thanks|thank you|for me|now|a bit|a little|a lot|some more|more|slightly|real quick|quickly)$/;

const PUNCTUATION = /[^a-z0-9\s./:&=@_+#-]/g;

export function normalize(input: string): Utterance {
  const raw = input.trim();

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

  return { text: text.replace(/\.$/, ''), raw, question: /\?\s*$/.test(raw) && !softened };
}
