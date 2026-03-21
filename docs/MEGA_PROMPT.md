# ANISTON HRMS — COMPLETE ENTERPRISE MEGA PROMPT
### Version 2.0 | Full-Stack PWA | AI-Powered | Futuristic UI

> **Instructions for AI (Claude Code):** Build "Aniston HRMS" — a complete, production-grade, enterprise-level Human Resource Management System as a Progressive Web Application. This is a full-stack application. Follow every instruction precisely. Do NOT simplify any feature. Where screenshots are attached, use them as the primary UI reference for layout, color, component placement, and interaction patterns. The app name is **Aniston HRMS** — use this name everywhere (logo, title, emails, PWA manifest, loading screens).

---

## PROJECT OVERVIEW

**Aniston HRMS** is a futuristic, enterprise-grade HR platform built for modern, distributed, multi-location organizations. It handles three distinct types of teams with completely different attendance and tracking needs, a fully online recruitment pipeline with AI-scoring, comprehensive payroll with Indian statutory compliance, self-onboarding with OCR, intelligent policies, and a stunning Monday.com-inspired layered UI with luminance hierarchy.

### What makes Aniston HRMS different:
- **3 attendance modes** in one platform: Office (geofence auto), Field/Sales (GPS trail clustering), Project Site (flexible check-in with context)
- **Fully paperless recruitment** from job posting → AI screening → offer → onboarding
- **Self-onboarding with OCR** that reads documents and auto-fills employee data
- **DeepSeek AI** for interview scoring and HR assistant
- **RAGFlow** for instant HR knowledge base search
- **Monday.com-inspired UI** with deep layer architecture, glassmorphism, luminance hierarchy — not a flat boring dashboard

---

## TECH STACK

### Frontend
- **Framework:** React 18+ with Vite
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS v3 + **shadcn/ui** + **Radix UI** primitives
- **UI Philosophy:** Monday.com layer architecture — cards with layered shadows, glassmorphism panels, depth-through-blur, NOT flat design. Every surface has a `z-layer` feel.
- **Icons:** Lucide React + Phosphor Icons
- **Fonts:**
  - Display/Headings: `"Sora"` — futuristic, premium feel
  - Body: `"DM Sans"` — clean, readable
  - Numbers/Data: `"JetBrains Mono"` — for stats, IDs, codes
- **Animations:** Framer Motion (page transitions, micro-interactions, staggered lists, spring physics)
- **Charts & Dashboards:** Recharts + Nivo + D3.js (for org chart)
- **State Management:** Redux Toolkit + RTK Query
- **Forms:** React Hook Form + Zod
- **Tables:** TanStack Table v8
- **Date/Time:** date-fns + React Day Picker
- **Maps & Geolocation:** Mapbox GL JS + Turf.js (geofencing + GPS clustering)
- **Real-time:** Socket.io Client
- **PWA:** vite-plugin-pwa + Workbox
- **Notifications:** React Hot Toast + Socket.io notification system
- **Rich Text Editor:** TipTap (policies, announcements, JDs)
- **File Upload:** React Dropzone
- **PDF Generation:** @react-pdf/renderer (salary slips, offer letters, certificates)
- **Calendar:** FullCalendar React
- **Virtual Scrolling:** TanStack Virtual
- **Org Chart:** @antv/g6 or react-organizational-chart with custom D3 renderer
- **OCR Client:** tesseract.js (client-side OCR for document scanning)
- **Kanban:** @hello-pangea/dnd (recruitment pipeline)
- **QR Code:** qrcode.react (visiting cards, attendance)
- **Confetti:** canvas-confetti (onboarding completion)
- **Tour/Onboarding:** React Joyride
- **Offline DB:** Dexie.js (IndexedDB wrapper)

### Backend
- **Runtime:** Node.js 20 LTS
- **Framework:** Express.js with TypeScript
- **Database:** PostgreSQL 16 + PostGIS extension
- **ORM:** Prisma ORM
- **Cache:** Redis 7
- **Queue:** BullMQ (email, payroll, OCR, notifications)
- **Real-time:** Socket.io Server
- **Auth:** JWT (access 15min + refresh 7d httpOnly) + bcrypt
- **Email:** Microsoft 365
- **File Storage:** AWS S3 / MinIO
- **OCR Backend:** Python microservice using `pytesseract` + `pdf2image` + `opencv-python` for document tamper detection + `pillow`
- **AI Interview Scoring:** DeepSeek API integration (via Python microservice)
- **RAG Search:** RAGFlow (self-hosted) connected via REST API
- **Document Verification:** Python script using `python-doctr` for OCR + `imagehash` + `exifread` for tamper detection
- **Teams Integration:** Microsoft Graph API (for Teams meeting links, Copilot recording fetch)
- **Naukri Integration:** Naukri RMS API (job posting sync)
- **API Documentation:** Swagger / OpenAPI 3.0
- **Validation:** Zod
- **Logging:** Winston + Morgan
- **Rate Limiting:** express-rate-limit

