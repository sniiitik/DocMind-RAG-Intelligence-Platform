# backend/retriever.py
import math
import os
import re
from typing import Any, Dict, Optional

import chromadb
from dotenv import load_dotenv
from fastapi import APIRouter
from groq import Groq
from langchain_huggingface import HuggingFaceEmbeddings
from pydantic import BaseModel, Field

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
RERANK_CANDIDATES = 12
MEMORY_TURNS = 4

MODE_PROMPTS = {
    "qa": "Answer the question directly and concisely using the evidence.",
    "summary": "Write a structured summary with the most important points and supporting citations.",
    "compare": "Compare the relevant evidence across documents or sections. Use bullets or a compact table when helpful.",
    "risks": "Identify risks, concerns, or drawbacks from the evidence. Group similar risks together.",
    "action_items": "Extract action items, owners if available, and any deadlines mentioned in the evidence.",
    "timeline": "Extract dates, milestones, and sequence of events in chronological order.",
    "table_insights": "Focus on numeric or table-based evidence and explain the important takeaways clearly.",
}


class QueryRequest(BaseModel):
    question: str
    top_k: int = FINAL_CONTEXT_CHUNKS

    document_name: Optional[str] = None
    document_names: list[str] = Field(default_factory=list)
    page: Optional[int] = None
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    content_type: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    mode: Optional[str] = None
    session_id: Optional[str] = None
    conversation: list[dict[str, str]] = Field(default_factory=list)


def build_where_filter(request: QueryRequest):
    conditions = []

    if request.document_names:
        conditions.append(
            {
                "$or": [
                    {"document_name": {"$eq": document_name}}
                    for document_name in request.document_names
                ]
            }
        )
    elif request.document_name:
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


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb + 1e-9)


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


def tokenize(text: str) -> set[str]:
    return set(re.findall(r"\b\w+\b", text.lower()))


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


def detect_mode(request: QueryRequest) -> str:
    if request.mode and request.mode in MODE_PROMPTS:
        return request.mode

    q = request.question.lower()

    if any(word in q for word in ["compare", "difference", "versus", "vs "]):
        return "compare"
    if any(word in q for word in ["summarize", "summary", "main points", "overview"]):
        return "summary"
    if any(word in q for word in ["risk", "drawback", "concern", "issue"]):
        return "risks"
    if any(word in q for word in ["action item", "next step", "todo", "to-do", "follow up"]):
        return "action_items"
    if any(word in q for word in ["timeline", "chronology", "roadmap", "deadline", "milestone"]):
        return "timeline"
    if request.content_type == "table" or "table" in q:
        return "table_insights"
    return "qa"


def detect_intents(question: str, mode: str) -> list[str]:
    q = question.lower()
    intents = [mode]

    if any(word in q for word in ["compare", "difference", "similar", "contrast"]):
        intents.append("cross_document_reasoning")
    if any(word in q for word in ["summarize", "overview", "main point"]):
        intents.append("summarization")
    if any(word in q for word in ["risk", "concern", "issue", "limitation"]):
        intents.append("risk_extraction")
    if any(word in q for word in ["deadline", "date", "timeline", "milestone"]):
        intents.append("temporal_extraction")
    if "table" in q:
        intents.append("table_focus")

    return intents


def rerank_results(question: str, results: list[dict], mode: str) -> list[dict]:
    if not results:
        return []

    query_embedding = embeddings_model.embed_query(question)
    query_tokens = tokenize(question)

    for item in results:
        text = item["text"]
        metadata = item["metadata"]
        text_embedding = embeddings_model.embed_query(text)
        semantic_score = cosine(query_embedding, text_embedding)
        keyword_score = min(float(item.get("keyword_score") or 0) / 10, 1.0)
        section_tokens = tokenize(metadata.get("section_title") or "")
        overlap_score = len(query_tokens & (tokenize(text) | section_tokens)) / max(len(query_tokens), 1)

        structure_boost = 0.0
        if metadata.get("content_type") == "table" and mode == "table_insights":
            structure_boost += 0.15
        if metadata.get("structure_hint") == "section":
            structure_boost += 0.04
        if metadata.get("text_density") == "high":
            structure_boost += 0.02

        item["rerank_score"] = round(
            (semantic_score * 0.60) + (item.get("vector_score", 0) * 0.15) + (keyword_score * 0.10) + (overlap_score * 0.10) + structure_boost,
            4,
        )

    reranked = sorted(results, key=lambda item: item.get("rerank_score", 0), reverse=True)

    diversified = []
    seen_sources = set()

    for item in reranked:
        source_key = (
            item["metadata"].get("document_name"),
            item["metadata"].get("page"),
            item["metadata"].get("content_type"),
        )

        if source_key not in seen_sources or len(diversified) < FINAL_CONTEXT_CHUNKS:
            diversified.append(item)
            seen_sources.add(source_key)

        if len(diversified) >= RERANK_CANDIDATES:
            break

    return diversified


def hybrid_retrieve(request: QueryRequest, mode: str) -> list[dict]:
    if mode == "compare" and len(request.document_names) > 1:
        merged_results = []

        for document_name in request.document_names:
            scoped_request = request.model_copy(update={"document_name": document_name, "document_names": []})
            merged_results.extend(hybrid_retrieve(scoped_request, "qa"))

        deduped = {}
        for item in merged_results:
            deduped[item["id"]] = item

        reranked = rerank_results(request.question, list(deduped.values()), mode)
        return reranked[: max(request.top_k, len(request.document_names) * 2)]

    where_filter = build_where_filter(request)

    vector_results = vector_search(
        question=request.question,
        where_filter=where_filter,
        top_k=max(VECTOR_CANDIDATES, request.top_k, RERANK_CANDIDATES),
    )

    keyword_candidates = get_keyword_candidate_documents(where_filter)
    keyword_results = bm25_search(
        question=request.question,
        documents=keyword_candidates,
        top_k=max(KEYWORD_CANDIDATES, request.top_k, RERANK_CANDIDATES),
    )

    fused_results = reciprocal_rank_fusion(
        vector_results=vector_results,
        keyword_results=keyword_results,
    )

    reranked = rerank_results(request.question, fused_results[:RERANK_CANDIDATES], mode)
    return reranked[: request.top_k]


