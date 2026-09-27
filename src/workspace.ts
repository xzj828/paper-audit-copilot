export interface Preferences {
  autoModel: boolean;
  theme: string;
  layout: string;
  zoom: number;
  showOutline: boolean;
  scheme: string;
  articleType: string;
  outputMode: string;
}
export interface WorkspaceState {
  preferences: Preferences;
  collections: { id: string; name: string; createdAt: string }[];
  documents: Record<
    string,
    { collections: string[]; starred?: boolean; unread?: boolean; trashed?: boolean }
  >;
  configurations: Record<string, { status: string; updatedAt: string }>;
  savedAt: string | null;
}
export const defaultPreferences: Preferences = {
  autoModel: false,
  theme: 'light',
  layout: 'single',
  zoom: 100,
  showOutline: true,
  scheme: 'stxb-precheck@0.3.0-trial',
  articleType: 'empirical',
  outputMode: 'narrative',
};
