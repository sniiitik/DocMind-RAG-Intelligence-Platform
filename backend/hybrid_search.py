# backend/hybrid_search.py
import re
from rank_bm25 import BM25Okapi


def tokenize(text: str) -> list[str]:
    return re.findall(r"\b\w+\b", text.lower())


def reciprocal_rank_fusion(
    vector_results: list[dict],
    keyword_results: list[dict],
    k: int = 60,
) -> list[dict]:
    """
    Combines vector and keyword search rankings.
    Higher score = better.
    """
    fused = {}

    for rank, item in enumerate(vector_results):
        doc_id = item["id"]
        if doc_id not in fused:
            fused[doc_id] = {**item, "rrf_score": 0.0}

        fused[doc_id]["rrf_score"] += 1 / (k + rank + 1)

    for rank, item in enumerate(keyword_results):
        doc_id = item["id"]
        if doc_id not in fused:
            fused[doc_id] = {**item, "rrf_score": 0.0}

        fused[doc_id]["rrf_score"] += 1 / (k + rank + 1)

    return sorted(
        fused.values(),
        key=lambda item: item["rrf_score"],
        reverse=True,
    )


def bm25_search(
    question: str,
    documents: list[dict],
    top_k: int = 20,
) -> list[dict]:
    if not documents:
        return []

    tokenized_docs = [tokenize(item["text"]) for item in documents]
    tokenized_query = tokenize(question)

    bm25 = BM25Okapi(tokenized_docs)
    scores = bm25.get_scores(tokenized_query)

    results = []

    for item, score in zip(documents, scores):
        result = item.copy()
        result["keyword_score"] = float(score)
        results.append(result)

    return sorted(
        results,
        key=lambda item: item["keyword_score"],
        reverse=True,
    )[:top_k]