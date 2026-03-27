---
name: run-security-audit
description: Run the security auditor agent and output report
---

# Security Audit

1. Invoke the `security-auditor` agent on the entire codebase
2. Output the report to `docs/security-audit-{date}.md`
3. Print summary: count of CRITICAL / HIGH / MEDIUM / LOW findings
4. If any CRITICAL findings: warn that deployment should be blocked until fixed
