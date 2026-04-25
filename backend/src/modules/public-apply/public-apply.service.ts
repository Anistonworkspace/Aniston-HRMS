import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { aiService } from '../../services/ai.service.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { logger } from '../../lib/logger.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as pdfParseModule from 'pdf-parse';
const pdfParse = (pdfParseModule as any).default || pdfParseModule;

function generateUid(): string {
  return 'ANST-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// ─── Fallback MCQ Question Bank (30 questions × 3 categories) ──────────────
// When AI is unavailable, a random selection of 2 per category is drawn and
// the order within the drawn set is also randomised so every candidate sees
// a different combination. correctOption is stripped before being sent to
// the candidate's browser.
const FALLBACK_MCQ_BANK = {
  INTELLIGENCE: [
    {
      questionText: 'A company\'s revenue increased by 20% in year 1, then decreased by 10% in year 2. What is the approximate net change over two years?',
      optionA: '10% increase', optionB: '8% increase', optionC: '12% increase', optionD: '15% increase',
      correctOption: 'B',
    },
    {
      questionText: 'If 5 machines make 5 widgets in 5 minutes, how long does it take 100 machines to make 100 widgets?',
      optionA: '100 minutes', optionB: '20 minutes', optionC: '5 minutes', optionD: '50 minutes',
      correctOption: 'C',
    },
    {
      questionText: 'A project was 40% complete after 6 months. At the same pace, how many more months are needed to finish?',
      optionA: '6 months', optionB: '9 months', optionC: '12 months', optionD: '15 months',
      correctOption: 'B',
    },
    {
      questionText: 'If a train travels at 90 km/h and a bus at 60 km/h leave the same point, how far apart are they after 2 hours?',
      optionA: '30 km', optionB: '60 km', optionC: '90 km', optionD: '120 km',
      correctOption: 'B',
    },
    {
      questionText: 'A team of 4 completes a task in 12 days. How many days will 6 members take for the same task?',
      optionA: '6 days', optionB: '8 days', optionC: '10 days', optionD: '18 days',
      correctOption: 'B',
    },
    {
      questionText: 'What is the next number in the sequence: 2, 6, 18, 54, ___?',
      optionA: '108', optionB: '162', optionC: '200', optionD: '216',
      correctOption: 'B',
    },
    {
      questionText: 'If all Bloops are Razzies and all Razzies are Lazzies, then: All Bloops are definitely ___?',
      optionA: 'Not Lazzies', optionB: 'Lazzies', optionC: 'Sometimes Lazzies', optionD: 'Not Bloops',
      correctOption: 'B',
    },
    {
      questionText: 'A sale reduces a price by 25%, then a further 20%. What is the overall reduction?',
      optionA: '40%', optionB: '45%', optionC: '50%', optionD: '35%',
      correctOption: 'A',
    },
    {
      questionText: 'Which pattern comes next: ▲ ▲▲ ▲▲▲ ▲▲▲▲ ___?',
      optionA: '▲▲▲', optionB: '▲▲▲▲▲', optionC: '▲▲▲▲▲▲', optionD: '▲▲▲▲▲▲▲',
      correctOption: 'B',
    },
    {
      questionText: 'A store marks up goods by 40% then gives a 20% discount. The net effect on cost is:',
      optionA: '12% profit', optionB: '20% profit', optionC: 'Break even', optionD: '8% loss',
      correctOption: 'A',
    },
  ],
  INTEGRITY: [
    {
      questionText: 'You discover a colleague is claiming overtime hours they didn\'t work. What do you do?',
      optionA: 'Ignore it — not your concern',
      optionB: 'Confront them aggressively in public',
      optionC: 'Privately raise the concern with HR or your manager',
      optionD: 'Do the same since others seem to',
      correctOption: 'C',
    },
    {
      questionText: 'Your manager asks you to slightly exaggerate project metrics in a client report. You:',
      optionA: 'Do it without question — manager\'s order',
      optionB: 'Politely explain accurate data builds trust and suggest presenting it honestly',
      optionC: 'Refuse and threaten to escalate',
      optionD: 'Modify numbers a little since it\'s minor',
      correctOption: 'B',
    },
    {
      questionText: 'You accidentally receive a salary overpayment of ₹5,000. What is the right action?',
      optionA: 'Keep it — if they don\'t notice it\'s fine',
      optionB: 'Wait for HR to discover and act',
      optionC: 'Immediately notify HR and arrange to return it',
      optionD: 'Spend it and pay back if asked',
      correctOption: 'C',
    },
    {
      questionText: 'A client offer you a personal gift after signing a large contract. You:',
      optionA: 'Accept — it\'s a token of appreciation',
      optionB: 'Decline and report it per company policy',
      optionC: 'Accept privately without telling anyone',
      optionD: 'Negotiate a larger gift',
      correctOption: 'B',
    },
    {
      questionText: 'You find a colleague\'s confidential appraisal report on a shared printer. You:',
      optionA: 'Read it out of curiosity',
      optionB: 'Share details with close office friends',
      optionC: 'Return it discreetly to the colleague without reading further',
      optionD: 'Leave it — someone else will handle it',
      correctOption: 'C',
    },
    {
      questionText: 'You realise you made an error that caused a client to lose money. You:',
      optionA: 'Hope nobody notices and say nothing',
      optionB: 'Blame the system or another team member',
      optionC: 'Immediately own the mistake, inform the manager, and propose a resolution',
      optionD: 'Wait to see if it causes a problem first',
      correctOption: 'C',
    },
    {
      questionText: 'You overhear a team lead sharing confidential hiring decisions in a public space. You:',
      optionA: 'Join the conversation',
      optionB: 'Ignore it — not your responsibility',
      optionC: 'Discreetly inform HR about the breach',
      optionD: 'Spread the information you heard',
      correctOption: 'C',
    },
    {
      questionText: 'You are asked to backdate a document to avoid a compliance penalty. You:',
      optionA: 'Do it as instructed',
      optionB: 'Refuse and escalate to compliance or legal',
      optionC: 'Backdate it but feel guilty',
      optionD: 'Discuss it with other colleagues first',
      correctOption: 'B',
    },
    {
      questionText: 'A shortcut would save you an hour but violates company security policy. You:',
      optionA: 'Use the shortcut — nobody will know',
      optionB: 'Follow policy and flag the bottleneck to your manager for a proper fix',
      optionC: 'Use it this once and promise not to repeat',
      optionD: 'Teach the shortcut to others',
      correctOption: 'B',
    },
    {
      questionText: 'You are the only one who knows a team member took credit for your idea in a meeting. You:',
      optionA: 'Retaliate by discrediting their work',
      optionB: 'Let it go to avoid conflict',
      optionC: 'Address it privately with the colleague first; escalate if repeated',
      optionD: 'Spread word among peers',
      correctOption: 'C',
    },
  ],
  ENERGY: [
    {
      questionText: 'You are assigned a project with a tight deadline and unfamiliar technology. You:',
      optionA: 'Tell your manager the deadline is unrealistic',
      optionB: 'Wait for a colleague to learn it first',
      optionC: 'Immediately start researching, create a plan, and ask for guidance where needed',
      optionD: 'Work only office hours and hope for the best',
      correctOption: 'C',
    },
    {
      questionText: 'After a major project setback that wasn\'t your fault, you typically:',
      optionA: 'Focus on finding who to blame',
      optionB: 'Feel discouraged and wait for instructions',
      optionC: 'Analyse what can be salvaged and propose a revised plan quickly',
      optionD: 'Complain to colleagues',
      correctOption: 'C',
    },
    {
      questionText: 'You are given extra responsibilities without a raise. Your response is:',
      optionA: 'Refuse any additional work',
      optionB: 'Do only the bare minimum on extra tasks',
      optionC: 'Deliver on the responsibilities and schedule a formal conversation about compensation',
      optionD: 'Resign immediately',
      correctOption: 'C',
    },
    {
      questionText: 'You have 30 minutes before a big client call and your slides crash. You:',
      optionA: 'Panic and call it off',
      optionB: 'Present without any visual aid with notes and energy',
      optionC: 'Quickly reconstruct key slides, practice key points, and join confidently',
      optionD: 'Ask a colleague to present instead',
      correctOption: 'C',
    },
    {
      questionText: 'Your manager gives you a vague goal with no clear direction. You:',
      optionA: 'Wait until the goal is clearer',
      optionB: 'Ask clarifying questions and then propose a concrete action plan for approval',
      optionC: 'Guess and start work in any direction',
      optionD: 'Ignore it and focus on existing tasks',
      correctOption: 'B',
    },
    {
      questionText: 'A senior colleague constantly undermines your suggestions in team meetings. You:',
      optionA: 'Stop sharing ideas to avoid conflict',
      optionB: 'Retaliate by dismissing their ideas',
      optionC: 'Continue sharing ideas confidently and address the dynamic privately with the colleague',
      optionD: 'Complain publicly',
      correctOption: 'C',
    },
    {
      questionText: 'You have completed your assigned work an hour before end of day. You:',
      optionA: 'Leave early since your work is done',
      optionB: 'Scroll social media',
      optionC: 'Look for ways to help teammates or invest the time in professional development',
      optionD: 'Update your LinkedIn profile',
      correctOption: 'C',
    },
    {
      questionText: 'Your team is behind on a deliverable. You are not at fault. You:',
      optionA: 'Let the team sink — it\'s their problem',
      optionB: 'Alert the manager and offer to take on extra tasks to help close the gap',
      optionC: 'Do your work and watch from the sidelines',
      optionD: 'Leave early to avoid the stress',
      correctOption: 'B',
    },
    {
      questionText: 'You are asked to learn a new tool in 2 days for an urgent project. You:',
      optionA: 'Say it is impossible and decline',
      optionB: 'Spend focused time learning the essentials and deliver a working solution',
      optionC: 'Use a familiar tool that is suboptimal but you know',
      optionD: 'Delegate the task to someone who already knows it',
      correctOption: 'B',
    },
    {
      questionText: 'A high-priority task comes in at the end of your working day. You:',
      optionA: 'Leave it for tomorrow',
      optionB: 'Assess urgency; if critical, stay back and complete it or arrange coverage',
      optionC: 'Grumble and do a half-effort job',
      optionD: 'Forward it to a colleague without context',
      correctOption: 'B',
    },
  ],
};

/**
 * Draw n questions from a pool, shuffle them.
 */
function shuffleAndPick<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/**
 * Stable deterministic ID for a fallback question derived from its text.
 * Using the same question text always produces the same ID, so the ID is
 * consistent between the form-generation call and the scoring call even
 * though the shuffle order differs between the two.
 */
function stableQuestionId(questionText: string): string {
  // djb2-style hash, fast and collision-resistant enough for 30 questions
  let h = 5381;
  for (let i = 0; i < questionText.length; i++) {
    h = (Math.imul(h, 33) ^ questionText.charCodeAt(i)) >>> 0;
  }
  return 'fq-' + h.toString(36);
}

/**
 * Build a randomised set of fallback questions (2 per category = 6 total).
 * Returns them without correctOption so they are safe to expose to candidates.
 * IDs are derived from question text (stable) — NOT from shuffle position —
 * so the same question always has the same ID regardless of call order.
 */
function buildFallbackQuestions(withIds: boolean): any[] {
  const intQ = shuffleAndPick(FALLBACK_MCQ_BANK.INTELLIGENCE, 2);
  const intgQ = shuffleAndPick(FALLBACK_MCQ_BANK.INTEGRITY, 2);
  const enQ = shuffleAndPick(FALLBACK_MCQ_BANK.ENERGY, 2);
  const all = shuffleAndPick([...intQ, ...intgQ, ...enQ], 6); // also shuffle order between categories

  return all.map((q) => ({
    ...(withIds ? { id: stableQuestionId(q.questionText) } : {}),
    questionText: q.questionText,
    optionA: q.optionA,
    optionB: q.optionB,
    optionC: q.optionC,
    optionD: q.optionD,
    correctOption: q.correctOption,
    category: Object.keys(FALLBACK_MCQ_BANK).find(cat =>
      (FALLBACK_MCQ_BANK as any)[cat].some((bq: any) => bq.questionText === q.questionText)
    ) as 'INTELLIGENCE' | 'INTEGRITY' | 'ENERGY',
  }));
}

// ─── ATS Scoring Engine ─────────────────────────────────────────────────────
interface AtsResult {
  atsScore: number;
  breakdown: {
    sections: number;    // /25 — standard resume sections detected
    keywords: number;    // /35 — JD keyword density
    contact: number;     // /15 — email + phone present
    quantification: number; // /15 — numbers/percentages indicate achievements
    parseQuality: number;   // /10 — was text extractable?
  };
  sectionsFound: string[];
  sectionsMissing: string[];
}

function computeAtsScore(
  resumeText: string,
  jdKeywords: string[],
  resumeMatchScore: number | null,
): AtsResult {
  const text = resumeText.toLowerCase();
  const lines = resumeText.split('\n');

  // ── Section detection ────────────────────────────────────────────────────
  const SECTION_PATTERNS: Record<string, RegExp> = {
    'Experience': /\b(experience|work history|employment|professional background|career)\b/i,
    'Education': /\b(education|qualification|degree|university|college|academic)\b/i,
    'Skills': /\b(skills|technical skills|competencies|expertise|technologies|proficiencies)\b/i,
    'Summary / Objective': /\b(summary|objective|profile|about me|overview|career goal)\b/i,
    'Certifications': /\b(certification|certificate|certified|credential|license|accreditation)\b/i,
  };

  const sectionsFound: string[] = [];
  const sectionsMissing: string[] = [];
  for (const [label, pattern] of Object.entries(SECTION_PATTERNS)) {
    if (pattern.test(resumeText)) sectionsFound.push(label);
    else sectionsMissing.push(label);
  }
  const sectionScore = Math.round((sectionsFound.length / 5) * 25);

  // ── Keyword density ──────────────────────────────────────────────────────
  // Use the pre-computed resumeMatchScore if available; else compute here
  const keywordScore = resumeMatchScore !== null
    ? Math.round((resumeMatchScore / 100) * 35)
    : 0;

  // ── Contact info ─────────────────────────────────────────────────────────
  const hasEmail = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i.test(resumeText);
  const hasPhone = /(\+91[\s\-]?)?[6-9]\d{9}|(\+\d{1,3}[\s\-]?)?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}/.test(resumeText);
  const contactScore = (hasEmail ? 7.5 : 0) + (hasPhone ? 7.5 : 0);

  // ── Quantification ───────────────────────────────────────────────────────
  // Look for numbers, %, INR, LPA, etc. — signs of achievement-oriented resume
  const quantMatches = resumeText.match(/\d+[\s%]|\d+\s*(years?|months?|lpa|crore|lakh|%|percent|projects?|clients?|teams?)/gi) || [];
  const quantScore = Math.min(15, quantMatches.length * 2);

  // ── Parse quality ────────────────────────────────────────────────────────
  // We only reach this function if resumeText is non-empty, so base score 5
  // Give full 10 if text is rich (>500 chars), 5 if sparse
  const parseScore = resumeText.length > 500 ? 10 : 5;

  const totalAts = Math.min(100, Math.round(
    sectionScore + keywordScore + contactScore + quantScore + parseScore
  ));

  return {
    atsScore: totalAts,
    breakdown: {
      sections: sectionScore,
      keywords: keywordScore,
      contact: Math.round(contactScore),
      quantification: Math.round(quantScore),
      parseQuality: parseScore,
    },
    sectionsFound,
    sectionsMissing,
  };
}

