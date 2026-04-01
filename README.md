# DocMind — Production RAG Intelligence Platform

> Ask questions across your documents using AI-powered retrieval, with real-time evaluation metrics. Built as a zero-cost, production-grade RAG system using local embeddings, ChromaDB, and Groq.

![Stack](https://img.shields.io/badge/Next.js-14-black?style=flat-square&logo=next.js)
![Stack](https://img.shields.io/badge/FastAPI-Python-009688?style=flat-square&logo=fastapi)
![Stack](https://img.shields.io/badge/ChromaDB-local-orange?style=flat-square)
![Stack](https://img.shields.io/badge/Groq-LLaMA_3.3_70B-blue?style=flat-square)
![Cost](https://img.shields.io/badge/API_cost-$0-brightgreen?style=flat-square)

---

## What is this?

DocMind is a full-stack Retrieval-Augmented Generation (RAG) application that lets you upload documents (PDFs, text, markdown) and ask natural language questions against them. Every answer is grounded in your documents with source citations, and automatically evaluated for faithfulness and relevance using a local, zero-cost eval engine.

This project was built to demonstrate production RAG thinking — not just "make a chatbot that reads PDFs" but to show the full pipeline: ingestion, chunking strategy, embedding, retrieval, generation, and evaluation.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        INGESTION PIPELINE                        │
│                                                                   │
│  PDF/TXT/MD  →  Chunker  →  Embedder  →  ChromaDB (local)       │
│               (RecursiveChar  (all-MiniLM-    (persistent        │
│                Splitter)       L6-v2)          vector store)     │
└─────────────────────────────────────────────────────────────────┘
                                    │
                              stored vectors
                                    │
┌─────────────────────────────────────────────────────────────────┐
│                         QUERY PIPELINE                           │
│                                                                   │
│  User Question  →  Embedder  →  Retriever  →  LLM  →  Answer   │
│                  (same model)  (top-5 cosine  (Groq /    with   │
│                                 similarity)   LLaMA 3.3) citations│
└─────────────────────────────────────────────────────────────────┘
                                    │
                              answer + context
                                    │
┌─────────────────────────────────────────────────────────────────┐
│                          EVAL LAYER                              │
│                                                                   │
│  Faithfulness Score          Relevance Score                     │
│  (sentence cosine sim        (question-answer cosine sim         │
│   vs retrieved chunks)        with length + no-info penalties)   │
│                                                                   │
│  Results logged to eval_log.json → surfaced in dashboard        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 14 + TypeScript | Production-grade React with App Router |
| Styling | Tailwind CSS + CSS variables | Custom dark theme, zero component libraries |
| Backend | FastAPI (Python) | Async, auto-docs via Swagger UI |
| Embeddings | `sentence-transformers/all-MiniLM-L6-v2` | Free, runs locally, 384-dim vectors |
| Vector DB | ChromaDB (persistent) | Local, no infra needed, production-ready API |
| LLM | Groq API — LLaMA 3.3 70B | Free tier, ~300 tokens/sec inference |
| Eval | Custom cosine similarity engine | Zero cost — no external API calls |
| Document loading | LangChain (PyPDFLoader, TextLoader) | Battle-tested document parsing |
| Chunking | RecursiveCharacterTextSplitter | Respects natural text boundaries |

**Total API cost to run: $0** — embeddings and evals run locally, Groq's free tier covers LLM inference.

---

## Project Structure

```
DocMind-RAG-Intelligence-Platform/
├── backend/
│   ├── main.py          # FastAPI app + CORS + router registration
│   ├── ingest.py        # Document upload, chunking, embedding, storage
│   ├── retriever.py     # Query embedding, vector search, LLM generation
│   ├── evaluator.py     # Local faithfulness + relevance scoring
│   ├── requirements.txt
│   └── .env             # GROQ_API_KEY
│
└── rag-frontend/
    ├── app/
    │   ├── page.tsx          # Chat interface with persistent history
    │   ├── upload/page.tsx   # Drag-and-drop document ingestion
    │   └── dashboard/page.tsx # Eval metrics + query log
    ├── components/
    │   └── Sidebar.tsx       # Navigation
    └── lib/
        └── api.ts            # Typed API client
```

---

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- A free [Groq API key](https://console.groq.com) (no credit card required)

### 1. Clone the repo

```bash
git clone https://github.com/sniiitik/DocMind-RAG-Intelligence-Platform.git
cd DocMind-RAG-Intelligence-Platform
```

### 2. Backend setup

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

pip install fastapi uvicorn python-multipart \
  langchain langchain-community langchain-huggingface \
  chromadb sentence-transformers \
  groq pypdf python-dotenv
```

Create your `.env` file:

```bash
echo "GROQ_API_KEY=your_key_here" > .env
```

Start the backend:

```bash
uvicorn main:app --reload
# API runs at http://localhost:8000
# Swagger docs at http://localhost:8000/docs
```

### 3. Frontend setup

```bash
cd ../frontend
npm install
npm run dev
# UI runs at http://localhost:3000
```

### 4. Use it

1. Go to **Documents** → upload a PDF
2. Go to **Chat** → ask a question about it
3. Go to **Evals** → see faithfulness and relevance scores

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/ingest` | Upload and index a document |
| `GET` | `/api/documents` | List all indexed documents |
| `DELETE` | `/api/documents/{name}` | Remove a document from the index |
| `POST` | `/api/query` | Ask a question, get answer + sources + context |
| `POST` | `/api/evaluate` | Score an answer for faithfulness + relevance |
| `GET` | `/api/eval-history` | Retrieve all past eval scores |

Full interactive docs available at `http://localhost:8000/docs` when the backend is running.

---

## Eval Metrics Explained

### Faithfulness
Measures whether the answer is grounded in the retrieved context — i.e., did the LLM stick to what was in the documents or did it hallucinate?

**Method:** Split the answer into sentences → embed each sentence → compute max cosine similarity against any retrieved chunk → average across sentences → calibrate to 0–100%.

**Limitation:** Paraphrasing lowers this score even when the answer is correct. A score below 50% warrants manual review but does not automatically indicate hallucination.

### Relevance
Measures whether the answer actually addresses the question asked.

**Method:** Embed the question and the full answer → compute cosine similarity → apply penalties for very short answers (<10 words) or "I don't know" style responses → calibrate to 0–100%.

**Interpretation:**
- 75%+ → answer is on-topic and complete
- 50–74% → answer is related but may be too broad or too narrow
- <50% → question likely didn't match well against available documents

---

## Known Limitations & Future Work

- **Faithfulness scoring** underestimates grounded answers that paraphrase. Solution: LLM-as-judge eval.
- **No re-ranking** — retrieved chunks are returned by cosine similarity only. A cross-encoder re-ranker would improve precision on ambiguous queries.
- **Single-user** — ChromaDB is not designed for concurrent writes. A multi-user deployment would need a proper vector database.
- **No streaming** — the LLM response arrives all at once. Streaming would significantly improve perceived latency.
- **PDF-only OCR** — scanned PDFs with no embedded text are not supported. Would require Tesseract or a vision model.

---

## License

MIT
