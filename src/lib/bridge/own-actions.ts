import type { ToolDescriptor } from '@/lib/actions/manifest';
import { describeActions } from '@/lib/actions/registry';

/** The tools this build offers: the registry decides, told which browser it was built for. */
export function describeOwnActions(): ToolDescriptor[] {
  return describeActions(import.meta.env.FIREFOX ? 'firefox' : 'chromium');
}
