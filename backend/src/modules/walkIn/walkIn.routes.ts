import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { uploadDocument, uploadCsv } from '../../middleware/upload.middleware.js';
import { walkInController } from './walkIn.controller.js';
import { rateLimiter } from '../../middleware/rateLimiter.js';

const router = Router();

// =====================
// PUBLIC ROUTES (No Auth)
// =====================

// Get open job openings for the kiosk dropdown
router.get('/jobs', (req, res, next) => walkInController.getOpenJobs(req, res, next));

// Register a walk-in candidate (public kiosk)
router.post('/register', (req, res, next) => walkInController.register(req, res, next));

// Upload a file for walk-in candidate (public kiosk)
// Rate limited: 10 uploads per minute per IP to prevent storage abuse
router.post('/upload',
  rateLimiter({ windowMs: 60 * 1000, max: 10, keyPrefix: 'rl:walkin-upload' }),
  uploadDocument.single('file'),
  (req, res, next) => walkInController.uploadFile(req, res, next)
);

// Get walk-in record by token number (public — for status check)
router.get('/token/:tokenNumber', (req, res, next) => walkInController.getByToken(req, res, next));

// Get in-person psychometric questions (public — shown on kiosk before submission)
router.get('/psychometric-questions', (req, res, next) => walkInController.getPsychometricQuestions(req, res, next));

// =====================
// HR ROUTES (Auth Required)
// =====================

// =====================
// EMPLOYEE INTERVIEW ROUTES (any authenticated user)
// =====================

router.get('/my-interviews', authenticate, (req, res, next) => walkInController.getMyInterviews(req, res, next));
router.get('/my-interviews/:roundId', authenticate, (req, res, next) => walkInController.getMyInterviewDetail(req, res, next));
router.patch('/my-interviews/:roundId/score', authenticate, (req, res, next) => walkInController.submitMyScore(req, res, next));

// =====================
// HR ROUTES (Auth Required)
// =====================

const hrAuth = [authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR)];

// Get walk-in stats (counts per status)
router.get('/stats', ...hrAuth, (req, res, next) => walkInController.getStats(req, res, next));

// Get ALL walk-ins (not just today)
router.get('/all', ...hrAuth, (req, res, next) => walkInController.getAllWalkIns(req, res, next));

// Get selected (hiring passed) candidates
router.get('/selected', ...hrAuth, (req, res, next) => walkInController.getSelectedCandidates(req, res, next));

// Get interviewers list for dropdown
router.get('/interviewers', ...hrAuth, (req, res, next) => walkInController.getInterviewers(req, res, next));

// Get today's walk-ins (HR dashboard — legacy)
router.get('/today', ...hrAuth, (req, res, next) => walkInController.getTodayWalkIns(req, res, next));

// Send WhatsApp interview invite with walk-in form link
router.post('/whatsapp-invite', ...hrAuth, (req, res, next) => walkInController.sendWhatsAppInvite(req, res, next));

// Bulk import walk-in candidates from CSV (Naukri / Indeed / any platform export)
router.post('/bulk-import', ...hrAuth, uploadCsv.single('file'), (req, res, next) => walkInController.bulkImport(req, res, next));

// Get a specific walk-in record
router.get('/:id', ...hrAuth, (req, res, next) => walkInController.getById(req, res, next));

// Update candidate details
router.patch('/:id', ...hrAuth, (req, res, next) => walkInController.updateCandidate(req, res, next));

// Update walk-in status
router.patch('/:id/status', ...hrAuth, (req, res, next) => walkInController.updateStatus(req, res, next));

// Add HR notes
router.post('/:id/notes', ...hrAuth, (req, res, next) => walkInController.addNotes(req, res, next));

// Interview rounds
router.post('/:id/rounds', ...hrAuth, (req, res, next) => walkInController.addInterviewRound(req, res, next));
router.patch('/:id/rounds/:roundId', ...hrAuth, (req, res, next) => walkInController.updateInterviewRound(req, res, next));
router.delete('/:id/rounds/:roundId', ...hrAuth, (req, res, next) => walkInController.deleteInterviewRound(req, res, next));

// Convert walk-in to full Application
router.patch('/:id/convert', ...hrAuth, (req, res, next) => walkInController.convertToApplication(req, res, next));

// Hire walk-in candidate (create employee + send onboarding invite)
router.post('/:id/hire', ...hrAuth, (req, res, next) => walkInController.hire(req, res, next));

// Generate AI interview questions for a candidate
router.post('/:id/generate-questions', ...hrAuth, (req, res, next) => walkInController.generateInterviewQuestions(req, res, next));

// Delete a walk-in record
router.delete('/:id', ...hrAuth, (req, res, next) => walkInController.remove(req, res, next));

export { router as walkInRouter };
