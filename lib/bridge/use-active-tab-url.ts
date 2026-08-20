import { useActiveTab } from './use-active-tab';

export function useActiveTabUrl(): string {
  return useActiveTab().url;
}