### AI/Python Microservice (`/ai-service`)
- **Framework:** FastAPI (Python)
- **OCR:** pytesseract + pdf2image + python-doctr
- **Tamper Detection:** imagehash + OpenCV + exifread
- **Interview Scoring:** DeepSeek API (`deepseek-chat` model)
- **RAG:** RAGFlow SDK integration
- **Auto-fill from docs:** spaCy NER + regex patterns for Indian documents (Aadhaar, PAN, passport)
- **Libraries:** pandas, numpy, scikit-learn (performance analytics), reportlab (PDF generation)

---

## DATABASE SCHEMA (Key Models)

### Core: Organization, User, Employee, Department, Designation
### Attendance: AttendanceRecord, Break, GPSTrailPoint, ProjectSiteCheckIn, Geofence, OfficeLocation
### Leave: LeaveType, LeaveBalance, LeaveRequest, Holiday
### Payroll: SalaryStructure, PayrollRun, PayrollRecord (Indian: EPF, ESI, PT, TDS)
### Recruitment: JobOpening, Application, InterviewScore, OfferLetter
### Other: Policy, Announcement, Asset, AssetAssignment, Document, AuditLog

---

## AUTHENTICATION & ROLES

### Roles:
- **SUPER_ADMIN** — Dev bypass mode, impersonate any role, system health, all data
- **ADMIN** — Full company config, manage HR accounts, all reports
- **HR** — Employee lifecycle, payroll, policies, recruitment, leave approvals
- **MANAGER** — Own team only: attendance, leaves, performance, job need posting
- **EMPLOYEE** — Own data only: attendance, leaves, payslips, policies, helpdesk
- **GUEST_INTERVIEWER** — Temporary token-based login for interview candidates only

---

## 3 ATTENDANCE MODES

### Mode 1: OFFICE (Geofence Auto-Attendance)
- Phone/browser enters Mapbox geofence → automatic check-in
- Exit geofence → automatic check-out
- Multiple office locations with different geofences
- GPS poll interval configurable (default 2 min)

### Mode 2: FIELD_SALES (GPS Trail with Visit Clustering)
- Manual check-in at start of day
- GPS pings every 60 seconds
- Visit Clustering: 200m radius, >10 minutes = "Visit Stop"
- Auto-label stops, heatmap view, offline resilient (IndexedDB)

### Mode 3: PROJECT_SITE (Flexible Site Check-in)
- No geofence — project sites are temporary
- Photo capture with site background
- GPS coordinates + notes
- Multiple site visits per day

---

## SELF-ONBOARDING PORTAL (7 Steps)
1. Email Verification & Password Setup
2. Personal Details (OCR auto-fill from Aadhaar/PAN)
3. Mandatory Documents Upload (checklist with OCR + tamper detection)
4. Photo Capture & Digital Signature
5. Bank Account Details
6. Emergency Contact
7. Review & Submit (confetti!)

Post-onboarding: Company Introduction Journey (welcome video, org chart, key contacts, SOPs, policies walkthrough)

---

## AI-POWERED RECRUITMENT
- DeepSeek for resume scoring (match score, strengths, gaps, suggested questions)
- Pipeline: Job Need → Posting → Applications → AI Screening → Interviews (Teams) → Offer → Joining
- Guest interviewer portal
- Kanban board for pipeline management
- Internship program with achievement levels (Bronze → Platinum)

---

## INDIAN PAYROLL COMPLIANCE
- EPF: 12% of basic (capped at 15,000)
- ESI: 0.75% employee + 3.25% employer (if gross <= 21,000)
- Professional Tax: State-wise slabs
- TDS: Monthly based on annual projection (Old/New regime)
- LOP deduction: (gross / workingDays) * lopDays
- Salary slip PDF generation

---

## MOBILE vs DESKTOP

### Mobile (< 768px):
- Bottom navigation (5 tabs: Home, Attendance, Leaves, Payslip, Profile)
- Big Check-In button with animated pulse
- Swipeable cards, bottom sheet modals
- Simplified calendar and card-based tables

### Desktop (>= 768px):
- Full sidebar + rich dashboards + data tables + maps
- All admin/HR features

---

## UI DESIGN PHILOSOPHY
- Monday.com-inspired layered depth
- Glassmorphism: `backdrop-blur-xl bg-white/10 border border-white/20`
- Luminance hierarchy: sidebar=darkest, content=medium, cards=lightest
- Framer Motion for all transitions
- Fonts: Sora (headings), DM Sans (body), JetBrains Mono (data)
- Color palette: Indigo/violet primary (#6366f1), semantic status colors
