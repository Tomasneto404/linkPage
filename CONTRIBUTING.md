# Contributing to linkPage

Thanks for your interest in improving linkPage! Contributions are welcome.

## Licensing of contributions

linkPage uses a dual-licensing / open-core model:

- The **core** (everything outside `ee/`) is licensed under the
  **GNU AGPL-3.0-or-later** (see [LICENSE](LICENSE) and [NOTICE](NOTICE)).
- The **Enterprise module** in `ee/` is proprietary (see [ee/LICENSE](ee/LICENSE)).

### Contributor License Agreement (required)

Because the project is also offered under a separate commercial licence, **all
pull requests require you to sign the Contributor License Agreement** before
they can be merged. The CLA grants the project owner a perpetual, worldwide,
royalty-free licence to your contribution **and the right to relicense it**
(including under commercial terms) — this is what makes the commercial-licence
option possible alongside the AGPL core.

Read and sign it here: **[CLA.md](CLA.md)**.

> The CLA is currently a **DRAFT pending legal review** — see the note at the
> top of `CLA.md`.

## Ground rules

- Add the SPDX header to any new source file. Running
  `bash scripts/add-license-headers.sh` will do this for you (it is idempotent
  and also runs in CI).
- Do not put AGPL-licensed contributions inside `ee/`, and do not copy `ee/`
  code into the core.
- Keep changes focused; describe the "why" in your PR description.
