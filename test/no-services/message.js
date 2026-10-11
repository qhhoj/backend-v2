module.exports = (what) =>
  `${what} in a unit spec: specs that need MongoDB or Redis are *.db.spec.ts or *.e2e-spec.ts and run with npm run test:db (CONTRIBUTING.md, Testing)`;
