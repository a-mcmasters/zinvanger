// GNU tar reads `C:\...` as remote host `C`. Set here, not in setupFiles, so child processes inherit it.
if (process.platform === 'win32') process.env.TAR_OPTIONS = '--force-local';

module.exports = {
    preset: 'ts-jest/presets/default-esm',
    extensionsToTreatAsEsm: ['.ts'],
    testEnvironment: 'node',
    setupFiles: ['<rootDir>/jest.setup.cjs'],
    testTimeout: 30_000,
    roots: ['<rootDir>/src', '<rootDir>/scripts'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', useESM: true }],
    },
};
