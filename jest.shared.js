/** Options every jest config shares (jest.config.js, jest.db.config.js and the OpenAPI configs); not a config itself. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testPathIgnorePatterns: ['/node_modules/'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: { allowJs: true } }],
  },
  testEnvironment: 'node',
  roots: ['<rootDir>/apps/', '<rootDir>/libs/', '<rootDir>/scripts/release/'],
  moduleNameMapper: {
    '^@libs/(common|database|auth|render|problems|judging|judge-proto|contests|community|settings)(|/.*)$':
      '<rootDir>/libs/$1/src$2',
  },
  testTimeout: 30000,
  transformIgnorePatterns: ['/node_modules/(?!@scalar/|github-slugger/)'],
};
