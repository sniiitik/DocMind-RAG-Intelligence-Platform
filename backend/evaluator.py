import os, json, re, math
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from langchain_huggingface import HuggingFaceEmbeddings

router = APIRouter()
EVAL_LOG = "eval_log.json"

_embedder = None
def get_embedder():
    global _embedder
    if _embedder is None:
        _embedder = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    return _embedder


MODE_PROFILES = {
    "qa": {
        "faithfulness_offset": 0.25,
        "faithfulness_scale": 0.50,
        "relevancy_offset": 0.20,
        "relevancy_scale": 0.60,
        "citation_threshold": 0.55,
        "min_answer_words": 10,
        "recall_offset": 0.20,
        "recall_scale": 0.60,
        "coverage_bonus": 0.00,
    },
    "summary": {
        "faithfulness_offset": 0.20,
        "faithfulness_scale": 0.55,
        "relevancy_offset": 0.12,
        "relevancy_scale": 0.68,
        "citation_threshold": 0.48,
        "min_answer_words": 20,
        "recall_offset": 0.12,
        "recall_scale": 0.70,
        "coverage_bonus": 0.08,
    },
    "compare": {
        "faithfulness_offset": 0.18,
        "faithfulness_scale": 0.58,
        "relevancy_offset": 0.10,
        "relevancy_scale": 0.70,
        "citation_threshold": 0.45,
        "min_answer_words": 18,
        "recall_offset": 0.10,
        "recall_scale": 0.72,
        "coverage_bonus": 0.10,
    },
    "risks": {
        "faithfulness_offset": 0.20,
        "faithfulness_scale": 0.55,
        "relevancy_offset": 0.14,
        "relevancy_scale": 0.66,
        "citation_threshold": 0.48,
        "min_answer_words": 14,
        "recall_offset": 0.14,
        "recall_scale": 0.68,
        "coverage_bonus": 0.06,
    },
    "action_items": {
        "faithfulness_offset": 0.20,
        "faithfulness_scale": 0.55,
        "relevancy_offset": 0.12,
        "relevancy_scale": 0.68,
        "citation_threshold": 0.48,
        "min_answer_words": 12,
        "recall_offset": 0.14,
        "recall_scale": 0.68,
        "coverage_bonus": 0.06,
    },
    "timeline": {
        "faithfulness_offset": 0.18,
        "faithfulness_scale": 0.58,
        "relevancy_offset": 0.12,
        "relevancy_scale": 0.68,
        "citation_threshold": 0.48,
        "min_answer_words": 12,
        "recall_offset": 0.12,
        "recall_scale": 0.70,
        "coverage_bonus": 0.08,
    },
    "table_insights": {
        "faithfulness_offset": 0.18,
        "faithfulness_scale": 0.58,
        "relevancy_offset": 0.14,
        "relevancy_scale": 0.66,
        "citation_threshold": 0.48,
        "min_answer_words": 12,
        "recall_offset": 0.12,
        "recall_scale": 0.70,
        "coverage_bonus": 0.08,
    },
}

def cosine(a: list, b: list) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na  = math.sqrt(sum(x * x for x in a))
    nb  = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb + 1e-9)


def mode_profile(mode: str | None) -> dict:
    return MODE_PROFILES.get(mode or "qa", MODE_PROFILES["qa"])


def calibrate(raw: float, offset: float, scale: float, bonus: float = 0.0) -> float:
    calibrated = min(1.0, max(0.0, ((raw - offset) / scale) + bonus))
    return round(calibrated, 4)


def score_faithfulness(answer: str, contexts: list, mode: str | None = None) -> float:
    sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', answer) if len(s.strip()) > 20]
    if not sentences or not contexts:
        return 0.5
    emb = get_embedder()
    ctx_embeddings = emb.embed_documents(contexts)
    scores = []
    for sent in sentences:
        sent_emb = emb.embed_query(sent)
        best = max(cosine(sent_emb, ce) for ce in ctx_embeddings)
        scores.append(best)
    raw = sum(scores) / len(scores)
    profile = mode_profile(mode)
    return calibrate(raw, profile["faithfulness_offset"], profile["faithfulness_scale"], profile["coverage_bonus"])


