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
  const adminPassword = await bcrypt.hash('Admin@123456', 12);
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@aniston.in' },
    update: {},
    create: {
      email: 'admin@aniston.in',
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
      firstName: 'Aniston',
      lastName: 'Admin',
      email: 'admin@aniston.in',
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
  console.log('  ✅ Super Admin: admin@aniston.in / Admin@123456');

  // Create HR user
  const hrPassword = await bcrypt.hash('Hr@123456', 12);
  const hrUser = await prisma.user.upsert({
    where: { email: 'hr@aniston.in' },
    update: {},
    create: {
      email: 'hr@aniston.in',
      passwordHash: hrPassword,
      role: 'HR',
      status: 'ACTIVE',
      organizationId: org.id,
    },
  });

  const hrDept = await prisma.department.findFirst({
    where: { name: 'Human Resources', organizationId: org.id },
  });
  const hrDes = await prisma.designation.findFirst({
    where: { name: 'HR Manager', organizationId: org.id },
  });

  await prisma.employee.upsert({
    where: { employeeCode: 'EMP-002' },
    update: {},
    create: {
      employeeCode: 'EMP-002',
      userId: hrUser.id,
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'hr@aniston.in',
      phone: '+91-9888888888',
      gender: 'FEMALE',
      departmentId: hrDept?.id,
      designationId: hrDes?.id,
      workMode: 'OFFICE',
      joiningDate: new Date('2024-02-15'),
      status: 'ACTIVE',
      organizationId: org.id,
    },
  });
  console.log('  ✅ HR Manager: hr@aniston.in / Hr@123456');

  // Create sample employees
  const sampleEmployees = [
    { first: 'Rahul', last: 'Kumar', email: 'rahul@aniston.in', dept: 'Engineering', desig: 'Senior Software Engineer', role: 'EMPLOYEE' as const, workMode: 'OFFICE' as const, gender: 'MALE' as const },
    { first: 'Sneha', last: 'Patel', email: 'sneha@aniston.in', dept: 'Engineering', desig: 'Software Engineer', role: 'EMPLOYEE' as const, workMode: 'HYBRID' as const, gender: 'FEMALE' as const },
    { first: 'Amit', last: 'Singh', email: 'amit@aniston.in', dept: 'Sales', desig: 'Sales Manager', role: 'MANAGER' as const, workMode: 'FIELD_SALES' as const, gender: 'MALE' as const },
    { first: 'Kavya', last: 'Nair', email: 'kavya@aniston.in', dept: 'Design', desig: 'UI/UX Designer', role: 'EMPLOYEE' as const, workMode: 'REMOTE' as const, gender: 'FEMALE' as const },
    { first: 'Vikram', last: 'Reddy', email: 'vikram@aniston.in', dept: 'Engineering', desig: 'Engineering Manager', role: 'MANAGER' as const, workMode: 'OFFICE' as const, gender: 'MALE' as const },
    { first: 'Ananya', last: 'Gupta', email: 'ananya@aniston.in', dept: 'Marketing', desig: 'Marketing Executive', role: 'EMPLOYEE' as const, workMode: 'HYBRID' as const, gender: 'FEMALE' as const },
    { first: 'Rohan', last: 'Joshi', email: 'rohan@aniston.in', dept: 'Quality Assurance', desig: 'QA Engineer', role: 'EMPLOYEE' as const, workMode: 'OFFICE' as const, gender: 'MALE' as const },
    { first: 'Deepa', last: 'Menon', email: 'deepa@aniston.in', dept: 'Finance', desig: 'Marketing Executive', role: 'EMPLOYEE' as const, workMode: 'OFFICE' as const, gender: 'FEMALE' as const },
  ];

  let empCode = 3;
  for (const emp of sampleEmployees) {
    const password = await bcrypt.hash('Employee@123', 12);
    const dept = await prisma.department.findFirst({ where: { name: emp.dept, organizationId: org.id } });
    const desig = await prisma.designation.findFirst({ where: { name: emp.desig, organizationId: org.id } });
    const code = `EMP-${String(empCode).padStart(3, '0')}`;

    const existingUser = await prisma.user.findUnique({ where: { email: emp.email } });
    if (!existingUser) {
      const user = await prisma.user.create({
        data: {
          email: emp.email,
          passwordHash: password,
          role: emp.role,
          status: 'ACTIVE',
          organizationId: org.id,
        },
      });

      await prisma.employee.create({
        data: {
          employeeCode: code,
          userId: user.id,
          firstName: emp.first,
          lastName: emp.last,
          email: emp.email,
          phone: `+91-98${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
          gender: emp.gender,
          dateOfBirth: new Date(1990 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1),
          departmentId: dept?.id,
          designationId: desig?.id,
          workMode: emp.workMode,
          joiningDate: new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1),
          status: 'ACTIVE',
          organizationId: org.id,
        },
      });
    }
    empCode++;
  }
  console.log(`  ✅ Sample employees: ${sampleEmployees.length} created`);

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
  console.log('  Super Admin: admin@aniston.in / Admin@123456');
  console.log('  HR Manager:  hr@aniston.in / Hr@123456');
  console.log('  Employee:    rahul@aniston.in / Employee@123');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
