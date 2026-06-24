const isEnabledByDefault = (value: string | undefined): boolean => value !== 'false';

export const isChatEnabled = isEnabledByDefault(import.meta.env.VITE_ENABLE_CHAT);
export const isChatV2Enabled = isEnabledByDefault(import.meta.env.VITE_ENABLE_CHAT_V2);
