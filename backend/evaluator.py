import os, json, re, math
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

def cosine(a: list, b: list) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na  = math.sqrt(sum(x * x for x in a))
    nb  = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb + 1e-9)

def score_faithfulness(answer: str, contexts: list) -> float:
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
    calibrated = min(1.0, max(0.0, (raw - 0.25) / 0.5))
    return round(calibrated, 4)

def score_relevancy(question: str, answer: str) -> float:
    if not answer.strip():
        return 0.0
    emb = get_embedder()
    q_emb = emb.embed_query(question)
    a_emb = emb.embed_query(answer)
    raw = cosine(q_emb, a_emb)
    if len(answer.split()) < 10:
        raw *= 0.6
    no_info_phrases = ["don't have", "no information", "cannot find", "not in the context"]
    if any(p in answer.lower() for p in no_info_phrases):
        raw *= 0.5
    calibrated = min(1.0, max(0.0, (raw - 0.2) / 0.6))
    return round(calibrated, 4)

class EvalRequest(BaseModel):
    question: str
    answer: str
    contexts: list


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

@router.post("/evaluate")
def evaluate_answer(req: EvalRequest):
    faithfulness = score_faithfulness(req.answer, req.contexts)
    relevancy    = score_relevancy(req.question, req.answer)
    scores = {"faithfulness": faithfulness, "answer_relevancy": relevancy}
    logs = load_eval_logs()
    logs.append({"question": req.question, "scores": scores})
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
