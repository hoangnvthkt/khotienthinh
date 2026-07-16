import { useEffect } from 'react';
import {
  xpService,
  type DailyXPEventType,
  type XPAwardResult,
} from '../lib/xpService';
import { isSupabaseConfigured } from '../lib/supabase';

type DailyXPAward = (
  eventType: DailyXPEventType,
  sourceId?: string,
) => Promise<XPAwardResult>;

export const awardAuthenticatedDailyLogin = (
  awardDailyXP: DailyXPAward = xpService.awardDailyXP,
  configured = isSupabaseConfigured,
): Promise<XPAwardResult | null> => (
  configured ? awardDailyXP('daily_login') : Promise.resolve(null)
);

export const useDailyLoginXp = (): void => {
  useEffect(() => {
    void awardAuthenticatedDailyLogin().catch(() => {});
  }, []);
};

export const DailyLoginXpHost: React.FC = () => {
  useDailyLoginXp();
  return null;
};
