import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Aniston HRMS database...');

  // Create organization
  const org = await prisma.organization.upsert({
    where: { slug: 'aniston' },
    update: {},
    create: {
      name: 'Aniston Technologies LLP',
      slug: 'aniston',
      timezone: 'Asia/Kolkata',
      fiscalYear: 'APRIL_MARCH',
      currency: 'INR',
      address: {
        line1: 'Aniston Technologies LLP',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110001',
        country: 'India',
      },
    },
  });

  console.log(`  ✅ Organization: ${org.name}`);

  // Create departments
  const departments = [
    { name: 'Engineering', description: 'Software Development & IT' },
    { name: 'Human Resources', description: 'People & Culture' },
    { name: 'Sales', description: 'Sales & Business Development' },
    { name: 'Marketing', description: 'Marketing & Communications' },
    { name: 'Finance', description: 'Accounting & Finance' },
    { name: 'Operations', description: 'Operations & Administration' },
    { name: 'Design', description: 'UI/UX & Product Design' },
    { name: 'Quality Assurance', description: 'Testing & QA' },
  ];

  for (const dept of departments) {
    await prisma.department.upsert({
      where: { name_organizationId: { name: dept.name, organizationId: org.id } },
      update: {},
      create: { ...dept, organizationId: org.id },
    });
  }
  console.log(`  ✅ Departments: ${departments.length} created`);

  // Create designations
  const designations = [
    { name: 'CEO', level: 1 },
    { name: 'CTO', level: 2 },
    { name: 'VP Engineering', level: 3 },
    { name: 'HR Director', level: 3 },
    { name: 'Engineering Manager', level: 4 },
    { name: 'HR Manager', level: 4 },
    { name: 'Sales Manager', level: 4 },
    { name: 'Senior Software Engineer', level: 5 },
    { name: 'Software Engineer', level: 6 },
    { name: 'Junior Software Engineer', level: 7 },
    { name: 'HR Executive', level: 6 },
    { name: 'Sales Executive', level: 6 },
    { name: 'Marketing Executive', level: 6 },
    { name: 'UI/UX Designer', level: 6 },
    { name: 'QA Engineer', level: 6 },
    { name: 'Intern', level: 8 },
  ];

  for (const desig of designations) {
    await prisma.designation.upsert({
      where: { name_organizationId: { name: desig.name, organizationId: org.id } },
      update: {},
      create: { ...desig, organizationId: org.id },
    });
  }
  console.log(`  ✅ Designations: ${designations.length} created`);

  // Create Super Admin
  const adminPassword = await bcrypt.hash('Superadmin@1234', 12);
  const adminUser = await prisma.user.upsert({
    where: { email: 'superadmin@anistonav.com' },
    update: {},
    create: {
      email: 'superadmin@anistonav.com',
      passwordHash: adminPassword,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      organizationId: org.id,
    },
  });

  const engDept = await prisma.department.findFirst({
    where: { name: 'Engineering', organizationId: org.id },
  });
  const ceoDes = await prisma.designation.findFirst({
    where: { name: 'CEO', organizationId: org.id },
  });

  await prisma.employee.upsert({
    where: { employeeCode: 'EMP-001' },
    update: {},
    create: {
      employeeCode: 'EMP-001',
      userId: adminUser.id,
      firstName: 'Super',
      lastName: 'Admin',
      email: 'superadmin@anistonav.com',
      phone: '+91-9999999999',
      gender: 'MALE',
      departmentId: engDept?.id,
      designationId: ceoDes?.id,
      workMode: 'OFFICE',
      joiningDate: new Date('2024-01-01'),
      status: 'ACTIVE',
      organizationId: org.id,
    },
  });
  console.log('  ✅ Super Admin: superadmin@anistonav.com / Superadmin@1234');

  // Create leave types
  const leaveTypes = [
    { name: 'Casual Leave', code: 'CL', defaultBalance: 12, isPaid: true },
    { name: 'Earned Leave', code: 'EL', defaultBalance: 12, isPaid: true, carryForward: true, maxCarryForward: 6 },
    { name: 'Sick Leave', code: 'SL', defaultBalance: 12, isPaid: true },
    { name: 'Maternity Leave', code: 'ML', defaultBalance: 182, isPaid: true, gender: 'FEMALE' as const },
    { name: 'Paternity Leave', code: 'PL', defaultBalance: 15, isPaid: true, gender: 'MALE' as const },
    { name: 'Leave Without Pay', code: 'LWP', defaultBalance: 0, isPaid: false },
    { name: 'Sabbatical Leave', code: 'SAB', defaultBalance: 0, isPaid: false },
  ];

  for (const lt of leaveTypes) {
    await prisma.leaveType.upsert({
      where: { code_organizationId: { code: lt.code, organizationId: org.id } },
      update: {},
      create: { ...lt, organizationId: org.id },
    });
  }
  console.log(`  ✅ Leave types: ${leaveTypes.length} created`);

  // Create holidays for 2026
  const holidays2026 = [
    { name: 'Republic Day', date: new Date('2026-01-26') },
    { name: 'Holi', date: new Date('2026-03-14') },
    { name: 'Good Friday', date: new Date('2026-04-03') },
    { name: 'Eid ul-Fitr', date: new Date('2026-03-20') },
    { name: 'Independence Day', date: new Date('2026-08-15') },
    { name: 'Ganesh Chaturthi', date: new Date('2026-08-27') },
    { name: 'Mahatma Gandhi Jayanti', date: new Date('2026-10-02') },
    { name: 'Dussehra', date: new Date('2026-10-02') },
    { name: 'Diwali', date: new Date('2026-10-20') },
    { name: 'Christmas', date: new Date('2026-12-25') },
  ];

  for (const holiday of holidays2026) {
    await prisma.holiday.upsert({
      where: { date_organizationId: { date: holiday.date, organizationId: org.id } },
      update: {},
      create: { ...holiday, organizationId: org.id },
    });
  }
  console.log(`  ✅ Holidays 2026: ${holidays2026.length} created`);

  console.log('\n🎉 Seed completed successfully!');
  console.log('\nLogin credentials:');
  console.log('  Super Admin: superadmin@anistonav.com / Superadmin@1234');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
