const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const Database = require("better-sqlite3");
const { checkpointWal, cancelWalCheckpoints } = require("../checkpointWal");

describe("background WAL checkpoint", () => {
    let directory;
    let filename;
    let writer;
    let reader;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "forex-checkpoint-"));
        filename = path.join(directory, "history.db");
        writer = new Database(filename);
        writer.pragma("journal_mode = WAL");
        writer.pragma("wal_autocheckpoint = 0");
        writer.exec("CREATE TABLE trades (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO trades VALUES (1, 'preserved')");
    });
    afterEach(() => {
        jest.restoreAllMocks();
        if (reader?.open) reader.close();
        if (writer?.open) writer.close();
        reader = null;
        fs.rmSync(directory, { recursive: true, force: true });
    });

    test("a held reader defers truncation without blocking timers; later checkpoint preserves data", async () => {
        reader = new Database(filename);
        reader.exec("BEGIN");
        reader.prepare("SELECT * FROM trades").all();
        writer.exec("INSERT INTO trades VALUES (2, 'also preserved')");
        let completed = false;
        const pending = checkpointWal(filename, { busyTimeoutMs: 250 });
        pending.finally(() => { completed = true; });
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(completed).toBe(false);
        const blocked = await pending;
        expect(blocked.busy).toBe(1);
        expect(fs.statSync(filename + "-wal").size).toBeGreaterThan(0);

        reader.exec("ROLLBACK");
        expect(await checkpointWal(filename)).toEqual({ busy: 0, log: 0, checkpointed: 0 });
        expect(fs.statSync(filename + "-wal").size).toBe(0);
        expect(writer.prepare("SELECT value FROM trades ORDER BY id").all()).toEqual([
            { value: "preserved" }, { value: "also preserved" },
        ]);
        expect(writer.pragma("quick_check", { simple: true })).toBe("ok");
    });

    test("overlapping requests share one bounded child and do not pass app credentials", async () => {
        const exec = jest.spyOn(childProcess, "execFile");
        const first = checkpointWal(filename);
        const second = checkpointWal(filename);
        expect(first).toBe(second);
        await expect(first).resolves.toMatchObject({ busy: 0 });
        expect(exec).toHaveBeenCalledTimes(1);
        const [runtime, args, options] = exec.mock.calls[0];
        expect(runtime).toBe(process.execPath);
        expect(args[1]).toBe(filename);
        expect(options.env).toEqual({ LANG: "C.UTF-8", LC_ALL: "C.UTF-8" });
    });

    test("the deadline kills a hung native-work substitute and permits a later run", async () => {
        const actualExecFile = childProcess.execFile;
        jest.spyOn(childProcess, "execFile").mockImplementationOnce((runtime, _args, options, callback) =>
            actualExecFile(runtime, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000)"], options, callback)
        );
        await expect(checkpointWal(filename, { timeoutMs: 100 })).rejects.toMatchObject({
            code: "WAL_CHECKPOINT_TIMEOUT",
        });
        await expect(checkpointWal(filename)).resolves.toMatchObject({ busy: 0 });
        expect(writer.pragma("quick_check", { simple: true })).toBe("ok");
    });

    test("a missing database is never created as a side effect", async () => {
        const missing = path.join(directory, "missing.db");
        await expect(checkpointWal(missing)).rejects.toMatchObject({ code: "WAL_CHECKPOINT_FAILED" });
        expect(fs.existsSync(missing)).toBe(false);
    });

    test("shutdown cancels a live child instead of leaving it without the parent's deadline", async () => {
        const actualExecFile = childProcess.execFile;
        jest.spyOn(childProcess, "execFile").mockImplementationOnce((runtime, _args, options, callback) =>
            actualExecFile(runtime, ["-e", "setInterval(()=>{},1000)"], options, callback)
        );
        const pending = checkpointWal(filename);
        cancelWalCheckpoints();
        await expect(pending).rejects.toMatchObject({ code: "WAL_CHECKPOINT_CANCELLED" });
        await expect(checkpointWal(filename)).resolves.toMatchObject({ busy: 0 });
    });

    test("a competing checkpointer with unavailable frame counts is a normal deferral", async () => {
        jest.spyOn(childProcess, "execFile").mockImplementation((_runtime, _args, _options, callback) => {
            queueMicrotask(() => callback(null, '{"busy":1,"log":-1,"checkpointed":-1}', ""));
        });
        await expect(checkpointWal(filename)).resolves.toEqual({ busy: 1, log: -1, checkpointed: -1 });
    });

    test.each(["", "null", "{}", '{"busy":0,"log":-1,"checkpointed":-1}'])
    ("missing or invalid child output cannot be reported as success: %s", async (output) => {
        jest.spyOn(childProcess, "execFile").mockImplementation((_runtime, _args, _options, callback) => {
            queueMicrotask(() => callback(null, output, ""));
        });
        await expect(checkpointWal(filename)).rejects.toThrow("no valid result");
    });
});