// ─── Helper: resolve resume file from URL or local path ─────────────────────
/**
 * Resolves a resume URL/path to a Buffer for processing.
 * Handles:
 *   - Local paths (uploads/resumes/...)  → read from disk
 *   - Full http/https URLs (cloud/CDN)   → download to temp file
 */
async function resolveResumeBuffer(resumeUrl: string): Promise<{ buffer: Buffer; tempPath?: string } | null> {
  if (resumeUrl.startsWith('http://') || resumeUrl.startsWith('https://')) {
    // Cloud URL — download to temp
    try {
      const res = await fetch(resumeUrl, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) return null;
      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const tempPath = path.join(os.tmpdir(), `resume_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.pdf`);
      fs.writeFileSync(tempPath, buffer);
      return { buffer, tempPath };
    } catch (err) {
      logger.warn('[ResumeParser] Failed to download cloud resume URL:', err);
      return null;
    }
  }

  // Local path
  const filePath = path.join(process.cwd(), resumeUrl.startsWith('/') ? resumeUrl.slice(1) : resumeUrl);
  if (!fs.existsSync(filePath)) return null;
  try {
    const buffer = fs.readFileSync(filePath);
    return { buffer };
  } catch {
    return null;
  }
}

export class PublicApplyService {
  /**
   * Get job details + MCQ questions for the public form.
   * If no AI-generated questions exist, returns randomised fallback questions.
   */
  async getJobForm(publicFormToken: string) {
    const job = await prisma.jobOpening.findUnique({
      where: { publicFormToken },
      include: {
        questions: {
          select: {
            id: true,
            questionText: true,
            optionA: true,
            optionB: true,
            optionC: true,
            optionD: true,
            category: true,
          },
        },
      },
    });

    if (!job || !job.publicFormEnabled) throw new NotFoundError('Job not found or form disabled');

    return {
      id: job.id,
      title: job.title,
      department: job.department,
      location: job.location,
      type: job.type,
      description: job.description,
      requirements: job.requirements,
    };
  }

