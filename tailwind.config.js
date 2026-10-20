// Tailwind biên dịch lúc build (audit 20/10/2026, mục S5): thay cdn.tailwindcss.com (Play CDN, JIT trong trình duyệt,
// ~110 KB JS + biên dịch CSS mỗi lần mở trang, không khóa phiên bản, không SRI). Cấu hình chép nguyên từ khối
// `tailwind.config` inline trong index.html cũ để CSS sinh ra giống hệt.
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './constants.ts',
    './types.ts',
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './context/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './routes/**/*.{ts,tsx}',
    './constants/**/*.{ts,tsx}',
    '!./lib/__tests__/**',
  ],
  // Class ghép lúc chạy (pages/Settings.tsx: `bg-${item.color}-50`…) — Tailwind không thấy khi quét mã nên giữ sẵn.
  safelist: [
    { pattern: /^(bg|text|border)-(blue|emerald|violet|amber|rose|cyan|orange)-(50|200|600)$/, variants: ['hover'] },
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Tông Deep Teal/Emerald thâm trầm chủ đạo (Brand Accent)
        primary: '#0f766e',   // teal-700
        secondary: '#115e59', // teal-800
        accent: '#0f766e',    // teal-700
        success: '#16a34a',   // green-600
        // Bảng màu FastCons (02/10/2026): xanh ngọc cho biểu tượng/nhấn, xanh lá cho nút chính & số liệu.
        // Cam/đỏ chỉ dùng cho cảnh báo, quá hạn, từ chối.
        mint: { 50: '#effbf8', 100: '#d5f4ed', 200: '#aae8db', 300: '#78d8c5', 400: '#52cbb5', 500: '#3cbfaa', 600: '#2ea592', 700: '#268576', 800: '#206a5f', 900: '#1b574e' },
        leaf: { 50: '#f1f9ee', 100: '#ddf1d5', 200: '#bce3ad', 300: '#93d17e', 400: '#6fc158', 500: '#52b53a', 600: '#43992f', 700: '#367a27', 800: '#2e6123', 900: '#27501f' },
        danger: '#dc2626',
        warning: '#d97706',

        // Semantic Theme Tokens
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: 'var(--card)',
        'card-foreground': 'var(--card-foreground)',
        'muted-foreground': 'var(--muted-foreground)',
        border: 'var(--border)',
        muted: 'var(--muted)',
        input: 'var(--input)',
        popover: 'var(--popover)',
        'popover-foreground': 'var(--popover-foreground)',
        destructive: 'var(--destructive)',
        'destructive-foreground': 'var(--destructive-foreground)',
      },
      keyframes: {
        shrink: {
          '0%': { width: '100%' },
          '100%': { width: '0%' },
        },
        fadeInDown: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(100%)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200px 0' },
          '100%': { backgroundPosition: 'calc(200px + 100%) 0' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      animation: {
        shrink: 'shrink var(--dur) linear forwards',
        'fade-in-down': 'fadeInDown 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.35s ease-out',
        shimmer: 'shimmer 1.5s infinite linear',
      },
    },
  },
};
