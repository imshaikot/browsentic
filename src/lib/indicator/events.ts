export const INDICATOR_CHANNEL = 'browsentic/indicator';

/** Matches --brand in assets/globals.css; the background has no stylesheet to read it from. */
export const INDICATOR_COLOR = '#ff7a3d';

export interface IndicatorCommand {
  channel: typeof INDICATOR_CHANNEL;
  op: 'busy' | 'idle';
}

export function isIndicatorCommand(message: unknown): message is IndicatorCommand {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as IndicatorCommand).channel === INDICATOR_CHANNEL
  );
}
