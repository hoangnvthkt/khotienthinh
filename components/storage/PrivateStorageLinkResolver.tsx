import { useEffect } from 'react';
import { useToast } from '../../context/ToastContext';
import { getCachedSignedUrl, parsePrivateStorageUrl, resolveStorageUrl } from '../../lib/storageSignedUrl';

// Rows written before a bucket went private still hold its public URL, and
// many screens (some owned by other tracks) render them as-is. This resolver
// swaps those URLs for signed ones wherever they reach the DOM, so every
// screen keeps working without touching each one. New code should sign
// explicitly (useSignedStorageUrl / resolveStorageUrl).

const MEDIA_ATTRIBUTES: Record<string, string> = {
  IMG: 'src', SOURCE: 'src', VIDEO: 'src', AUDIO: 'src', IFRAME: 'src', EMBED: 'src', OBJECT: 'data',
};
const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const ORIGINAL = 'data-private-storage-src';

const resolveElement = (element: Element) => {
  const attribute = element.tagName === 'A' ? 'href' : MEDIA_ATTRIBUTES[element.tagName];
  if (!attribute) return;
  const value = element.getAttribute(attribute);
  if (!value || !parsePrivateStorageUrl(value)) return;

  const cached = getCachedSignedUrl(value);
  if (cached) { element.setAttribute(attribute, cached); return; }

  element.setAttribute(ORIGINAL, value);
  // Stop the browser from requesting the dead public URL meanwhile.
  if (element.tagName === 'IMG') element.setAttribute(attribute, TRANSPARENT_PIXEL);
  else if (element.tagName === 'IFRAME') element.setAttribute(attribute, 'about:blank');

  resolveStorageUrl(value)
    .then(signed => {
      if (element.getAttribute(ORIGINAL) !== value) return;
      element.removeAttribute(ORIGINAL);
      element.setAttribute(attribute, signed);
    })
    .catch(() => {
      if (element.getAttribute(ORIGINAL) !== value) return;
      element.setAttribute('title', 'Không xem được tệp (không có quyền hoặc tệp không còn)');
    });
};

const resolveTree = (root: ParentNode) => {
  if (root instanceof Element) resolveElement(root);
  root.querySelectorAll?.('img, source, video, audio, iframe, embed, object, a[href]').forEach(resolveElement);
};

const PrivateStorageLinkResolver: React.FC = () => {
  const toast = useToast();

  useEffect(() => {
    resolveTree(document.body);
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') resolveElement(mutation.target as Element);
        else mutation.addedNodes.forEach(node => { if (node instanceof Element) resolveTree(node); });
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href', 'data'] });

    const openSigned = (url: string, target: string | null) => {
      const popup = target && target !== '_self' ? window.open('about:blank', target) : null;
      resolveStorageUrl(url)
        .then(signed => { if (popup) popup.location.href = signed; else window.location.assign(signed); })
        .catch(() => {
          popup?.close();
          toast.error('Không mở được tệp', 'Bạn không có quyền xem tệp này hoặc tệp không còn.');
        });
    };

    // A click can beat signing; open the signed URL instead of the dead one.
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      const href = anchor?.getAttribute(ORIGINAL) || anchor?.getAttribute('href');
      if (!anchor || !href || !parsePrivateStorageUrl(href) || anchor.hasAttribute('download')) return;
      event.preventDefault();
      openSigned(href, anchor.getAttribute('target'));
    };
    document.addEventListener('click', onClick, true);

    // Screens that call window.open(storedUrl) directly.
    const originalOpen = window.open.bind(window);
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      const href = url?.toString();
      if (href && parsePrivateStorageUrl(href)) {
        const popup = originalOpen('about:blank', target || '_blank', features);
        resolveStorageUrl(href)
          .then(signed => { if (popup) popup.location.href = signed; })
          .catch(() => {
            popup?.close();
            toast.error('Không mở được tệp', 'Bạn không có quyền xem tệp này hoặc tệp không còn.');
          });
        return popup;
      }
      return originalOpen(url as string, target, features);
    }) as typeof window.open;

    return () => {
      observer.disconnect();
      document.removeEventListener('click', onClick, true);
      window.open = originalOpen;
    };
  }, [toast]);

  return null;
};

export default PrivateStorageLinkResolver;
