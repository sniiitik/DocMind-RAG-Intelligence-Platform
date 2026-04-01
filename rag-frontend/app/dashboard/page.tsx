'use client'
import { useState, useEffect } from 'react'
import { getEvalHistory } from '@/lib/api'

type EvalEntry = {
    question: string
    scores: { faithfulness?: number; answer_relevancy?: number }
}

function MetricCard({ label, value, description }: { label: string; value: number | null; description: string }) {
    const pct = value != null ? Math.round(value * 100) : null
    const color = pct == null ? 'var(--text-muted)' : pct >= 75 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)'

    return (
        <div style={{
            padding: '20px 24px', borderRadius: 14,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', gap: 4,
        }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
            <p style={{ fontSize: 36, fontFamily: 'var(--font-mono)', fontWeight: 300, color, letterSpacing: '-0.02em' }}>
                {pct != null ? `${pct}%` : '—'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{description}</p>
        </div>
    )
}

function ScoreBar({ value }: { value: number }) {
    const pct = Math.round(value * 100)
    const color = pct >= 75 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)'
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--bg-hover)' }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: color, transition: 'width 0.6s ease' }} />
            </div>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color, minWidth: 32, textAlign: 'right' }}>{pct}%</span>
        </div>
    )
}

export default function DashboardPage() {
    const [history, setHistory] = useState<EvalEntry[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        getEvalHistory().then(d => setHistory(d.history || [])).catch(() => { }).finally(() => setLoading(false))
    }, [])

    const avg = (key: 'faithfulness' | 'answer_relevancy') => {
        const vals = history.map(h => h.scores[key]).filter((v): v is number => v != null)
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }

    const avgFaith = avg('faithfulness')
    const avgRel = avg('answer_relevancy')
    const overallScore = avgFaith != null && avgRel != null ? (avgFaith + avgRel) / 2 : null

    return (
        <div style={{ padding: '32px', maxWidth: 860, margin: '0 auto' }}>

            <div className="fade-up" style={{ marginBottom: 32 }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, letterSpacing: '-0.02em', marginBottom: 6 }}>
                    Eval Dashboard
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                    RAGAS evaluation metrics across all queries
                </p>
            </div>

            {/* Summary cards */}
            <div className="fade-up-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 32 }}>
                <MetricCard label="Overall score" value={overallScore} description="Average across all metrics" />
                <MetricCard label="Faithfulness" value={avgFaith} description="Answer grounded in context" />
                <MetricCard label="Relevance" value={avgRel} description="Answer addresses the question" />
            </div>

            {/* History */}
            <div className="fade-up-2">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <h2 style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Query log · {history.length} {history.length === 1 ? 'entry' : 'entries'}
                    </h2>
                </div>

                {loading && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 72 }} />)}
                    </div>
                )}

                {!loading && history.length === 0 && (
                    <div style={{
                        padding: '40px 24px', borderRadius: 14, textAlign: 'center',
                        background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    }}>
                        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                            No evals yet — ask questions in the Chat tab to generate scores
                        </p>
                    </div>
                )}

                {!loading && history.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {[...history].reverse().map((entry, i) => (
                            <div key={i} style={{
                                padding: '14px 18px', borderRadius: 12,
                                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                                display: 'flex', flexDirection: 'column', gap: 10,
                            }}>
                                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                                    {entry.question}
                                </p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {entry.scores.faithfulness != null && (
                                        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: 10 }}>
                                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Faithfulness</span>
                                            <ScoreBar value={entry.scores.faithfulness} />
                                        </div>
                                    )}
                                    {entry.scores.answer_relevancy != null && (
                                        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: 10 }}>
                                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Relevance</span>
                                            <ScoreBar value={entry.scores.answer_relevancy} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
