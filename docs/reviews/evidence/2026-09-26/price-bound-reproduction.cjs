// Run: node price-bound-reproduction.cjs /absolute/path/to/forex-trading-bot
// Uses the real broker order serializer with its HTTP method replaced. No broker
// credentials, dotenv, network, local trading database, or logger files required.
const assert = require('node:assert/strict');
const path = require('node:path');
const repo = process.argv[2] || process.cwd();
const loggerPath = path.join(repo, 'backend/src/utils/logger.js');
require.cache[require.resolve(loggerPath)] = {
    id: loggerPath, filename: loggerPath, loaded: true,
    exports: { warn() {}, info() {}, error() {}, success() {} },
};
delete process.env.OANDA_API_KEY;
delete process.env.OANDA_ACCOUNT_ID;
const client = require(path.join(repo, 'backend/src/services/Oandaclient.js'));
client.apiKey = undefined;
client.accountId = 'isolated-test';
let capturedOrder;
client._request = async (method, endpoint, body) => {
    assert.equal(method, 'POST');
    assert.equal(endpoint, '/v3/accounts/isolated-test/orders');
    capturedOrder = body.order;
    return { captured: true };
};
(async () => {
    const fixture = {
        brokerTradeId: '3435', instrument: 'AUD_USD', units: -162,
        priceBound: 0.700765, stopLossPrice: 0.70159,
        instrumentMetadata: { displayPrecision: 5 },
        quoteToAudRate: 1.44073721153, riskBudgetAud: 0.1925872,
        entryReferencePrice: 0.700915,
    };
    await client.placeMarketOrder(fixture.instrument, fixture.units, fixture);
    assert.equal(capturedOrder.priceBound, '0.70076');
    assert.equal(capturedOrder.stopLossOnFill.price, '0.70159');
    const risk = (bound) => Math.abs(bound - fixture.stopLossPrice) * Math.abs(fixture.units) * fixture.quoteToAudRate;
    const intendedRisk = risk(fixture.priceBound);
    const encodedRisk = risk(Number(capturedOrder.priceBound));
    assert.ok(intendedRisk < fixture.riskBudgetAud);
    assert.ok(encodedRisk > fixture.riskBudgetAud);
    console.log(JSON.stringify({
        brokerTradeId: fixture.brokerTradeId,
        passed: true,
        method: 'real OandaClient.placeMarketOrder, stubbed _request',
        intendedPriceBound: fixture.priceBound,
        serializedPriceBound: capturedOrder.priceBound,
        intendedWorstFillRiskAud: intendedRisk,
        serializedWorstFillRiskAud: encodedRisk,
        riskBudgetAud: fixture.riskBudgetAud,
        excessAud: encodedRisk - fixture.riskBudgetAud,
        intendedAdverseDeviationPips: (fixture.entryReferencePrice - fixture.priceBound) / 0.0001,
        serializedAdverseDeviationPips: (fixture.entryReferencePrice - Number(capturedOrder.priceBound)) / 0.0001,
        networkRequests: 0,
        actualFillRiskBreachObserved: false,
    }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
