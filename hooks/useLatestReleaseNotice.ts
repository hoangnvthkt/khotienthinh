import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '../types';
import { isSupabaseConfigured } from '../lib/supabase';
import { AppRelease, releaseNoticeService } from '../lib/releaseNoticeService';

type ReleaseNoticeUser = Pick<User, 'id'> | null | undefined;

export const useLatestReleaseNotice = (user: ReleaseNoticeUser) => {
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const lastCompletedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !user?.id) {
      lastCompletedUserIdRef.current = null;
      setRelease(null);
      setIsOpen(false);
      setIsChecking(false);
      return;
    }

    if (lastCompletedUserIdRef.current === user.id) return;

    let cancelled = false;
    setIsChecking(true);

    const loadNotice = async () => {
      try {
        const latestRelease = await releaseNoticeService.getLatestActiveRelease();
        if (cancelled) return;

        if (!latestRelease) {
          setRelease(null);
          setIsOpen(false);
          return;
        }

        const hasRead = await releaseNoticeService.hasReadRelease(user.id, latestRelease.id);
        if (cancelled) return;

        if (!hasRead) {
          setRelease(latestRelease);
          setIsOpen(true);
        } else {
          setRelease(null);
          setIsOpen(false);
        }
      } catch (error) {
        console.warn('Release notice check failed:', error);
        if (!cancelled) {
          setRelease(null);
          setIsOpen(false);
        }
      } finally {
        if (!cancelled) {
          lastCompletedUserIdRef.current = user.id;
          setIsChecking(false);
        }
      }
    };

    void loadNotice();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const acknowledgeRelease = useCallback(async () => {
    if (!release || !user?.id || isMarkingRead) return;

    setIsMarkingRead(true);
    try {
      await releaseNoticeService.markReleaseRead(user.id, release.id);
    } catch (error) {
      console.warn('Release notice read mark failed:', error);
    } finally {
      setIsMarkingRead(false);
      setIsOpen(false);
      setRelease(null);
    }
  }, [isMarkingRead, release, user?.id]);

  return {
    release,
    isOpen,
    isChecking,
    isMarkingRead,
    acknowledgeRelease,
  };
};
