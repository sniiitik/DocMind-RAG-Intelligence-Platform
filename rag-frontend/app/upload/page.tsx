'use client'
import { useState, useCallback, useEffect } from 'react'
import { ingestDocument, listDocuments, deleteDocument } from '@/lib/api'

type DocInfo = { name: string; status: 'uploading' | 'done' | 'error'; chunks?: number; error?: string }

function FileIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    )
}

export default function UploadPage() {
    const [docs, setDocs] = useState<DocInfo[]>([])
    const [ingestedSources, setIngestedSources] = useState<string[]>([])
    const [dragging, setDragging] = useState(false)

    useEffect(() => {
        listDocuments().then(d => setIngestedSources(d.documents || [])).catch(() => { })
    }, [])

    async function processFiles(files: FileList | File[]) {
        const arr = Array.from(files).filter(f =>
            f.type === 'application/pdf' || f.type === 'text/plain' || f.name.endsWith('.md')
        )
        if (!arr.length) return

        const newDocs: DocInfo[] = arr.map(f => ({ name: f.name, status: 'uploading' }))
        setDocs(prev => [...prev, ...newDocs])

        for (const file of arr) {
            try {
                const res = await ingestDocument(file)
                setDocs(prev => prev.map(d => d.name === file.name ? { ...d, status: 'done', chunks: res.chunks } : d))
                setIngestedSources(prev => [...new Set([...prev, file.name])])
            } catch (err) {
                setDocs(prev => prev.map(d => d.name === file.name ? { ...d, status: 'error', error: String(err) } : d))
            }
        }
    }

    async function handleDelete(name: string) {
        if (!confirm(`Are you sure you want to delete "${name}" from the knowledge base? This action cannot be undone.`)) return
        try {
            await deleteDocument(name)
            setIngestedSources(prev => prev.filter(src => src !== name))
            setDocs(prev => prev.filter(d => d.name !== name))
        } catch (err) {
            alert(`Failed to delete document: ${err instanceof Error ? err.message : String(err)}`)
        }
    }

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault(); setDragging(false)
        processFiles(e.dataTransfer.files)
    }, [])

    return (
        <div style={{ padding: '32px', maxWidth: 780, margin: '0 auto' }}>

            {/* Header */}
            <div className="fade-up" style={{ marginBottom: 32 }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, letterSpacing: '-0.02em', marginBottom: 6 }}>
                    Documents
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                    Upload PDFs or text files to build your knowledge base
                </p>
            </div>

            {/* Drop zone */}
            <div
                className="fade-up-1"
                onDragEnter={e => { e.preventDefault(); setDragging(true) }}
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                style={{
                    border: `1.5px dashed ${dragging ? 'var(--accent)' : 'var(--border-bright)'}`,
                    borderRadius: 16, padding: '40px 24px', textAlign: 'center',
                    background: dragging ? 'var(--accent-glow)' : 'var(--bg-surface)',
                    transition: 'all 0.2s ease', cursor: 'pointer', marginBottom: 28,
                }}
                onClick={() => document.getElementById('file-input')?.click()}
            >
                <input
                    id="file-input"
                    type="file"
                    multiple
                    accept=".pdf,.txt,.md"
                    style={{ display: 'none' }}
                    onChange={e => e.target.files && processFiles(e.target.files)}
                />
                <div style={{
                    width: 48, height: 48, borderRadius: 14, margin: '0 auto 16px',
                    background: 'var(--accent-dim)', border: '1px solid rgba(124,106,247,0.25)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                </div>
                <p style={{ fontSize: 15, color: 'var(--text-primary)', marginBottom: 4, fontWeight: 500 }}>
                    {dragging ? 'Drop to upload' : 'Drop files here or click to browse'}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Supports PDF, TXT, Markdown
                </p>
            </div>

            {/* Upload queue */}
            {docs.length > 0 && (
                <div className="fade-up-2" style={{ marginBottom: 28 }}>
                    <h2 style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10, fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        This session
                    </h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {docs.map(doc => (
                            <div key={doc.name} style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                padding: '12px 16px', borderRadius: 10,
                                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                            }}>
                                <span style={{ color: doc.status === 'done' ? 'var(--success)' : doc.status === 'error' ? 'var(--danger)' : 'var(--accent)' }}>
                                    <FileIcon />
                                </span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {doc.name}
                                    </p>
                                    {doc.status === 'uploading' && <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Processing…</p>}
                                    {doc.status === 'done' && <p style={{ fontSize: 11, color: 'var(--success)' }}>{doc.chunks} chunks indexed</p>}
                                    {doc.status === 'error' && <p style={{ fontSize: 11, color: 'var(--danger)' }}>Failed — check backend</p>}
                                </div>
                                <span style={{
                                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                    background: doc.status === 'done' ? 'var(--success)' : doc.status === 'error' ? 'var(--danger)' : 'var(--accent)',
                                    animation: doc.status === 'uploading' ? 'pulse-dot 1s infinite' : 'none',
                                }} />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* All ingested documents */}
            {ingestedSources.length > 0 && (
                <div className="fade-up-3">
                    <h2 style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10, fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Knowledge base · {ingestedSources.length} {ingestedSources.length === 1 ? 'document' : 'documents'}
                    </h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                        {ingestedSources.map(src => (
                            <div key={src} style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '12px 14px', borderRadius: 10,
                                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                            }}>
                                <span style={{ color: 'var(--success)', flexShrink: 0 }}><FileIcon /></span>
                                <span style={{
                                    fontSize: 12, fontFamily: 'var(--font-mono)',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    color: 'var(--text-secondary)',
                                }}>
                                    {src}
                                </span>

                                <button onClick={() => handleDelete(src)} style={{
                                    marginLeft: 'auto', padding: '3px 7px', fontSize: 11, color: 'var(--danger)',
                                    background: 'transparent', border: '1px solid var(--danger)', borderRadius: 6,
                                    cursor: 'pointer', transition: 'all 0.15s ease',
                                }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--danger)'; (e.currentTarget as HTMLElement).style.color = '#fff' }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--danger)' }}
                                >
                                    Delete
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {ingestedSources.length === 0 && docs.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                    No documents yet — upload your first file above
                </div>
            )}
        </div>
    )
}
