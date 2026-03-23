import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Aniston HRMS API',
      version: '1.0.0',
      description: 'Enterprise Human Resource Management System API — Aniston Technologies LLP',
      contact: {
        name: 'Aniston Technologies',
        email: 'dev@aniston.in',
      },
    },
    servers: [
      { url: '/api', description: 'API Base' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        ApiResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', nullable: true },
            error: {
              type: 'object',
              nullable: true,
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
            meta: { type: 'object', nullable: true },
          },
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' },
            totalPages: { type: 'integer' },
            hasNext: { type: 'boolean' },
            hasPrev: { type: 'boolean' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Authentication & authorization' },
      { name: 'Employees', description: 'Employee management' },
      { name: 'Attendance', description: 'Attendance tracking (3 modes)' },
      { name: 'Leaves', description: 'Leave management' },
      { name: 'Payroll', description: 'Indian payroll with EPF/ESI/TDS' },
      { name: 'Recruitment', description: 'Job openings, applications, Kanban pipeline' },
      { name: 'Walk-In', description: 'Walk-in candidate self-registration kiosk' },
      { name: 'Onboarding', description: 'Self-onboarding portal' },
      { name: 'Performance', description: 'Goals & performance reviews' },
      { name: 'Policies', description: 'HR policies & acknowledgments' },
      { name: 'Announcements', description: 'Announcements & social wall' },
      { name: 'Helpdesk', description: 'Support tickets' },
      { name: 'Reports', description: 'Analytics & report export' },
      { name: 'Documents', description: 'Document upload & verification' },
      { name: 'Assets', description: 'Asset management & assignment' },
      { name: 'Holidays', description: 'Holiday calendar' },
      { name: 'Settings', description: 'Organization settings' },
      { name: 'Dashboard', description: 'Dashboard statistics' },
    ],
  },
  apis: ['./src/modules/**/*.routes.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