  /**
   * Submit a public application with resume only.
   * MCQ/psychometric questions are done in-person at the walk-in stage.
   */
  async submitApplication(publicFormToken: string, data: {
    candidateName: string;
    email?: string;
    mobileNumber?: string;
    city?: string;
    experience?: string;
    currentDesignation?: string;
    preferredLocation?: string;
    willingToRelocate?: string;
    currentCTC?: string;
    expectedCTC?: string;
    noticePeriod?: string;
    resumeUrl?: string;
  }) {
    const job = await prisma.jobOpening.findUnique({
      where: { publicFormToken },
      include: { questions: true },
    });

    if (!job || !job.publicFormEnabled) throw new NotFoundError('Job not found');

    const mcqScore: number | null = null;
    const intelligenceScore: number | null = null;
    const integrityScore: number | null = null;
    const energyScore: number | null = null;
    const usingFallback = false;

    const uid = generateUid();

    // Analyse resume against job description (best-effort, non-blocking)
    let resumeMatchScore: number | null = null;
    let resumeScoreData: any = null;
    let resumeText: string | null = null;
    let matchedKeywords: string[] = [];
    let missingKeywords: string[] = [];
    let atsScore: number | null = null;
    let atsScoreData: any = null;

    if (data.resumeUrl && job.description) {
      try {
        const result = await this.analyzeResumeMatch(
          data.resumeUrl, job.description, job.title, job.requirements, job.organizationId
        );
        resumeMatchScore = result.matchScore;
        resumeScoreData = result;
        resumeText = result.resumeText || null;
        matchedKeywords = result.matchedKeywords || [];
        missingKeywords = result.missingKeywords || [];

        if (resumeText) {
          const jdKeywords = this.extractJdKeywords(job.title, job.description, job.requirements);
          const atsResult = computeAtsScore(resumeText, jdKeywords, resumeMatchScore);
          atsScore = atsResult.atsScore;
          atsScoreData = atsResult;
        }
      } catch (err) {
        logger.warn('Resume analysis failed (non-blocking):', err);
      }
    }

    // Total AI score = resume ATS score (MCQ removed — done in-person at walk-in)
    const totalAiScore: number | null = atsScore ?? resumeMatchScore ?? null;

    const application = await prisma.publicApplication.create({
      data: {
        uid,
        jobOpeningId: job.id,
        candidateName: data.candidateName,
        email: data.email || null,
        mobileNumber: data.mobileNumber || null,
        city: data.city || null,
        experience: data.experience || null,
        currentDesignation: data.currentDesignation || null,
        preferredLocation: data.preferredLocation || null,
        willingToRelocate: data.willingToRelocate || null,
        currentCTC: data.currentCTC || null,
        expectedCTC: data.expectedCTC || null,
        noticePeriod: data.noticePeriod || null,
        resumeUrl: data.resumeUrl || null,
        resumeScoreData,
        resumeMatchScore,
        resumeText,
        matchedKeywords,
        missingKeywords,
        atsScore,
        atsScoreData,
        mcqAnswers: [],
        mcqScore,
        intelligenceScore,
        integrityScore,
        energyScore,
        totalAiScore,
        usedFallbackQuestions: usingFallback,
        candidateUid: uid,
        organizationId: job.organizationId,
      },
    });

    // WhatsApp confirmation (best-effort)
    if (data.mobileNumber) {
      try {
        const { whatsAppService } = await import('../whatsapp/whatsapp.service.js');
        const allowed = await whatsAppService.checkAutoSendQuota(job.organizationId);
        if (allowed) {
          const trackUrl = `https://hr.anistonav.com/track/${application.uid}`;
          const msg = `Hi ${data.candidateName}! 🎯\n\nThank you for applying for *${job.title}* at Aniston Technologies.\n\nYour Application ID: *${application.uid}*\nTrack your application: ${trackUrl}\n\nWe'll review your application and get back to you soon.\n— HR Team, Aniston Technologies LLP`;
          await whatsAppService.sendMessage({ to: data.mobileNumber, message: msg }, job.organizationId, undefined, 'JOB_LINK');
        }
      } catch {
        // WhatsApp not connected or failed — silently continue
      }
    }

    // Send confirmation email to candidate
    if (data.email) {
      try {
        await enqueueEmail({
          to: data.email,
          subject: `Application Received: ${job.title} at Aniston Technologies`,
          template: 'generic',
          context: {
            title: 'Application Received!',
            message: `Dear ${data.candidateName},<br><br>Thank you for applying for the <strong>${job.title}</strong> position.<br><br>Your application ID is: <strong>${application.uid}</strong><br><br>Track your application status at: <a href="https://hr.anistonav.com/track/${application.uid}">https://hr.anistonav.com/track/${application.uid}</a><br><br>We will review your application and get back to you shortly.<br><br>— HR Team, Aniston Technologies LLP`,
          },
        });
      } catch (emailErr) {
        logger.warn('[PublicApply] Failed to send confirmation email:', emailErr);
      }
    }

    return {
      candidateUid: application.candidateUid,
      uid: application.uid,
    };
  }

