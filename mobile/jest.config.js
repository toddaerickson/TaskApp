/** Jest for pure-function mobile libs only. Covers lib/progress.ts etc.
 * We stay out of React Native land to avoid dragging in the Expo/RN test
 * setup, which is heavy and orthogonal to the logic we actually need to test.
 */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest', {
      jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2022' },
    }],
  },
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
