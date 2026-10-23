import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { noteScreen } from '../../lib/assistantScreen';

/** Ghi màn người dùng vừa mở (lib/assistantScreen) mỗi khi đường dẫn đổi — để Trợ lý biết "màn vừa mở" khi người dùng hỏi về lỗi. */
const ScreenTracker: React.FC<{ titleOf?: (route: string) => string | null }> = ({ titleOf }) => {
  const { pathname, search } = useLocation();
  useEffect(() => {
    const route = `${pathname}${search}`;
    noteScreen(route, titleOf?.(route) ?? null);
  }, [pathname, search, titleOf]);
  return null;
};

export default ScreenTracker;
