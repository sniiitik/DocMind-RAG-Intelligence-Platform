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

export async function queryDocuments(question: string, topK = 5) {
    const res = await fetch(`${BASE}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, top_k: topK }),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
}

export async function evaluateAnswer(question: string, answer: string, contexts: string[]) {
    const res = await fetch(`${BASE}/api/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer, contexts }),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
}

export async function getEvalHistory() {
    const res = await fetch(`${BASE}/api/eval-history`)
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