// Tests for OandaClient - API wrapper

// Store original env and set test values before requiring the module
const originalEnv = { ...process.env };

// Store original fetch
const originalFetch = global.fetch;

// Helper to create mock fetch responses
const createMockResponse = (data, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
    json: async () => data,
});

const createErrorResponse = (status, errorMessage) => ({
    ok: false,
    status,
    text: async () => JSON.stringify({ errorMessage }),
    json: async () => ({ errorMessage }),
});

const createHtmlErrorResponse = (status, body) => ({
    ok: false,
    status,
    headers: {
        get: (header) => (header.toLowerCase() === "content-type" ? "text/html" : null),
    },
    text: async () => body,
    json: async () => {
        throw new Error("HTML body is not JSON");
    },
});

describe('OandaClient', () => {
    let OandaClient;
    let client;
    const TEST_API_KEY = 'test-api-key-12345';
    const TEST_ACCOUNT_ID = '001-011-20128302-001';
    const BASE_URL = 'https://api-fxtrade.oanda.com';

    beforeAll(() => {
        // Set environment variables before requiring the module
        process.env.OANDA_API_KEY = TEST_API_KEY;
        process.env.OANDA_ACCOUNT_ID = TEST_ACCOUNT_ID;
        process.env.OANDA_ENVIRONMENT = 'live';
    });

    afterAll(() => {
        Object.keys(process.env).forEach(key => delete process.env[key]);
        Object.assign(process.env, originalEnv);
        global.fetch = originalFetch;
    });

    beforeEach(() => {
        // Clear module cache to get fresh instance
        jest.resetModules();

        // Default mock fetch - will be overridden in specific tests
        global.fetch = jest.fn();

        // Re-require the module to get fresh instance with env vars
        OandaClient = require('../Oandaclient');
        client = OandaClient;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Configuration', () => {
        test('should use live API URL for live environment', () => {
            expect(client.baseUrl).toBe('https://api-fxtrade.oanda.com');
        });

        test('should store API key and account ID', () => {
            expect(client.apiKey).toBe(TEST_API_KEY);
            expect(client.accountId).toBe(TEST_ACCOUNT_ID);
        });

        test('should not be initialized by default', () => {
            expect(client.isInitialized).toBe(false);
        });
    });

    describe('initialize', () => {
        test('should initialize successfully with valid credentials', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                account: {
                    id: TEST_ACCOUNT_ID,
                    balance: '136.00',
                    currency: 'AUD',
                },
            }));

            const result = await client.initialize();

            expect(result.account.id).toBe(TEST_ACCOUNT_ID);
            expect(client.isInitialized).toBe(true);
        });

        test('should throw error on API failure', async () => {
            global.fetch.mockResolvedValueOnce(createErrorResponse(401, 'Unauthorized'));

            await expect(client.initialize()).rejects.toThrow('Oanda API Error');
        });

        test('should summarize HTML API failures instead of surfacing the full page', async () => {
            global.fetch.mockResolvedValueOnce(createHtmlErrorResponse(
                525,
                '<html><body><div class="cf-error-details cf-error-525"><h1>SSL handshake failed</h1></div><p>'.concat(
                    'x'.repeat(2000),
                    '</p></body></html>'
                )
            ));

            await expect(client.initialize()).rejects.toThrow(
                'Oanda API Error (525): Cloudflare 525: SSL handshake failed'
            );
        });
    });

    describe('getAccountSummary', () => {
        test('should return account summary', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                account: {
                    id: TEST_ACCOUNT_ID,
                    currency: 'AUD',
                    balance: '136.00',
                    marginAvailable: '71.00',
                    marginUsed: '65.00',
                    unrealizedPL: '5.63',
                },
            }));

            const result = await client.getAccountSummary();

            expect(result.account.balance).toBe('136.00');
            expect(result.account.marginAvailable).toBe('71.00');
        });
    });

    describe('getPricing', () => {
        test('should return prices for instruments', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                prices: [
                    {
                        instrument: 'AUD_USD',
                        bids: [{ price: '1.16566', liquidity: 1000000 }],
                        asks: [{ price: '1.16576', liquidity: 1000000 }],
                        tradeable: true,
                    },
                    {
                        instrument: 'EUR_USD',
                        bids: [{ price: '1.08229', liquidity: 1000000 }],
                        asks: [{ price: '1.08239', liquidity: 1000000 }],
                        tradeable: true,
                    },
                ],
            }));

            const result = await client.getPricing(['AUD_USD', 'EUR_USD']);

            expect(result.prices).toHaveLength(2);
            expect(result.prices[0].instrument).toBe('AUD_USD');
        });
    });

    describe('getCandles', () => {
        test('should return candle data with default parameters', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                instrument: 'AUD_USD',
                granularity: 'M15',
                candles: [
                    {
                        complete: true,
                        volume: 100,
                        time: Date.now().toString(),
                        mid: { o: '1.16500', h: '1.16550', l: '1.16480', c: '1.16520' },
                    },
                ],
            }));

            const result = await client.getCandles('AUD_USD');

            expect(result.instrument).toBe('AUD_USD');
            expect(result.candles).toHaveLength(1);
        });

        test('should accept custom granularity and count', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                instrument: 'AUD_USD',
                granularity: 'H1',
                candles: [],
            }));

            const result = await client.getCandles('AUD_USD', 'H1', 100);

            expect(result.granularity).toBe('H1');
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('granularity=H1'),
                expect.any(Object)
            );
        });
    });

    describe('placeMarketOrder', () => {
        test('should place market order with stop loss', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                orderCreateTransaction: {
                    type: 'MARKET_ORDER',
                    instrument: 'AUD_USD',
                    units: '795',
                },
                orderFillTransaction: {
                    id: '501',
                    type: 'ORDER_FILL',
                    instrument: 'AUD_USD',
                    units: '795',
                    price: '1.16571',
                    tradeOpened: {
                        tradeID: '489',
                        units: '795',
                        price: '1.16571',
                        initialMarginRequired: '46.17',
                    },
                },
            }, 201));

            const result = await client.placeMarketOrder('AUD_USD', 795, {
                stopLossPrice: 1.16320,
            });

            expect(result.orderFillTransaction).toBeDefined();
            expect(result.orderFillTransaction.tradeOpened.tradeID).toBe('489');
        });

        test('should place market order with take profit', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                orderFillTransaction: {
                    id: '501',
                    instrument: 'AUD_USD',
                    units: '795',
                    price: '1.16571',
                    tradeOpened: { tradeID: '489' },
                },
            }, 201));

            const result = await client.placeMarketOrder('AUD_USD', 795, {
                stopLossPrice: 1.16320,
                takeProfitPrice: 1.16918,
            });

            expect(result.orderFillTransaction).toBeDefined();
        });

        test('should handle negative units for sell orders', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                orderFillTransaction: {
                    instrument: 'AUD_USD',
                    units: '-795',
                    price: '1.16571',
                    tradeOpened: { tradeID: '490' },
                },
            }, 201));

            const result = await client.placeMarketOrder('AUD_USD', -795);

            expect(result.orderFillTransaction.units).toBe('-795');
        });
    });

    describe('closeTrade', () => {
        test('should close trade fully', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                orderFillTransaction: {
                    instrument: 'AUD_USD',
                    units: '-795',
                    price: '1.16784',
                    pl: '2.50',
                    financing: '-0.02',
                    tradesClosed: [
                        {
                            tradeID: '489',
                            units: '-795',
                            realizedPL: '2.50',
                        },
                    ],
                },
            }));

            const result = await client.closeTrade('489');

            expect(result.orderFillTransaction.pl).toBe('2.50');
            expect(result.orderFillTransaction.tradesClosed[0].tradeID).toBe('489');
        });

        test('should close trade partially', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                orderFillTransaction: {
                    units: '-400',
                    price: '1.16784',
                    pl: '1.25',
                },
            }));

            const result = await client.closeTrade('489', 400);

            expect(result.orderFillTransaction.units).toBe('-400');
        });
    });

    describe('modifyTrade', () => {
        test('should modify stop loss', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                stopLossOrderTransaction: {
                    id: '502',
                    tradeID: '489',
                    price: '1.16400',
                },
            }));

            const result = await client.modifyTrade('489', {
                stopLossPrice: 1.164,
            });

            expect(result.stopLossOrderTransaction).toBeDefined();
        });

        test('should modify take profit', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                takeProfitOrderTransaction: {
                    id: '503',
                    tradeID: '489',
                    price: '1.16918',
                },
            }));

            const result = await client.modifyTrade('489', {
                takeProfitPrice: 1.16918,
            });

            expect(result.takeProfitOrderTransaction).toBeDefined();
        });

        test('should remove stop loss when set to null', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                stopLossOrderCancelTransaction: {
                    type: 'STOP_LOSS_ORDER_CANCEL',
                },
            }));

            const result = await client.modifyTrade('489', {
                stopLossPrice: null,
            });

            expect(result).toBeDefined();
        });
    });

    describe('getOpenTrades', () => {
        test('should return open trades', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                trades: [
                    {
                        id: '489',
                        instrument: 'AUD_USD',
                        price: '1.16571',
                        currentUnits: '795',
                        state: 'OPEN',
                    },
                ],
            }));

            const result = await client.getOpenTrades();

            expect(result.trades).toHaveLength(1);
            expect(result.trades[0].id).toBe('489');
        });

        test('should return empty array when no open trades', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({ trades: [] }));

            const result = await client.getOpenTrades();

            expect(result.trades).toHaveLength(0);
        });
    });

    describe('getTrade', () => {
        test('should return specific trade details', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                trade: {
                    id: '489',
                    instrument: 'AUD_USD',
                    price: '1.16571',
                    currentUnits: '795',
                    state: 'OPEN',
                    unrealizedPL: '2.50',
                },
            }));

            const result = await client.getTrade('489');

            expect(result.trade.id).toBe('489');
            expect(result.trade.unrealizedPL).toBe('2.50');
        });
    });

    describe('getPositions', () => {
        test('should return all positions', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({
                positions: [
                    {
                        instrument: 'AUD_USD',
                        long: {
                            units: '795',
                            averagePrice: '1.16571',
                            unrealizedPL: '2.50',
                        },
                        short: { units: '0' },
                    },
                ],
            }));

            const result = await client.getPositions();

            expect(result.positions).toHaveLength(1);
            expect(result.positions[0].instrument).toBe('AUD_USD');
        });
    });

    describe('Utility Methods', () => {
        describe('getPipValue', () => {
            test('should return 0.0001 for non-JPY pairs', () => {
                expect(client.getPipValue('AUD_USD')).toBe(0.0001);
                expect(client.getPipValue('EUR_USD')).toBe(0.0001);
                expect(client.getPipValue('GBP_USD')).toBe(0.0001);
            });

            test('should return 0.01 for JPY pairs', () => {
                expect(client.getPipValue('USD_JPY')).toBe(0.01);
                expect(client.getPipValue('EUR_JPY')).toBe(0.01);
                expect(client.getPipValue('GBP_JPY')).toBe(0.01);
            });
        });

        describe('pipsToPrice', () => {
            test('should convert pips to price correctly', () => {
                const result = client.pipsToPrice(10, 'AUD_USD');
                expect(result).toBeCloseTo(0.001, 5);
            });

            test('should convert pips to price for JPY pairs', () => {
                const result = client.pipsToPrice(10, 'USD_JPY');
                expect(result).toBeCloseTo(0.1, 3);
            });
        });

        describe('priceToPips', () => {
            test('should convert price to pips correctly', () => {
                const result = client.priceToPips(0.001, 'AUD_USD');
                expect(result).toBeCloseTo(10, 1);
            });

            test('should convert price to pips for JPY pairs', () => {
                const result = client.priceToPips(0.1, 'USD_JPY');
                expect(result).toBeCloseTo(10, 1);
            });
        });

        describe('calculatePositionSize', () => {
            test('should calculate position size based on risk', () => {
                const accountBalance = 1000;
                const riskPercent = 0.02; // 2%
                const stopLossPips = 20;
                const instrument = 'AUD_USD';
                const currentPrice = 1.16571;

                const units = client.calculatePositionSize(
                    accountBalance,
                    riskPercent,
                    stopLossPips,
                    instrument,
                    currentPrice
                );

                expect(units).toBeGreaterThan(0);
                expect(Number.isInteger(units)).toBe(true);
            });

            test('should return smaller position for wider stop loss', () => {
                const accountBalance = 1000;
                const riskPercent = 0.02;
                const instrument = 'AUD_USD';
                const currentPrice = 1.16571;

                const unitsNarrowStop = client.calculatePositionSize(
                    accountBalance,
                    riskPercent,
                    10,
                    instrument,
                    currentPrice
                );

                const unitsWideStop = client.calculatePositionSize(
                    accountBalance,
                    riskPercent,
                    30,
                    instrument,
                    currentPrice
                );

                expect(unitsNarrowStop).toBeGreaterThan(unitsWideStop);
            });
        });

        describe('getStatus', () => {
            test('should return current status', () => {
                const status = client.getStatus();

                expect(status).toHaveProperty('isInitialized');
                expect(status).toHaveProperty('accountId', TEST_ACCOUNT_ID);
                expect(status).toHaveProperty('environment');
                expect(status).toHaveProperty('baseUrl');
            });
        });
    });

    describe('Error Handling', () => {
        test('should handle 401 unauthorized error', async () => {
            global.fetch.mockResolvedValueOnce(createErrorResponse(401, 'Invalid API key'));

            await expect(client.getAccountSummary()).rejects.toThrow('401');
        });

        test('should handle 404 not found error', async () => {
            global.fetch.mockResolvedValueOnce(createErrorResponse(404, 'Trade not found'));

            await expect(client.getTrade('99999')).rejects.toThrow('404');
        });

        test('should handle network errors', async () => {
            global.fetch.mockRejectedValueOnce(new Error('Network error'));

            await expect(client.getAccountSummary()).rejects.toThrow();
        });

        test('should handle malformed JSON response', async () => {
            global.fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                text: async () => 'not valid json',
                json: async () => { throw new SyntaxError('Unexpected token'); },
            });

            await expect(client.getAccountSummary()).rejects.toThrow();
        });
    });

    describe('Request Headers', () => {
        test('should include authorization header', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({ account: {} }));

            await client.getAccountSummary();

            expect(global.fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: `Bearer ${TEST_API_KEY}`,
                    }),
                })
            );
        });

        test('should include content-type header', async () => {
            global.fetch.mockResolvedValueOnce(createMockResponse({ account: {} }));

            await client.getAccountSummary();

            expect(global.fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                    }),
                })
            );
        });
    });
});
