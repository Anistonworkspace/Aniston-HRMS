from fastapi import APIRouter
from ..models.scoring_models import (
    ResumeScoreRequest, ResumeScoreResponse,
    InterviewAnalysisRequest, InterviewAnalysisResponse,
)
from ..services.deepseek_service import score_resume, analyze_interview

router = APIRouter(prefix="/scoring", tags=["Scoring"])


@router.post("/resume", response_model=dict)
async def score_resume_endpoint(request: ResumeScoreRequest):
    """Score a resume against a job description using DeepSeek AI."""
    result = await score_resume(request)
    return {"success": True, "data": result.model_dump()}


@router.post("/interview", response_model=dict)
async def analyze_interview_endpoint(request: InterviewAnalysisRequest):
    """Analyze an interview transcript using DeepSeek AI."""
    result = await analyze_interview(request)
    return {"success": True, "data": result.model_dump()}
