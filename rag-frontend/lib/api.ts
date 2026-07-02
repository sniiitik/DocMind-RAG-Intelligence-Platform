const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export async function ingestDocument(file: File) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/api/ingest`, { method: 'POST', body: form })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
}

export async function listDocuments() {
    const res = await fetch(`${BASE}/api/documents`)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
}

export type QueryPayload = {
    question: string
    top_k?: number
    document_name?: string
    document_names?: string[]
    page?: number
    page_start?: number
    page_end?: number
    content_type?: 'text' | 'table'
    mode?: 'qa' | 'summary' | 'compare' | 'risks' | 'action_items' | 'timeline' | 'table_insights'
    session_id?: string
    conversation?: { role: 'user' | 'assistant'; content: string }[]
    metadata?: Record<string, string | number | boolean>
}

export async function queryDocuments(input: string | QueryPayload, topK = 5) {
    const payload =
        typeof input === 'string'
            ? { question: input, top_k: topK }
            : input

    const res = await fetch(`${BASE}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })

    if (!res.ok) throw new Error(await res.text())
    return res.json()
}

export async function evaluateAnswer(
    question: string,
    answer: string,
    contexts: string[],
    options?: {
        mode?: string
        retrieval_mode?: string
        traceability?: Array<{ sentence: string; supports: Array<{ score: number }> }>
    }
) {
    const res = await fetch(`${BASE}/api/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            question,
            answer,
            contexts,
            mode: options?.mode,
            retrieval_mode: options?.retrieval_mode,
            traceability: options?.traceability || [],
        }),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
}

export async function getEvalHistory() {
    const res = await fetch(`${BASE}/api/eval-history`)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
}

export async function clearEvalHistory() {
    const res = await fetch(`${BASE}/api/eval-history`, {
        method: 'DELETE',
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
}

export async function deleteDocument(name: string) {
    const res = await fetch(`${BASE}/api/documents/${encodeURIComponent(name)}`, {
        method: 'DELETE',
    })

    if (!res.ok) throw new Error(await res.text())
    return res.json()
}
