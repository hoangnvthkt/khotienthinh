import { useEffect, useState } from 'react';
import { parsePrivateStorageUrl, resolveStorageUrl } from '../lib/storageSignedUrl';

export type SignedStorageUrlState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error' };

/** Display URL for a stored file URL; private buckets are signed on demand. */
export const useSignedStorageUrl = (storedUrl: string | null | undefined): SignedStorageUrlState => {
  const trimmed = storedUrl?.trim() || '';
  const needsSigning = Boolean(parsePrivateStorageUrl(trimmed));
  const [state, setState] = useState<SignedStorageUrlState>(() => (
    !trimmed ? { status: 'empty' } : needsSigning ? { status: 'loading' } : { status: 'ready', url: trimmed }
  ));

  useEffect(() => {
    if (!trimmed) { setState({ status: 'empty' }); return; }
    if (!needsSigning) { setState({ status: 'ready', url: trimmed }); return; }
    let cancelled = false;
    setState({ status: 'loading' });
    resolveStorageUrl(trimmed)
      .then(url => { if (!cancelled) setState({ status: 'ready', url }); })
      .catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [needsSigning, trimmed]);

  return state;
};
