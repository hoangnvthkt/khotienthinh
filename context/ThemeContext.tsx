import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'light' | 'dark';
type UIMode = 'modern' | 'enterprise';

interface ThemeContextType {
    theme: Theme;
    uiMode: UIMode;
    toggleTheme: () => void;
    setUiMode: (mode: UIMode) => void;
    isDark: boolean;
    isEnterprise: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [theme, setTheme] = useState<Theme>(() => {
        const saved = localStorage.getItem('vioo_theme');
        return (saved as Theme) || 'light';
    });

    const [uiMode, setUiMode] = useState<UIMode>(() => {
        const saved = localStorage.getItem('vioo_ui_mode');
        return (saved as UIMode) || 'modern';
    });

    const isEnterprise = uiMode === 'enterprise';
    const isDark = theme === 'dark' && !isEnterprise;

    useEffect(() => {
        const root = document.documentElement;
        if (isDark) {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
        localStorage.setItem('vioo_theme', theme);
    }, [theme, isDark]);

    useEffect(() => {
        const root = document.documentElement;
        if (isEnterprise) {
            root.classList.add('enterprise');
        } else {
            root.classList.remove('enterprise');
        }
        localStorage.setItem('vioo_ui_mode', uiMode);
    }, [uiMode, isEnterprise]);

    const toggleTheme = () => {
        if (isEnterprise) return;
        setTheme(prev => prev === 'light' ? 'dark' : 'light');
    };

    return (
        <ThemeContext.Provider value={{ theme, uiMode, toggleTheme, setUiMode, isDark, isEnterprise }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) throw new Error('useTheme must be used within ThemeProvider');
    return context;
};
