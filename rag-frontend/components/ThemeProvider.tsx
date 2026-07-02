'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'

type Theme = 'dark' | 'light'

type ThemeContextValue = {
    theme: Theme
    mounted: boolean
    toggleTheme: () => void
}

const STORAGE_KEY = 'docmind_theme'

const ThemeContext = createContext<ThemeContextValue | null>(null)

function applyTheme(theme: Theme) {
    document.documentElement.setAttribute('data-theme', theme)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setTheme] = useState<Theme>('dark')
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        const savedTheme = window.localStorage.getItem(STORAGE_KEY)

        if (savedTheme === 'light' || savedTheme === 'dark') {
            queueMicrotask(() => setTheme(savedTheme))
        }

        queueMicrotask(() => setMounted(true))
    }, [])

    useEffect(() => {
        applyTheme(theme)
        if (mounted) {
            window.localStorage.setItem(STORAGE_KEY, theme)
        }
    }, [mounted, theme])

    const value = useMemo(
        () => ({
            theme,
            mounted,
            toggleTheme: () => setTheme(current => current === 'dark' ? 'light' : 'dark'),
        }),
        [mounted, theme]
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
