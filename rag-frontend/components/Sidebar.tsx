'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
    {
        href: '/',
        label: 'Chat',
        icon: (
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
        ),
    },
    {
        href: '/upload',
        label: 'Documents',
        icon: (
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
        ),
    },
    {
        href: '/dashboard',
        label: 'Evals',
        icon: (
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
        ),
    },
]

export default function Sidebar() {
    const pathname = usePathname()

    return (
        <aside style={{
            width: 220,
            minHeight: '100vh',
            background: 'var(--bg-surface)',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            padding: '24px 0',
            flexShrink: 0,
        }}>
            {/* Logo */}
            <div style={{ padding: '0 20px 28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: 'var(--accent-dim)',
                        border: '1px solid rgba(124,106,247,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                        </svg>
                    </div>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                        DocMind
                    </span>
                </div>
            </div>

            {/* Nav */}
            <nav style={{ flex: 1, padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {nav.map(({ href, label, icon }) => {
                    const active = pathname === href
                    return (
                        <Link key={href} href={href} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '9px 12px', borderRadius: 8,
                            color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                            background: active ? 'var(--bg-hover)' : 'transparent',
                            textDecoration: 'none', fontSize: 14, fontWeight: active ? 500 : 400,
                            transition: 'all 0.15s ease',
                        }}
                            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--bg-raised)' }}
                            onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                        >
                            <span style={{ color: active ? 'var(--accent)' : 'currentColor', opacity: active ? 1 : 0.6 }}>{icon}</span>
                            {label}
                            {active && <span style={{ marginLeft: 'auto', width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />}
                        </Link>
                    )
                })}
            </nav>

            {/* Footer */}
            <div style={{ padding: '16px 20px 0', borderTop: '1px solid var(--border)', marginTop: 8 }}>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Powered by Groq · LLaMA 3.3 70B<br />
                    ChromaDB · RAGAS Evals
                </p>
            </div>
        </aside>
    )
}
