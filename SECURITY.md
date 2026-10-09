# Security policy

## Reporting a vulnerability

Do not open a public issue for an unpatched vulnerability or exposed
credential. Use GitHub's private vulnerability reporting for this repository:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include affected versions, reproduction steps, impact, and any proposed
   mitigation.

If private reporting is not enabled, contact the repository owner privately
before disclosing details.

## Supported versions

Until the first public release, only the current default branch is supported.
After release, the latest published version receives security fixes; older
versions may be asked to upgrade.

## Credentials

Runtime credentials belong outside the repository. Direct gateway routes
should use environment variables or owner-only key files, never inline keys in
tracked configuration.
