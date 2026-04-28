export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white text-gray-800 px-6 py-12 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: April 28, 2026</p>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">1. Introduction</h2>
        <p>
          Aniston Technologies LLP ("we", "our", "us") operates the Aniston HRMS application. This
          policy explains how we collect, use, and protect personal information when you use our app.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">2. Information We Collect</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Employee profile information (name, email, phone, address, date of birth)</li>
          <li>Identity documents (Aadhaar, PAN card) for KYC verification</li>
          <li>Attendance data including GPS location (for field and project-site employees)</li>
          <li>Leave requests and approval records</li>
          <li>Payroll and salary information</li>
          <li>Device information and usage logs</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">3. How We Use Your Information</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>To manage employee attendance, leave, and payroll</li>
          <li>To verify identity through KYC document processing</li>
          <li>To track field employee locations during working hours only</li>
          <li>To send notifications and important HR communications</li>
          <li>To comply with Indian statutory requirements (EPF, ESI, TDS)</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">4. Data Sharing</h2>
        <p>
          We do not sell or share your personal data with third parties except as required by Indian
          law or statutory authorities (e.g., EPFO, ESIC, Income Tax Department).
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">5. Location Data</h2>
        <p>
          GPS location is collected only for employees assigned to Field Sales or Project Site
          attendance modes, and only during active work sessions. Location is not tracked outside
          working hours.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">6. Data Security</h2>
        <p>
          Sensitive data (Aadhaar, PAN, bank account details) is encrypted using AES-256-GCM
          encryption. All data is stored on secure servers and access is restricted by role-based
          access controls.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">7. Data Retention</h2>
        <p>
          Employee data is retained for the duration of employment and up to 7 years after, as
          required by Indian labour and tax laws. You may request deletion of non-statutory data by
          contacting HR.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">8. Your Rights</h2>
        <p>
          Employees may access, correct, or request deletion of their personal data by contacting
          the HR department. Requests will be processed within 30 days.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">9. Contact Us</h2>
        <p>
          For privacy-related queries, contact us at:{' '}
          <a href="mailto:anistondeveloperteam@gmail.com" className="text-indigo-600 underline">
            anistondeveloperteam@gmail.com
          </a>
        </p>
        <p className="mt-1">Aniston Technologies LLP, India</p>
      </section>
    </div>
  );
}