def build_context_block(retrieved: list[dict]) -> tuple[str, list[dict]]:
    context_entries = []
    prompt_blocks = []

    for idx, item in enumerate(retrieved, start=1):
        metadata = item["metadata"]
        label = format_source_label(metadata)
        citation_id = f"S{idx}"
        context_entries.append(
            {
                "citation_id": citation_id,
                "label": label,
                "text": item["text"],
                "metadata": metadata,
            }
        )
        prompt_blocks.append(f"[{citation_id}] {label}\n{item['text']}")

    return "\n\n".join(prompt_blocks), context_entries


def build_memory_block(conversation: list[dict[str, str]]) -> str:
    if not conversation:
        return "No prior conversation."

    recent_turns = conversation[-MEMORY_TURNS:]
    lines = []

    for item in recent_turns:
        role = item.get("role", "user").capitalize()
        content = (item.get("content") or "").strip()
        if content:
            lines.append(f"{role}: {content}")

    return "\n".join(lines) if lines else "No prior conversation."


def build_prompt(question: str, mode: str, context: str, memory: str) -> str:
    mode_instruction = MODE_PROMPTS.get(mode, MODE_PROMPTS["qa"])
    compare_instruction = ""
    if mode == "compare":
        compare_instruction = "- Organize the answer into similarities and differences, and call out which document each point comes from.\n"

    return f"""You are DocMind, a document-grounded intelligence assistant.

Follow these rules:
- Use ONLY the provided evidence and prior conversation context.
- If the evidence is insufficient, say so clearly.
- Cite support inline using citation IDs like [S1], [S2].
- Prefer combining multiple citations when the answer requires synthesis.
- If multiple documents are involved, preserve document boundaries before synthesizing.
- If information conflicts, say that explicitly.
- Prefer concise, scan-friendly structure over long prose.
- When helpful, use bullet points or compact markdown tables.
- {mode_instruction}
{compare_instruction}

Recent conversation:
{memory}

Evidence:
{context}

User request:
{question}

Answer:"""


def build_traceability(answer: str, retrieved: list[dict]) -> list[dict]:
    sentences = [segment.strip() for segment in re.split(r"(?<=[.!?])\s+", answer) if segment.strip()]
    if not sentences or not retrieved:
        return []

    sentence_embeddings = embeddings_model.embed_documents(sentences)
    context_embeddings = embeddings_model.embed_documents([item["text"] for item in retrieved])

    traces = []

    for sentence, sentence_embedding in zip(sentences, sentence_embeddings):
        ranked_support = []

        for item, context_embedding in zip(retrieved, context_embeddings):
            similarity = cosine(sentence_embedding, context_embedding)
            ranked_support.append(
                {
                    "citation_id": item.get("citation_id"),
                    "source_label": item.get("source_label"),
                    "page": item.get("page"),
                    "score": round(similarity, 4),
                }
            )

        ranked_support.sort(key=lambda support: support["score"], reverse=True)
        traces.append(
            {
                "sentence": sentence,
                "supports": ranked_support[:2],
            }
        )

    return traces


@router.post("/query")
def query(request: QueryRequest):
    mode = detect_mode(request)
    intents = detect_intents(request.question, mode)

    if mode == "table_insights" and not request.content_type:
        request.content_type = "table"

    retrieved = hybrid_retrieve(request, mode)

    if not retrieved:
        return {
            "answer": "No relevant documents found for the selected filters.",
            "sources": [],
            "context": [],
            "filters_applied": build_where_filter(request),
            "retrieval_mode": "hybrid+rereank",
            "mode": mode,
            "intents": intents,
            "traceability": [],
        }

    context, context_entries = build_context_block(retrieved)
    memory = build_memory_block(request.conversation)
    prompt = build_prompt(request.question, mode, context, memory)

    response = groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {
                "role": "system",
                "content": "You answer using retrieved evidence, synthesize across chunks when needed, and keep citations explicit.",
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

    enriched_context_items = []

    for item, context_entry in zip(retrieved, context_entries):
        metadata = item["metadata"]
        label = format_source_label(metadata)

        if label not in source_labels:
            source_labels.append(label)

        context_item = {
            "citation_id": context_entry["citation_id"],
            "text": item["text"],
            "source": metadata.get("source") or metadata.get("document_name"),
            "document_name": metadata.get("document_name"),
            "page": metadata.get("page"),
            "content_type": metadata.get("content_type"),
            "source_label": label,
            "section_title": metadata.get("section_title"),
            "structure_hint": metadata.get("structure_hint"),
            "distance": item.get("distance"),
            "vector_score": item.get("vector_score"),
            "keyword_score": item.get("keyword_score"),
            "rrf_score": item.get("rrf_score"),
            "rerank_score": item.get("rerank_score"),
        }
        context_items.append(context_item)
        enriched_context_items.append(context_item)

    traceability = build_traceability(answer, enriched_context_items)

    return {
        "answer": answer,
        "sources": source_labels,
        "context": context_items,
        "filters_applied": build_where_filter(request),
        "retrieval_mode": "hybrid+rerank",
        "mode": mode,
        "intents": intents,
        "memory_used": bool(request.conversation),
        "traceability": traceability,
        "compare_documents": request.document_names or ([request.document_name] if request.document_name else []),
    }