def score_relevancy(question: str, answer: str, mode: str | None = None) -> float:
    if not answer.strip():
        return 0.0
    emb = get_embedder()
    q_emb = emb.embed_query(question)
    a_emb = emb.embed_query(answer)
    raw = cosine(q_emb, a_emb)
    profile = mode_profile(mode)
    if len(answer.split()) < profile["min_answer_words"]:
        raw *= 0.6
    no_info_phrases = ["don't have", "no information", "cannot find", "not in the context"]
    if any(p in answer.lower() for p in no_info_phrases):
        raw *= 0.5
    return calibrate(raw, profile["relevancy_offset"], profile["relevancy_scale"])

class EvalRequest(BaseModel):
    question: str
    answer: str
    contexts: list
    mode: str | None = None
    traceability: list = []
    retrieval_mode: str | None = None


def load_eval_logs() -> list:
    if not os.path.exists(EVAL_LOG):
        return []

    with open(EVAL_LOG) as f:
        try:
            return json.load(f)
        except Exception:
            return []


def save_eval_logs(logs: list) -> None:
    with open(EVAL_LOG, "w") as f:
        json.dump(logs, f)


def score_groundedness(answer: str, contexts: list, mode: str | None = None) -> float:
    return score_faithfulness(answer, contexts, mode)


def score_citation_precision(traceability: list, mode: str | None = None) -> float:
    if not traceability:
        return 0.0
    profile = mode_profile(mode)

    supported = 0

    for trace in traceability:
        supports = trace.get("supports") or []
        if supports and supports[0].get("score", 0) >= profile["citation_threshold"]:
            supported += 1

    return round(supported / max(len(traceability), 1), 4)


def score_answer_completeness(question: str, answer: str, contexts: list, mode: str | None = None) -> float:
    if not answer.strip() or not contexts:
        return 0.0

    emb = get_embedder()
    question_emb = emb.embed_query(question)
    answer_emb = emb.embed_query(answer)
    context_embs = emb.embed_documents(contexts[:5])

    question_alignment = cosine(question_emb, answer_emb)
    evidence_coverage = max((cosine(answer_emb, ctx_emb) for ctx_emb in context_embs), default=0.0)
    profile = mode_profile(mode)
    if (mode or "qa") in {"summary", "compare"}:
        evidence_coverage = min(1.0, evidence_coverage + 0.08)
    raw = (question_alignment * 0.55) + (evidence_coverage * 0.45)
    return calibrate(raw, profile["relevancy_offset"], profile["relevancy_scale"], profile["coverage_bonus"])


def score_retrieval_recall(question: str, contexts: list, mode: str | None = None) -> float:
    if not contexts:
        return 0.0

    emb = get_embedder()
    question_emb = emb.embed_query(question)
    context_embs = emb.embed_documents(contexts[:8])
    similarities = [cosine(question_emb, ctx_emb) for ctx_emb in context_embs]
    raw = sum(similarities) / len(similarities)
    profile = mode_profile(mode)
    if (mode or "qa") in {"summary", "compare"}:
        top_k = sorted(similarities, reverse=True)[: min(3, len(similarities))]
        raw = max(raw, (sum(top_k) / len(top_k)) if top_k else raw)
    return calibrate(raw, profile["recall_offset"], profile["recall_scale"], profile["coverage_bonus"])

@router.post("/evaluate")
def evaluate_answer(req: EvalRequest):
    faithfulness = score_faithfulness(req.answer, req.contexts, req.mode)
    relevancy    = score_relevancy(req.question, req.answer, req.mode)
    groundedness = score_groundedness(req.answer, req.contexts, req.mode)
    citation_precision = score_citation_precision(req.traceability, req.mode)
    answer_completeness = score_answer_completeness(req.question, req.answer, req.contexts, req.mode)
    retrieval_recall = score_retrieval_recall(req.question, req.contexts, req.mode)
    scores = {
        "faithfulness": faithfulness,
        "answer_relevancy": relevancy,
        "groundedness": groundedness,
        "citation_precision": citation_precision,
        "answer_completeness": answer_completeness,
        "retrieval_recall": retrieval_recall,
    }
    logs = load_eval_logs()
    logs.append({
        "question": req.question,
        "scores": scores,
        "mode": req.mode or "qa",
        "retrieval_mode": req.retrieval_mode or "hybrid+rerank",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    save_eval_logs(logs)
    return {"scores": scores}

@router.get("/eval-history")
def eval_history():
    return {"history": load_eval_logs()}


@router.delete("/eval-history")
def clear_eval_history():
    try:
        cleared_entries = len(load_eval_logs())
        save_eval_logs([])
        return {
            "message": "Eval history cleared",
            "cleared_entries": cleared_entries,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
