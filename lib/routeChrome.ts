// Khung chung (Layout) theo route: màn nào tràn hết vùng làm việc, màn nào có thanh riêng
// nên ẩn header điện thoại / thanh đáy / nút nổi của app.
export interface RouteChrome {
  /** Nội dung chiếm trọn vùng main, không lề, tự cuộn. */
  fullBleed: boolean;
  /** Vioo Work dùng main làm khung cuộn. */
  workScrollHost: boolean;
  hideMobileHeader: boolean;
  hideBottomNav: boolean;
  hideFab: boolean;
  hideDock: boolean;
  hideChatBubble: boolean;
}

/** Màn có header riêng trên điện thoại nhận hàm mở menu ứng dụng qua useOutletContext. */
export interface LayoutOutletContext {
  openSidebar: () => void;
}

const DEFAULT_CHROME: RouteChrome = {
  fullBleed: false,
  workScrollHost: false,
  hideMobileHeader: false,
  hideBottomNav: false,
  hideFab: false,
  hideDock: false,
  hideChatBubble: false,
};

const isWorkRoute = (pathname: string) => pathname === '/work' || pathname.startsWith('/work/');

/** Luật theo thứ tự, luật đầu tiên khớp được dùng. */
export const ROUTE_CHROME: ReadonlyArray<{ match: (pathname: string) => boolean; chrome: Partial<RouteChrome> }> = [
  // Trung tâm điều hành có header, cột việc và thanh 3 tab đáy riêng.
  {
    match: pathname => pathname === '/center',
    chrome: { fullBleed: true, hideMobileHeader: true, hideBottomNav: true, hideFab: true, hideDock: true, hideChatBubble: true },
  },
  { match: isWorkRoute, chrome: { fullBleed: true, workScrollHost: true } },
  { match: pathname => pathname === '/chat' || pathname.startsWith('/rq') || pathname === '/wf', chrome: { fullBleed: true } },
];

export const getRouteChrome = (pathname: string): RouteChrome => ({
  ...DEFAULT_CHROME,
  ...ROUTE_CHROME.find(rule => rule.match(pathname))?.chrome,
});
