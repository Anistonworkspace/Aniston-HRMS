import httpx
from fastapi import HTTPException
from ..config import settings
from ..models.scoring_models import (
    ResumeScoreRequest, ResumeScoreResponse,
    InterviewAnalysisRequest, InterviewAnalysisResponse,
)


async def score_resume(request: ResumeScoreRequest) -> ResumeScoreResponse:
    """Use DeepSeek to score a resume against a job description."""

    prompt = f"""You are an expert HR recruiter. Analyze the following resume against the job description and provide a structured evaluation.

**Job Title:** {request.job_title or 'Not specified'}
**Required Experience:** {request.required_experience or 'Not specified'}

**Job Description:**
{request.job_description}

**Resume:**
{request.resume_text}

Respond in this exact JSON format:
{{
  "overall_score": <float 0-100>,
  "match_percentage": <float 0-100>,
  "strengths": ["strength1", "strength2", "strength3"],
  "gaps": ["gap1", "gap2"],
  "suggested_questions": ["question1", "question2", "question3"],
  "reasoning": "<2-3 sentence summary>"
}}"""

    if not settings.deepseek_api_key:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "AI_NOT_CONFIGURED",
                "message": "DeepSeek API key is not configured. Please set DEEPSEEK_API_KEY in the AI service environment.",
            },
        )

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{settings.deepseek_base_url}/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.deepseek_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "deepseek-chat",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
                "response_format": {"type": "json_object"},
            },
        )
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]

        import json
        result = json.loads(content)
        return ResumeScoreResponse(**result)


async def analyze_interview(request: InterviewAnalysisRequest) -> InterviewAnalysisResponse:
    """Use DeepSeek to analyze an interview transcript."""

    prompt = f"""You are an expert interview evaluator. Analyze the following interview transcript for a {request.job_title} position ({request.round_type} round).

**Transcript:**
{request.transcript}

Respond in this exact JSON format:
{{
  "communication_score": <float 1-10>,
  "technical_score": <float 1-10>,
  "confidence_score": <float 1-10>,
  "key_observations": ["observation1", "observation2", "observation3"],
  "recommendation": "STRONG_HIRE | HIRE | MAYBE | NO_HIRE"
}}"""

    if not settings.deepseek_api_key:
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "AI_NOT_CONFIGURED",
                "message": "DeepSeek API key is not configured. Please set DEEPSEEK_API_KEY in the AI service environment.",
            },
        )

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{settings.deepseek_base_url}/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.deepseek_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "deepseek-chat",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
                "response_format": {"type": "json_object"},
            },
        )
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]

        import json
        result = json.loads(content)
        return InterviewAnalysisResponse(**result)
