// Global test setup for Jest

// Silence console logs during tests unless debugging
if (process.env.DEBUG_TESTS !== 'true') {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});
}

// Mock the logger to avoid file I/O during tests
jest.mock('../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    success: jest.fn(),
}));

// Set test environment
process.env.NODE_ENV = 'test';

// Increase timeout for slower CI environments
jest.setTimeout(10000);

// Clean up after all tests
afterAll(async () => {
    // Allow async operations to complete
    await new Promise(resolve => setTimeout(resolve, 100));
});
