import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'

export const metadata: Metadata = {
  title: 'DocMind - RAG Intelligence Platform',
  description: 'Ask questions across your documents with AI-powered retrieval',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar />
        <main style={{ flex: 1, overflow: 'auto' }}>
          {children}
        </main>
      </body>
    </html>
  )
}