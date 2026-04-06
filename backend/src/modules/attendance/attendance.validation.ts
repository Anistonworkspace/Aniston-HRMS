import { z } from 'zod';

export const clockInSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy: z.number().optional(),
  source: z.enum(['GEOFENCE_AUTO', 'MANUAL_APP', 'MANUAL_HR', 'QR_CODE', 'BIOMETRIC']).default('MANUAL_APP'),
  notes: z.string().optional(),
  deviceType: z.enum(['mobile', 'desktop']).optional(),
  // For project site mode
  siteName: z.string().optional(),
  siteAddress: z.string().optional(),
  checkInPhoto: z.string().optional(),
});

export const clockOutSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy: z.number().optional(),
  notes: z.string().optional(),
  deviceType: z.enum(['mobile', 'desktop']).optional(),
});

export const gpsTrailBatchSchema = z.object({
  points: z.array(z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().optional(),
    altitude: z.number().optional(),
    speed: z.number().optional(),
    heading: z.number().optional(),
    batteryLevel: z.number().int().min(0).max(100).optional(),
    timestamp: z.string().datetime(),
  })).min(1).max(500),
});

export const regularizationSchema = z.object({
  attendanceId: z.string().uuid(),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
  requestedCheckIn: z.string().datetime().optional(),
  requestedCheckOut: z.string().datetime().optional(),
});

export const attendanceQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  department: z.string().optional(),
  status: z.string().optional(),
  workMode: z.string().optional(),
});

export const startBreakSchema = z.object({
  type: z.enum(['LUNCH', 'SHORT', 'PRAYER', 'CUSTOM']).default('SHORT'),
});

export const markAttendanceSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string().min(1, 'Date is required'),
  status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'WORK_FROM_HOME', 'HOLIDAY', 'WEEKEND']),
  workMode: z.enum(['OFFICE', 'FIELD_SALES', 'PROJECT_SITE', 'WORK_FROM_HOME']).optional(),
});

export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;
export type ClockInInput = z.infer<typeof clockInSchema>;
export type ClockOutInput = z.infer<typeof clockOutSchema>;
export type GPSTrailBatchInput = z.infer<typeof gpsTrailBatchSchema>;
export type RegularizationInput = z.infer<typeof regularizationSchema>;
export type AttendanceQuery = z.infer<typeof attendanceQuerySchema>;
