# backend/retriever.py
import os
from typing import Any, Dict, Optional

import chromadb
from dotenv import load_dotenv
from fastapi import APIRouter
from groq import Groq
from langchain_huggingface import HuggingFaceEmbeddings
from pydantic import BaseModel

from hybrid_search import bm25_search, reciprocal_rank_fusion


load_dotenv()
router = APIRouter()

embeddings_model = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection("documents")
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

VECTOR_CANDIDATES = 30
KEYWORD_CANDIDATES = 30
FINAL_CONTEXT_CHUNKS = 5


class QueryRequest(BaseModel):
    question: str
    top_k: int = FINAL_CONTEXT_CHUNKS

    document_name: Optional[str] = None
    page: Optional[int] = None
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    content_type: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


def build_where_filter(request: QueryRequest):
    conditions = []

    if request.document_name:
        conditions.append({"document_name": {"$eq": request.document_name}})

    if request.page is not None:
        conditions.append({"page": {"$eq": request.page}})

    if request.page_start is not None:
        conditions.append({"page": {"$gte": request.page_start}})

    if request.page_end is not None:
        conditions.append({"page": {"$lte": request.page_end}})

    if request.content_type:
        conditions.append({"content_type": {"$eq": request.content_type}})

    if request.metadata:
        for key, value in request.metadata.items():
            conditions.append({key: {"$eq": value}})

    if not conditions:
        return None

    if len(conditions) == 1:
        return conditions[0]

    return {"$and": conditions}


def format_source_label(metadata: dict) -> str:
    if metadata.get("source_label"):
        return metadata["source_label"]

    source = metadata.get("source") or metadata.get("document_name") or "unknown"
    page = metadata.get("page")

    if page:
        return f"{source}, page {page}"

    return source


def flatten_vector_results(results) -> list[dict]:
    ids = results.get("ids", [[]])[0]
    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]

    flattened = []

    for doc_id, text, metadata, distance in zip(ids, documents, metadatas, distances):
        flattened.append(
            {
                "id": doc_id,
                "text": text,
                "metadata": metadata or {},
                "distance": distance,
                "vector_score": 1 - distance if distance is not None else 0,
            }
        )

    return flattened


def get_keyword_candidate_documents(where_filter=None) -> list[dict]:
    get_kwargs = {
        "include": ["documents", "metadatas"],
    }

    if where_filter:
        get_kwargs["where"] = where_filter

    results = collection.get(**get_kwargs)

    ids = results.get("ids", [])
    documents = results.get("documents", [])
    metadatas = results.get("metadatas", [])

    candidates = []

    for doc_id, text, metadata in zip(ids, documents, metadatas):
        candidates.append(
            {
                "id": doc_id,
                "text": text,
                "metadata": metadata or {},
            }
        )

    return candidates


def vector_search(question: str, where_filter=None, top_k: int = VECTOR_CANDIDATES) -> list[dict]:
    query_embedding = embeddings_model.embed_query(question)

    query_kwargs = {
        "query_embeddings": [query_embedding],
        "n_results": top_k,
        "include": ["documents", "metadatas", "distances"],
    }

    if where_filter:
        query_kwargs["where"] = where_filter

    results = collection.query(**query_kwargs)
    return flatten_vector_results(results)


def hybrid_retrieve(request: QueryRequest) -> list[dict]:
    where_filter = build_where_filter(request)

    vector_results = vector_search(
        question=request.question,
        where_filter=where_filter,
        top_k=max(VECTOR_CANDIDATES, request.top_k),
    )

    keyword_candidates = get_keyword_candidate_documents(where_filter)
    keyword_results = bm25_search(
        question=request.question,
        documents=keyword_candidates,
        top_k=max(KEYWORD_CANDIDATES, request.top_k),
    )

    fused_results = reciprocal_rank_fusion(
        vector_results=vector_results,
        keyword_results=keyword_results,
    )

    return fused_results[: request.top_k]


@router.post("/query")
def query(request: QueryRequest):
    retrieved = hybrid_retrieve(request)

    if not retrieved:
        return {
            "answer": "No relevant documents found for the selected filters.",
            "sources": [],
            "context": [],
            "filters_applied": build_where_filter(request),
            "retrieval_mode": "hybrid",
        }

    context = "\n\n".join(
        [
            f"[Source: {format_source_label(item['metadata'])}]\n{item['text']}"
            for item in retrieved
        ]
    )

    prompt = f"""You are DocMind, a document-grounded assistant.

Answer the question using ONLY the context below.
If the answer is not in the context, say "I don't have enough information to answer this."
Always cite the source/page/table labels from the context.

Context:
{context}

Question: {request.question}

Answer:"""

    response = groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {
                "role": "system",
                "content": "You answer questions using only retrieved document context and cite sources clearly.",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        temperature=0.2,
    )

    answer = response.choices[0].message.content

    source_labels = []
    context_items = []

    for item in retrieved:
        metadata = item["metadata"]
        label = format_source_label(metadata)

        if label not in source_labels:
            source_labels.append(label)

        context_items.append(
            {
                "text": item["text"],
                "source": metadata.get("source") or metadata.get("document_name"),
                "document_name": metadata.get("document_name"),
                "page": metadata.get("page"),
                "content_type": metadata.get("content_type"),
                "source_label": label,
                "distance": item.get("distance"),
                "vector_score": item.get("vector_score"),
                "keyword_score": item.get("keyword_score"),
                "rrf_score": item.get("rrf_score"),
            }
        )

    return {
        "answer": answer,
        "sources": source_labels,
        "context": context_items,
        "filters_applied": build_where_filter(request),
        "retrieval_mode": "hybrid",
    }