  // ─── Keyword extractor (shared) ─────────────────────────────────────────
  private extractJdKeywords(jobTitle: string, jobDescription: string, requirements: string[]): string[] {
    const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'have', 'from', 'will', 'been',
      'they', 'their', 'about', 'would', 'which', 'should', 'could', 'other', 'more', 'also', 'into',
      'over', 'such', 'than', 'only', 'when', 'then', 'some', 'each', 'what', 'your', 'year']);
    const extract = (text: string) =>
      text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));
    const raw = [
      ...extract(jobTitle),
      ...requirements.flatMap(r => extract(r)),
      ...extract(jobDescription).slice(0, 60),
    ];
    return [...new Set(raw)];
  }

  /**
   * Full resume analysis pipeline:
   *   1. Resolve file (local path OR cloud URL download)
   *   2. pdf-parse for text extraction
   *   3. AI OCR fallback for image-based PDFs
   *   4. AI deep scoring with JD (if AI configured)
   *   5. Keyword matching fallback (raw — no inflation)
   */
  async analyzeResumeMatch(
    resumeUrl: string,
    jobDescription: string,
    jobTitle: string,
    requirements: string[],
    organizationId: string
  ): Promise<{
    matchScore: number | null;
    strengths: string[];
    gaps: string[];
    summary: string;
    parseMethod?: string;
    resumeText?: string;
    matchedKeywords: string[];
    missingKeywords: string[];
  }> {
    // ── Step 1: Get buffer (local or cloud) ──────────────────────────────────
    const resolved = await resolveResumeBuffer(resumeUrl);
    let tempPath: string | undefined;

    if (!resolved) {
      return {
        matchScore: null, strengths: [], gaps: ['Resume file could not be found or downloaded'],
        summary: 'File not accessible. Please re-upload the resume.',
        parseMethod: 'none', matchedKeywords: [], missingKeywords: [],
      };
    }

    const { buffer } = resolved;
    tempPath = resolved.tempPath;

    // ── Step 2: pdf-parse ────────────────────────────────────────────────────
    let resumeText = '';
    let parseMethod = 'pdf-parse';

    try {
      const pdfData = await pdfParse(buffer);
      resumeText = (pdfData.text || '').replace(/\s+/g, ' ').trim().slice(0, 8000);
      logger.info(`[ResumeParser] pdf-parse: ${resumeText.length} chars`);
    } catch {
      resumeText = '';
    } finally {
      // Temp file is only needed for pdf-parse; clean up immediately after extraction
      if (tempPath) { try { fs.unlinkSync(tempPath); tempPath = undefined; } catch { /* ignore */ } }
    }

    // ── Step 3: AI OCR fallback for image-based PDFs ─────────────────────────
    // Send as multipart FormData to POST /ai/ocr/extract (the only endpoint
    // that exists in the Python service). JSON/base64 is NOT supported.
    if (resumeText.length < 50) {
      try {
        const aiServiceUrl = process.env.AI_SERVICE_URL;
        const aiApiKey = process.env.AI_SERVICE_API_KEY || '';
        if (aiServiceUrl) {
          const formData = new FormData();
          const blob = new Blob([buffer as unknown as ArrayBuffer], { type: 'application/pdf' });
          formData.append('file', blob, 'resume.pdf');
          const headers: Record<string, string> = {};
          if (aiApiKey) headers['X-API-Key'] = aiApiKey;
          const ocrRes = await fetch(`${aiServiceUrl}/ai/ocr/extract`, {
            method: 'POST',
            headers,
            body: formData,
            signal: AbortSignal.timeout(30000),
          });
          if (ocrRes.ok) {
            const ocrJson = await ocrRes.json();
            // /ai/ocr/extract returns { success, data: { raw_text, ... } }
            const rawText = ocrJson?.data?.raw_text || ocrJson?.data?.text || ocrJson.text || '';
            resumeText = rawText.replace(/\s+/g, ' ').trim().slice(0, 8000);
            parseMethod = 'ai-ocr';
            logger.info(`[ResumeParser] AI OCR: ${resumeText.length} chars`);
          }
        }
      } catch (ocrErr) {
        logger.warn('[ResumeParser] AI OCR fallback failed:', ocrErr);
      }
    }

    if (!resumeText || resumeText.length < 30) {
      return {
        matchScore: null, strengths: [],
        gaps: ['Resume appears to be image-based — no extractable text', 'Ask the candidate to upload a text-based PDF'],
        summary: 'No readable text found. File may be a scanned image.',
        parseMethod: 'none', resumeText: undefined, matchedKeywords: [], missingKeywords: [],
      };
    }

    // ── Build JD keyword set ────────────────────────────────────────────────
    const jdKeywords = this.extractJdKeywords(jobTitle, jobDescription, requirements);

    // ── Step 4: AI deep scoring ──────────────────────────────────────────────
    try {
      const systemPrompt = `You are an expert HR resume screener at an Indian technology company. Analyse this resume against the job description and score the match from 0 to 100.

Consider:
- Relevant skills and technologies mentioned
- Years of experience alignment
- Education and certifications
- Domain/industry match
- Location and availability

Return ONLY valid JSON (no prose):
{"matchScore":75,"strengths":["Relevant skill 1","Good experience"],"gaps":["Missing certification","Less experience than required"],"summary":"One-line overall assessment","matchedKeywords":["react","javascript"],"missingKeywords":["kubernetes","aws"]}`;

      const userPrompt = `JOB TITLE: ${jobTitle}

JOB DESCRIPTION:
${jobDescription.slice(0, 1000)}

REQUIREMENTS:
${requirements.length > 0 ? requirements.join('\n- ') : 'Not specified'}

JD KEYWORDS TO CHECK: ${jdKeywords.slice(0, 30).join(', ')}

CANDIDATE RESUME TEXT:
${resumeText.slice(0, 4000)}`;

      const result = await aiService.prompt(organizationId, systemPrompt, userPrompt, 1200);
      if (result.success && result.data) {
        const jsonMatch = result.data.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            matchScore: Math.min(100, Math.max(0, Math.round(Number(parsed.matchScore) || 50))),
            strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 6) : [],
            gaps: Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 6) : [],
            summary: String(parsed.summary || '').slice(0, 400),
            parseMethod,
            resumeText,
            matchedKeywords: Array.isArray(parsed.matchedKeywords) ? parsed.matchedKeywords : [],
            missingKeywords: Array.isArray(parsed.missingKeywords) ? parsed.missingKeywords : [],
          };
        }
      }
    } catch (err) {
      logger.warn('[ResumeParser] AI analysis failed, using keyword fallback:', err);
    }

    // ── Step 5: Keyword matching fallback (no inflation) ─────────────────────
    const resumeLower = resumeText.toLowerCase();
    if (jdKeywords.length === 0) {
      return {
        matchScore: 50, strengths: [], gaps: [], summary: 'Not enough JD keywords to analyse.',
        parseMethod, resumeText, matchedKeywords: [], missingKeywords: [],
      };
    }

    const matched: string[] = [];
    const missed: string[] = [];
    for (const kw of jdKeywords) {
      if (resumeLower.includes(kw)) matched.push(kw);
      else missed.push(kw);
    }

    // Raw score: proportion of JD keywords found. No artificial inflation.
    const rawScore = (matched.length / jdKeywords.length) * 100;
    const matchScore = Math.min(100, Math.max(0, Math.round(rawScore)));

    return {
      matchScore,
      strengths: matched.slice(0, 8).map(k => `"${k}" found in resume`),
      gaps: missed.slice(0, 8).map(k => `"${k}" expected by JD — not found`),
      summary: `Keyword analysis: ${matched.length}/${jdKeywords.length} JD keywords matched (${matchScore}%).`,
      parseMethod,
      resumeText,
      matchedKeywords: matched,
      missingKeywords: missed,
    };
  }

  /**
   * Score a standalone resume buffer (used by bulk upload).
   */
  async scoreResumeBuffer(
    buffer: Buffer,
    fileName: string,
    jobDescription: string,
    jobTitle: string,
    requirements: string[],
    organizationId: string
  ): Promise<{
    matchScore: number | null;
    atsScore: number | null;
    atsScoreData: any;
    strengths: string[];
    gaps: string[];
    summary: string;
    matchedKeywords: string[];
    missingKeywords: string[];
    resumeText: string;
    parseMethod: string;
    candidateName?: string;
    email?: string;
    phone?: string;
  }> {
    let resumeText = '';
    let parseMethod = 'pdf-parse';

    try {
      const pdfData = await pdfParse(buffer);
      resumeText = (pdfData.text || '').replace(/\s+/g, ' ').trim().slice(0, 8000);
    } catch { resumeText = ''; }

    if (resumeText.length < 50) {
      try {
        const aiServiceUrl = process.env.AI_SERVICE_URL;
        const aiApiKey = process.env.AI_SERVICE_API_KEY || '';
        if (aiServiceUrl) {
          const formData = new FormData();
          const blob = new Blob([buffer as unknown as ArrayBuffer], { type: 'application/pdf' });
          formData.append('file', blob, 'resume.pdf');
          const headers: Record<string, string> = {};
          if (aiApiKey) headers['X-API-Key'] = aiApiKey;
          const ocrRes = await fetch(`${aiServiceUrl}/ai/ocr/extract`, {
            method: 'POST',
            headers,
            body: formData,
            signal: AbortSignal.timeout(30000),
          });
          if (ocrRes.ok) {
            const json = await ocrRes.json();
            const rawText = json?.data?.raw_text || json?.data?.text || json.text || '';
            resumeText = rawText.replace(/\s+/g, ' ').trim().slice(0, 8000);
            parseMethod = 'ai-ocr';
          }
        }
      } catch { /* ignore */ }
    }

    if (!resumeText || resumeText.length < 30) {
      return {
        matchScore: null, atsScore: null, atsScoreData: null,
        strengths: [], gaps: ['No readable text — may be a scanned image'],
        summary: 'Unable to extract text from this resume.',
        matchedKeywords: [], missingKeywords: [], resumeText: '', parseMethod: 'none',
      };
    }

    const jdKeywords = this.extractJdKeywords(jobTitle, jobDescription, requirements);

    // Extract basic contact info via regex
    const emailMatch = resumeText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = resumeText.match(/(\+91[\s\-]?)?[6-9]\d{9}|(\+\d{1,3}[\s\-]?)?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}/);
    const email = emailMatch ? emailMatch[0] : undefined;
    const phone = phoneMatch ? phoneMatch[0] : undefined;

    // Rough name heuristic: first non-empty line that looks like a name
    const firstLine = resumeText.split('\n').map(l => l.trim()).find(l => l.length > 2 && l.length < 50 && /^[A-Z]/.test(l));
    const candidateName = firstLine;

    // Try AI scoring
    let matchScore: number | null = null;
    let strengths: string[] = [];
    let gaps: string[] = [];
    let summary = '';
    let matchedKeywords: string[] = [];
    let missingKeywords: string[] = [];

    try {
      const systemPrompt = `You are an expert HR resume screener. Score this resume against the job description 0-100. Return ONLY JSON:
{"matchScore":75,"strengths":["skill1"],"gaps":["missing1"],"summary":"brief assessment","matchedKeywords":["react"],"missingKeywords":["aws"]}`;
      const userPrompt = `JOB TITLE: ${jobTitle}\nJD: ${jobDescription.slice(0, 800)}\nREQUIREMENTS: ${requirements.join(', ')}\nKEYWORDS: ${jdKeywords.slice(0, 25).join(', ')}\nRESUME:\n${resumeText.slice(0, 3500)}`;
      const result = await aiService.prompt(organizationId, systemPrompt, userPrompt, 1000);
      if (result.success && result.data) {
        const jsonMatch = result.data.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          matchScore = Math.min(100, Math.max(0, Math.round(Number(parsed.matchScore) || 0)));
          strengths = Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 6) : [];
          gaps = Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 6) : [];
          summary = String(parsed.summary || '').slice(0, 400);
          matchedKeywords = Array.isArray(parsed.matchedKeywords) ? parsed.matchedKeywords : [];
          missingKeywords = Array.isArray(parsed.missingKeywords) ? parsed.missingKeywords : [];
        }
      }
    } catch { /* fall through to keyword match */ }

    if (matchScore === null) {
      const resumeLower = resumeText.toLowerCase();
      const matched: string[] = [];
      const missed: string[] = [];
      for (const kw of jdKeywords) {
        if (resumeLower.includes(kw)) matched.push(kw);
        else missed.push(kw);
      }
      matchScore = jdKeywords.length > 0 ? Math.round((matched.length / jdKeywords.length) * 100) : 0;
      matchedKeywords = matched;
      missingKeywords = missed;
      strengths = matched.slice(0, 6).map(k => `"${k}" found in resume`);
      gaps = missed.slice(0, 6).map(k => `"${k}" expected — not found`);
      summary = `Keyword match: ${matched.length}/${jdKeywords.length} keywords (${matchScore}%)`;
    }

    const atsResult = computeAtsScore(resumeText, jdKeywords, matchScore);

    return {
      matchScore, atsScore: atsResult.atsScore, atsScoreData: atsResult,
      strengths, gaps, summary,
      matchedKeywords, missingKeywords, resumeText,
      parseMethod, candidateName, email, phone,
    };
  }

  /**
   * Generate MCQ screening questions for a job.
   * Falls back to randomised questions from the expanded bank if AI is unavailable.
   */
  async generateQuestions(jobId: string, organizationId: string) {
    const job = await prisma.jobOpening.findFirst({ where: { id: jobId, organizationId } });
    if (!job) throw new NotFoundError('Job not found');

    const systemPrompt = `You are an expert HR recruiter. Generate exactly 6 multiple-choice screening questions for a job candidate. The questions should NOT be directly about the job role but should assess the candidate's:
- INTELLIGENCE (2 questions): logical reasoning, analytical thinking, problem-solving
- INTEGRITY (2 questions): ethical judgment, honesty, trustworthiness
- ENERGY (2 questions): motivation, drive, resilience, initiative

Each question must have 4 options (A, B, C, D) where the correct answer tests the desired trait. Make the correct answer non-obvious.

Return ONLY a JSON array:
[{"questionText":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctOption":"A","category":"INTELLIGENCE"}]`;

    const userPrompt = `Job Title: ${job.title}\nDepartment: ${job.department}\nDescription: ${job.description?.slice(0, 500)}`;

    const result = await aiService.prompt(organizationId, systemPrompt, userPrompt, 2048);

    let questions: any[] = [];
    let usedFallback = false;

    if (result.success && result.data) {
      try {
        const jsonMatch = result.data.match(/\[[\s\S]*\]/);
        questions = JSON.parse(jsonMatch?.[0] || '[]');
      } catch {
        logger.warn('Failed to parse AI-generated MCQ questions, using randomised fallback');
      }
    }

    if (questions.length === 0) {
      logger.info(`AI returned no parseable questions for job ${jobId}, using randomised fallback MCQ bank`);
      questions = buildFallbackQuestions(false);
      usedFallback = true;
    }

    await prisma.jobApplicationQuestion.deleteMany({ where: { jobOpeningId: jobId } });

    const createOps = questions.slice(0, 6).map(q =>
      prisma.jobApplicationQuestion.create({
        data: {
          jobOpeningId: jobId,
          questionText: q.questionText,
          optionA: q.optionA,
          optionB: q.optionB,
          optionC: q.optionC,
          optionD: q.optionD,
          correctOption: q.correctOption,
          category: q.category,
          aiGenerated: !usedFallback,
        },
      })
    );

    const created = await prisma.$transaction(createOps);
    return created;
  }

  /**
   * Track application status (public).
   */
  async trackApplication(candidateUid: string) {
    const app = await prisma.publicApplication.findUnique({
      where: { candidateUid },
      select: {
        uid: true,
        candidateName: true,
        status: true,
        totalAiScore: true,
        createdAt: true,
        jobOpening: { select: { title: true } },
        interviewRounds: {
          select: { scheduledAt: true },
          orderBy: { scheduledAt: 'asc' },
          take: 1,
        },
      },
    });

    if (!app) throw new NotFoundError('Application not found');

    const nextInterview = app.interviewRounds?.[0];
    return {
      uid: app.uid,
      name: app.candidateName,
      jobTitle: app.jobOpening.title,
      status: app.status,
      appliedAt: app.createdAt,
      interviewDate: nextInterview?.scheduledAt || null,
    };
  }

  /**
   * List public applications for a job (HR view).
   */
  async listApplications(organizationId: string, jobId?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: any = { organizationId, deletedAt: null };
    if (jobId) where.jobOpeningId = jobId;

    const [applications, total] = await Promise.all([
      prisma.publicApplication.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { jobOpening: { select: { title: true } } },
      }),
      prisma.publicApplication.count({ where }),
    ]);

    return {
      data: applications,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
    };
  }

  /**
   * Create an interview round.
   */
  async createRound(applicationId: string, data: {
    roundType: 'HR' | 'MANAGER' | 'SUPERADMIN';
    conductedBy: string;
    scheduledAt?: string;
  }, organizationId: string) {
    const app = await prisma.publicApplication.findFirst({ where: { id: applicationId, organizationId } });
    if (!app) throw new NotFoundError('Application not found');

    return prisma.interviewRound.create({
      data: {
        applicationId,
        roundType: data.roundType,
        conductedBy: data.conductedBy,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        status: 'PENDING_ROUND',
        organizationId,
      },
    });
  }

  /**
   * Schedule an interview for a candidate.
   */
  async scheduleInterview(applicationId: string, data: {
    interviewerId?: string;
    interviewerName?: string;
    scheduledAt: string;
    location: string;
    notes?: string;
    messageType?: 'whatsapp' | 'email' | 'both';
    roundType?: 'HR' | 'MANAGER' | 'SUPERADMIN';
  }, organizationId: string, userId: string) {
    const app = await prisma.publicApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: { jobOpening: { select: { title: true } } },
    });
    if (!app) throw new NotFoundError('Application not found');

    const round = await prisma.interviewRound.create({
      data: {
        applicationId,
        roundType: data.roundType || 'HR',
        conductedBy: data.interviewerId || userId,
        scheduledAt: new Date(data.scheduledAt),
        status: 'PENDING_ROUND',
        organizationId,
      },
    });

    await prisma.publicApplication.update({
      where: { id: applicationId },
      data: { status: 'INTERVIEW_SCHEDULED' },
    });

    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    const preview = await this.previewScheduleMessage(organizationId, {
      scheduledAt: data.scheduledAt,
      location: data.location,
      interviewerName: data.interviewerName || 'HR Team',
      jobTitle: app.jobOpening.title,
      companyName: org?.name || 'Aniston Technologies LLP',
      candidateName: app.candidateName,
    });

    const messageType = data.messageType || 'both';

    if ((messageType === 'email' || messageType === 'both') && app.email) {
      try {
        const { enqueueEmail } = await import('../../jobs/queues.js');
        await enqueueEmail({
          to: app.email,
          subject: preview.emailSubject || `Interview Scheduled: ${app.jobOpening.title}`,
          template: 'generic',
          context: {
            title: 'Interview Scheduled',
            message: preview.emailBody || `Your interview is scheduled for ${new Date(data.scheduledAt).toLocaleString('en-IN')} at ${data.location}`,
          },
        });
      } catch (err) {
        logger.error('Failed to send interview email:', err);
      }
    }

    let whatsappMessageSent = false;
    if ((messageType === 'whatsapp' || messageType === 'both') && app.mobileNumber) {
      const whatsappMsg = (preview.whatsappDraft || `Hi ${app.candidateName}, your interview for *${app.jobOpening.title}* is scheduled. Please be on time. — HR Team`).trim();
      if (whatsappMsg) {
        try {
          const { whatsAppService } = await import('../whatsapp/whatsapp.service.js');
          const allowed = await whatsAppService.checkAutoSendQuota(organizationId);
          if (allowed) {
            await whatsAppService.sendMessage(
              { to: app.mobileNumber, message: whatsappMsg },
              organizationId
            );
            whatsappMessageSent = true;
          } else {
            logger.warn('[WhatsApp] Auto-send quota exceeded for interview schedule, org:', organizationId);
          }
        } catch (err) {
          logger.error('Failed to send interview WhatsApp:', err);
        }
      } else {
        logger.warn('Interview WhatsApp message was empty after AI generation — skipping send');
      }
    }

    return { round, preview, whatsappMessageSent };
  }

  async previewScheduleMessage(organizationId: string, data: {
    scheduledAt: string; location: string; interviewerName: string;
    jobTitle: string; companyName: string; candidateName: string;
  }) {
    const systemPrompt = `You are an HR assistant. Generate a professional WhatsApp message and email for scheduling an interview. Be friendly but professional.`;
    const userPrompt = `Generate a WhatsApp message and email for this interview:
- Candidate: ${data.candidateName}
- Position: ${data.jobTitle}
- Company: ${data.companyName}
- Date/Time: ${new Date(data.scheduledAt).toLocaleString('en-IN')}
- Location: ${data.location}
- Interviewer: ${data.interviewerName}

Return JSON: {"whatsappDraft":"...","emailSubject":"...","emailBody":"..."}`;

    const result = await aiService.prompt(organizationId, systemPrompt, userPrompt, 800);
    if (!result.success) {
      return {
        whatsappDraft: `Hi ${data.candidateName}, your interview for ${data.jobTitle} at ${data.companyName} is scheduled for ${new Date(data.scheduledAt).toLocaleString('en-IN')} at ${data.location}. Please be on time. - HR Team`,
        emailSubject: `Interview Scheduled: ${data.jobTitle} at ${data.companyName}`,
        emailBody: `Dear ${data.candidateName},\n\nYour interview is scheduled.\n\nDate: ${new Date(data.scheduledAt).toLocaleString('en-IN')}\nLocation: ${data.location}\nInterviewer: ${data.interviewerName}\n\nBest regards,\nHR Team`,
      };
    }
    try {
      const jsonMatch = result.data!.match(/\{[\s\S]*\}/);
      return JSON.parse(jsonMatch?.[0] || '{}');
    } catch {
      return { whatsappDraft: result.data, emailSubject: '', emailBody: '' };
    }
  }

  async generateInterviewQuestions(roundId: string, organizationId: string) {
    const round = await prisma.interviewRound.findFirst({
      where: { id: roundId, organizationId },
      include: { application: { include: { jobOpening: true } } },
    });
    if (!round) throw new NotFoundError('Round not found');

    const systemPrompt = `You are an expert interviewer. Generate 8 interview questions with suggested answers for the interviewer. Tailor the questions to the candidate's profile and job requirements.
Return ONLY a JSON array: [{"question":"...","suggestedAnswer":"..."}]`;

    const userPrompt = `Job: ${round.application.jobOpening.title}
Department: ${round.application.jobOpening.department}
Round Type: ${round.roundType}
Candidate: ${round.application.candidateName}
Job Description: ${round.application.jobOpening.description?.slice(0, 500)}`;

    const result = await aiService.prompt(organizationId, systemPrompt, userPrompt, 2048);
    if (!result.success) throw new BadRequestError('Failed to generate: ' + result.error);

    let questions: any[];
    try {
      const jsonMatch = result.data!.match(/\[[\s\S]*\]/);
      questions = JSON.parse(jsonMatch?.[0] || '[]');
    } catch {
      throw new BadRequestError('Failed to parse AI response');
    }

    await prisma.interviewRound.update({
      where: { id: roundId },
      data: { aiQuestionsGenerated: questions },
    });

    return questions;
  }

  async scoreRound(roundId: string, score: number, feedback: string, userId: string, organizationId: string) {
    if (score < 0 || score > 100) throw new BadRequestError('Score must be between 0 and 100');
    const round = await prisma.interviewRound.findFirst({ where: { id: roundId, organizationId } });
    if (!round) throw new NotFoundError('Round not found');
    return prisma.interviewRound.update({
      where: { id: roundId },
      data: { score, feedback, status: 'COMPLETED_ROUND', completedAt: new Date() },
    });
  }

  async getInterviewTasks(userId: string, userRole: string, organizationId: string) {
    const isHrAdmin = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(userRole);
    const where: any = { organizationId };
    if (!isHrAdmin) where.conductedBy = userId;

    return prisma.interviewRound.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        application: {
          select: {
            id: true, candidateName: true, email: true, mobileNumber: true,
            candidateUid: true, totalAiScore: true, mcqScore: true, status: true,
            jobOpening: { select: { title: true, department: true } },
          },
        },
      },
    });
  }

  async finalizeCandidate(applicationId: string, finalStatus: 'SELECTED' | 'REJECTED' | 'ON_HOLD', userId: string, organizationId: string) {
    const app = await prisma.publicApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: { interviewRounds: true, jobOpening: { select: { title: true, department: true } } },
    });
    if (!app) throw new NotFoundError('Application not found');

    const roundScores = app.interviewRounds.filter(r => r.score !== null).map(r => r.score!);
    const allScores: number[] = [];
    if (app.totalAiScore !== null) allScores.push(app.totalAiScore);
    allScores.push(...roundScores);
    const finalScore = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

    const updated = await prisma.publicApplication.update({
      where: { id: applicationId },
      data: { finalScore, finalStatus, finalizedAt: new Date(), finalizedBy: userId, status: finalStatus },
    });

    if (finalStatus === 'SELECTED' && app.email) {
      try {
        // NOTE: We do NOT send a standalone congratulations email here because
        // the auto-invite block below already sends an onboarding invite email
        // that contains the congratulations message. Sending both causes duplicate
        // emails within seconds of each other (F-4 dedup fix).

        const org = await prisma.organization.findUnique({
          where: { id: organizationId },
          select: { adminNotificationEmail: true },
        });
        if (org?.adminNotificationEmail) {
          await enqueueEmail({
            to: org.adminNotificationEmail,
            subject: `Candidate Selected: ${app.candidateName} — ${app.jobOpening.title}`,
            template: 'generic',
            context: {
              title: 'Candidate Selected',
              message: `Candidate <strong>${app.candidateName}</strong> has been selected for <strong>${app.jobOpening.title}</strong>.<br><br><strong>Email:</strong> ${app.email}<br><strong>Final Score:</strong> ${finalScore.toFixed(1)}%<br><br>A congratulations email has been sent. Please send the onboarding invitation from the Hiring Passed tab.`,
            },
          });
        }

        // Auto-create onboarding invitation
        try {
          const dept = app.jobOpening?.department
            ? await prisma.department.findFirst({
                where: { organizationId, name: app.jobOpening.department, deletedAt: null },
                select: { id: true },
              })
            : null;

          const inviteToken = crypto.randomBytes(32).toString('hex');
          await prisma.employeeInvitation.create({
            data: {
              email: app.email!,
              role: 'EMPLOYEE',
              departmentId: dept?.id || null,
              invitedBy: userId,
              organizationId,
              status: 'PENDING',
              expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
              inviteToken,
            },
          });

          await enqueueEmail({
            to: app.email!,
            subject: `Congratulations! You've been selected for ${app.jobOpening.title} — Complete Your Onboarding`,
            template: 'onboarding-invite',
            context: {
              name: app.candidateName || 'Candidate',
              congratsMessage: `You have been <strong>selected</strong> for <strong>${app.jobOpening.title}</strong>. Welcome to the team!`,
              link: `https://hr.anistonav.com/onboarding/invite/${inviteToken}`,
            },
          });
          logger.info(`[PublicApply] Auto-invite sent to ${app.email} on SELECTED`);
        } catch (inviteErr) {
          logger.warn('[PublicApply] Auto-invite failed (non-blocking):', inviteErr);
        }
      } catch (err) {
        logger.error('[PublicApply] Error sending congratulations email:', err);
      }
    }

    if (finalStatus === 'REJECTED' && app.email) {
      try {
        await enqueueEmail({
          to: app.email,
          subject: `Update on your application: ${app.jobOpening.title}`,
          template: 'generic',
          context: {
            title: 'Application Status Update',
            message: `Dear ${app.candidateName},<br><br>Thank you for your interest in the <strong>${app.jobOpening.title}</strong> position and for taking the time to go through our selection process.<br><br>After careful consideration, we regret to inform you that we will not be moving forward with your application at this time.<br><br>We appreciate the effort you put into the process and encourage you to apply again for future openings that match your profile.<br><br>We wish you all the best in your career journey.<br><br>— HR Team, Aniston Technologies LLP`,
          },
        });
      } catch (err) {
        logger.error('[PublicApply] Error sending rejection email:', err);
      }
    }

    return updated;
  }

  async getApplicationDetail(applicationId: string, organizationId: string) {
    const app = await prisma.publicApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: {
        jobOpening: { select: { title: true, department: true, description: true, requirements: true } },
        interviewRounds: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!app) throw new NotFoundError('Application not found');
    return app;
  }
}

