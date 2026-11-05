# SnailRace handoff

Run the club fundraiser's projector race, volunteer controls and optional phone participation.

## Work at 5 November 2026

Source baseline: [main at 1c1837a8](https://github.com/Sajeevanveeriah/SnailRace/commit/1c1837a8f979ee28cf8a1313e9929d33fe340d4e). Use the linked revision to distinguish these changes from later work.

- One codebase, one profile per club: ready for other clubs (5.7) (#62) ([1c1837a8](https://github.com/Sajeevanveeriah/SnailRace/commit/1c1837a8f979ee28cf8a1313e9929d33fe340d4e), 26 Oct 2026).
- Upgrade Next.js to 16.4.3 and patch vulnerable dependencies (#61) ([bff67ae2](https://github.com/Sajeevanveeriah/SnailRace/commit/bff67ae2cc8b4a339d5a87dc293923d3321a2c97), 26 Oct 2026).

## Resume here

Check the operator and projector views together. Use test mode for donations and an isolated race when checking replay and audit behaviour.

GitHub showed no open pull requests or issues at this revision. Check the [work queue](https://github.com/Sajeevanveeriah/SnailRace/pulls) and any local changes before choosing a task.

## Files and checks

[README.md](README.md), [docs/20261026-Club-Setup-Guide-Rev00.md](docs/20261026-Club-Setup-Guide-Rev00.md), [docs/20260830-Operator-Runbook-Rev01.md](docs/20260830-Operator-Runbook-Rev01.md), [cloudflare/README.md](cloudflare/README.md).

Local commands declared in [package.json](package.json): `npm run typecheck`, `npm run lint`, `npm run test`. Record the command and result against the revision tested.

Start with [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) for hosted check definitions. Confirm the run belongs to the commit under review.

At the source revision, GitHub reported success across 4 check or status entries. [View checks](https://github.com/Sajeevanveeriah/SnailRace/commit/1c1837a8f979ee28cf8a1313e9929d33fe340d4e/checks).

## Next handoff

When pausing, replace the dated snapshot with the active branch or revision, what changed, the checks actually run and their results, and the first unfinished action. Record any blocker or decision the next person needs. Keep private data and credentials out of this file.
