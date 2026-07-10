const path = require("path");
const { execFileSync } = require("child_process");

describe("replayStrategy CLI", () => {
    test("prints useful help and exits successfully", () => {
        const script = path.resolve(__dirname, "../../../scripts/replayStrategy.js");
        const output = execFileSync(process.execPath, [script, "--help"], {
            encoding: "utf8",
        });

        expect(output).toContain("Usage: npm run replay");
        expect(output).toContain("--startingBalanceAud");
        expect(output).toContain("--registry");
    });
});
