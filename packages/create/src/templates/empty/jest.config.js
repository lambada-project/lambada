module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  collectCoverage: false,
  setupFilesAfterEnv: ['./jest.setup.ts'],
  globalSetup: './jest.globalSetup.ts',
  globalTeardown: './jest.globalTeardown.ts',
  transform: {
    "^.+\\.(t|j)sx?$": "@swc/jest",
  },
};