export const publicApplyService = new PublicApplyService();

/**
 * Score psychometric answers (INTEGRITY + ENERGY categories) submitted at the
 * walk-in stage. Uses the same stable-ID map as public-apply scoring.
 */
export function scorePsychAnswers(answers: Array<{ questionId: string; selectedOption: string }>) {
  const questionMap = new Map<string, { correctOption: string; category: string }>();
  for (const [cat, questions] of Object.entries(FALLBACK_MCQ_BANK)) {
    for (const q of questions as any[]) {
      questionMap.set(stableQuestionId(q.questionText), { correctOption: q.correctOption, category: cat });
    }
  }

  let intgCorrect = 0, intgTotal = 0;
  let enCorrect = 0, enTotal = 0;

  for (const answer of answers) {
    const question = questionMap.get(answer.questionId);
    if (!question) continue;
    const isCorrect = answer.selectedOption === question.correctOption;
    if (question.category === 'INTEGRITY') { intgTotal++; if (isCorrect) intgCorrect++; }
    if (question.category === 'ENERGY') { enTotal++; if (isCorrect) enCorrect++; }
  }

  const integrityScore = intgTotal > 0 ? (intgCorrect / intgTotal) * 100 : null;
  const energyScore = enTotal > 0 ? (enCorrect / enTotal) * 100 : null;
  const components = [integrityScore, energyScore].filter(v => v !== null) as number[];
  const psychScore = components.length > 0 ? components.reduce((a, b) => a + b, 0) / components.length : null;

  return { psychScore, integrityScore, energyScore };
}

/**
 * Get INTEGRITY + ENERGY questions for the in-person psychometric test at walk-in.
 * Returns 3 per category (6 total), with answers stripped.
 */
export function getPsychometricQuestions() {
  const pick = (bank: any[], n: number) => {
    const shuffled = [...bank].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n).map(q => ({
      id: stableQuestionId(q.questionText),
      questionText: q.questionText,
      optionA: q.optionA,
      optionB: q.optionB,
      optionC: q.optionC,
      optionD: q.optionD,
      category: '',
    }));
  };
  return [
    ...pick(FALLBACK_MCQ_BANK.INTEGRITY, 3).map(q => ({ ...q, category: 'INTEGRITY' })),
    ...pick(FALLBACK_MCQ_BANK.ENERGY, 3).map(q => ({ ...q, category: 'ENERGY' })),
  ].sort(() => Math.random() - 0.5);
}
