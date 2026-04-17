/** Two-project jest config.
 *
 * `node-libs` — pure-function tests (pin, format, progress). Fast, no RN
 *   runtime. Stays exactly as it was before we added RN component tests.
 *
 * `rn-components` — React Native component tests that actually render
 *   (PinGate, login/register forms). Uses jest-expo preset so imports
 *   like `react-native` and `expo-*` resolve against the Expo SDK's
 *   jest mocks instead of failing at import time.
 *
 * Keeping them separate avoids paying the RN bootstrap cost for the 45
 * pure-function tests that never needed it.
 */
module.exports = {
  projects: [
    {
      displayName: 'node-libs',
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
    },
    {
      displayName: 'rn-components',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/__tests__/**/*.test.tsx'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
      },
      // jest-expo's default transformIgnorePatterns keeps our ESM RN deps
      // (expo-router, @react-navigation, etc.) correctly transformed.
    },
  ],
};
