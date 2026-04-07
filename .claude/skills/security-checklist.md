# Security Audit Checklist — OWASP Top 10 + HRMS Specific

## Authentication Security
- [ ] Passwords hashed with bcrypt/argon2 (not MD5/SHA1)
- [ ] JWT secrets are strong (not 'secret' or 'password')
- [ ] JWT expiry is reasonable (not too long)
- [ ] Refresh tokens properly invalidated on logout
- [ ] Rate limiting on /login (prevent brute force)
- [ ] Account lockout after failed attempts
- [ ] MFA implementation uses standard TOTP (RFC 6238)

## Authorization Security
- [ ] Every endpoint checks authentication
- [ ] Every admin endpoint checks role (not just auth)
- [ ] IDOR: Can user A access user B's data by changing ID?
- [ ] Can EMPLOYEE role access HR/Admin endpoints?

## Data Security
- [ ] Sensitive data encrypted at rest (salary, bank details, Aadhaar)
- [ ] PAN numbers masked in responses
- [ ] Bank account numbers masked
- [ ] Passwords never returned in API responses
- [ ] No sensitive data in JWT payload

## Input Validation
- [ ] All user inputs validated server-side
- [ ] SQL injection prevention (parameterized queries / ORM)
- [ ] XSS prevention (output encoding in frontend)
- [ ] File upload validation (type, size, content)

## Session Security
- [ ] Tokens stored securely (not in plain cookies)
- [ ] CSRF protection
- [ ] Session invalidated on password change
- [ ] Concurrent session handling

## HRMS-Specific Risks
- [ ] Employee cannot view other employee's salary
- [ ] Employee cannot approve their own leave
- [ ] HR cannot modify SuperAdmin account
- [ ] GPS coordinates not stored beyond retention period
- [ ] Device binding prevents account sharing
