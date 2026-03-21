from pydantic import BaseModel
from typing import Optional


class ResumeScoreRequest(BaseModel):
    resume_text: str
    job_description: str
    job_title: Optional[str] = None
    required_experience: Optional[str] = None


class ResumeScoreResponse(BaseModel):
    overall_score: float
    match_percentage: float
    strengths: list[str]
    gaps: list[str]
    suggested_questions: list[str]
    reasoning: str


class InterviewAnalysisRequest(BaseModel):
    transcript: str
    job_title: str
    round_type: str = "TECHNICAL"


class InterviewAnalysisResponse(BaseModel):
    communication_score: float
    technical_score: float
    confidence_score: float
    key_observations: list[str]
    recommendation: str
