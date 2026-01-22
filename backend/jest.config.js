module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.js'],
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/**/__tests__/**'
    ],
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/__tests__/'
    ],
    coverageThreshold: {
        global: {
            branches: 60,
            functions: 60,
            lines: 60,
            statements: 60
        }
    },
    testTimeout: 10000,
    setupFilesAfterEnv: ['./__tests__/setup.js'],
    modulePathIgnorePatterns: ['<rootDir>/data/'],
    verbose: true
};
