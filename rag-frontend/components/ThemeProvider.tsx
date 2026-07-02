'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'

type Theme = 'dark' | 'light'

type ThemeContextValue = {
    theme: Theme
    toggleTheme: () => void
}

const STORAGE_KEY = 'docmind_theme'

const ThemeContext = createContext<ThemeContextValue | null>(null)

function applyTheme(theme: Theme) {
    document.documentElement.setAttribute('data-theme', theme)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setTheme] = useState<Theme>('dark')

    useEffect(() => {
        const savedTheme = window.localStorage.getItem(STORAGE_KEY)

        if (savedTheme === 'dark' || savedTheme === 'light') {
            setTheme(savedTheme)
            applyTheme(savedTheme)
            return
        }

        applyTheme('dark')
    }, [])

    useEffect(() => {
        applyTheme(theme)
        window.localStorage.setItem(STORAGE_KEY, theme)
    }, [theme])

    const value = useMemo(
        () => ({
            theme,
            toggleTheme: () => setTheme(current => current === 'dark' ? 'light' : 'dark'),
        }),
        [theme]
    )

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
    const context = useContext(ThemeContext)

    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider')
    }

    return context
}
