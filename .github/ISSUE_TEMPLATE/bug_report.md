---
name: Bug report
about: Something isn't working the way it should
title: ""
labels: bug
assignees: ""
---

**Describe the bug**
A clear, concise description of what's wrong.

**To reproduce**
Exact steps, not "sometimes happens":
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen instead.

**Install method**
Docker Compose / Windows `.exe` / Debian `.deb` / local dev (no Docker)

**Environment**
- OS:
- Node version (if local dev):
- Docker version (if Docker install):
- Printer model + transport, if this is a printing bug (browser Print /
  Download PDF / Print via USB):

**Screenshots / logs**
If applicable. For a direct-USB printing bug, include `lsusb` and
`dmesg | grep -i usblp` output — see
[Troubleshooting](https://github.com/Raktim94/nodedr-pos#troubleshooting-linux-till).

**Is this a money-correctness bug?**
(e.g. a total that doesn't match line items, a return refunding more
than was paid, a due/loyalty balance drifting) — flag it here, these are
treated as high priority per `CONTRIBUTING.md`.

**Additional context**
Anything else relevant.
