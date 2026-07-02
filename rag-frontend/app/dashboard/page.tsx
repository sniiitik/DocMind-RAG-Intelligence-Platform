'use client'
import { useState, useEffect } from 'react'
import { clearEvalHistory, getEvalHistory } from '@/lib/api'

type EvalEntry = {
    question: string
    timestamp?: string
    mode?: string
    retrieval_mode?: string
    scores: {
        faithfulness?: number
        answer_relevancy?: number
        groundedness?: number
        citation_precision?: number
        answer_completeness?: number
        retrieval_recall?: number
    }
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
    const [clearing, setClearing] = useState(false)

    useEffect(() => {
        getEvalHistory().then(d => setHistory(d.history || [])).catch(() => { }).finally(() => setLoading(false))
    }, [])

    async function handleClearHistory() {
        if (!history.length || clearing) return

        const confirmed = confirm(`Clear all ${history.length} eval ${history.length === 1 ? 'entry' : 'entries'} from the dashboard?`)
        if (!confirmed) return

        setClearing(true)

        try {
            await clearEvalHistory()
            setHistory([])
        } catch (err) {
            alert(`Failed to clear eval history: ${err instanceof Error ? err.message : String(err)}`)
        } finally {
            setClearing(false)
        }
    }

    const avg = (key: keyof EvalEntry['scores']) => {
        const vals = history.map(h => h.scores[key]).filter((v): v is number => v != null)
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }

    const avgFaith = avg('faithfulness')
    const avgRel = avg('answer_relevancy')
    const avgGrounded = avg('groundedness')
    const avgCitations = avg('citation_precision')
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
                <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8, maxWidth: 640, lineHeight: 1.6 }}>
                    Scores are mode-calibrated. Direct Q&A is graded more strictly, while summary, compare, and other synthesis-heavy modes use fairer thresholds for paraphrase, evidence spread, and multi-document coverage.
                </p>
            </div>

            {/* Summary cards */}
            <div className="fade-up-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
                <MetricCard label="Overall score" value={overallScore} description="Average across all metrics" />
                <MetricCard label="Faithfulness" value={avgFaith} description="Answer grounded in context" />
                <MetricCard label="Relevance" value={avgRel} description="Answer addresses the question" />
                <MetricCard label="Citation precision" value={avgCitations ?? avgGrounded} description="Answer sentences backed by evidence" />
            </div>

            {/* History */}
            <div className="fade-up-2">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <h2 style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Query log · {history.length} {history.length === 1 ? 'entry' : 'entries'}
                    </h2>
                    {history.length > 0 && (
                        <button
                            onClick={handleClearHistory}
                            disabled={clearing}
                            style={{
                                padding: '7px 10px',
                                borderRadius: 8,
                                fontSize: 12,
                                background: 'transparent',
                                border: '1px solid var(--border)',
                                color: clearing ? 'var(--text-muted)' : 'var(--text-secondary)',
                                cursor: clearing ? 'default' : 'pointer',
                            }}
                        >
                            {clearing ? 'Clearing...' : 'Clear history'}
                        </button>
                    )}
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
                                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                    {entry.mode ? `Mode: ${entry.mode.replaceAll('_', ' ')}` : 'Mode: qa'}
                                    {entry.retrieval_mode ? ` · ${entry.retrieval_mode}` : ''}
                                    {entry.timestamp ? ` · ${new Date(entry.timestamp).toLocaleString()}` : ''}
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
                                    {entry.scores.citation_precision != null && (
                                        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: 10 }}>
                                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Citations</span>
                                            <ScoreBar value={entry.scores.citation_precision} />
                                        </div>
                                    )}
                                    {entry.scores.answer_completeness != null && (
                                        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: 10 }}>
                                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Complete</span>
                                            <ScoreBar value={entry.scores.answer_completeness} />
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
