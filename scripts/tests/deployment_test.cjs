'use strict';
// Isolated command boundaries only: no SSH, Git mutations, npm installs or PM2.
const { test } = require('node:test');
const { assert, fs, path, SCRIPTS, cleanEnv, write, shell, nodeStub, run, ok, read, json, lines, temporary } = require('./test_helpers.cjs');
const has = (rows, value) => rows.some((row) => JSON.stringify(row) === JSON.stringify(value));
const index = (rows, value) => rows.findIndex((row) => JSON.stringify(row) === JSON.stringify(value));

test('maintenance runtime prevents native install interpreter fallback on fresh and reused loads', (t) => {
    const root = temporary('forex-node-runtime-test-');
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const loaded of ['', '1']) {
        const result = run('bash', ['-c', 'source "$1"; printf "%s" "$NODE_GYP_FORCE_PYTHON"', 'runtime-test', path.join(SCRIPTS, 'load-node-runtime.sh')], {
            env: cleanEnv({ PATH: path.dirname(process.execPath) + ':' + process.env.PATH, NVM_DIR: root,
                NPM_GLOBAL_BIN: root, FOREX_NODE_RUNTIME_LOADED: loaded, NODE_GYP_FORCE_PYTHON: 'unwanted-interpreter' })
        });
        ok(result);
        assert.equal(result.stdout, '/usr/bin/false');
    }
});

function deployment(t) {
    const root = temporary('forex-deploy-test-'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const project = path.join(root, 'production'), stage = path.join(root, 'release'), backups = path.join(root, 'backups'), bin = path.join(root, 'bin');
    for (const relative of ['production/backend/node_modules','production/frontend/dist','production/scripts','release/backend','release/frontend','release/scripts','backups','bin']) fs.mkdirSync(path.join(root, relative), { recursive: true });
    write(path.join(project, 'backend/node_modules/original.txt'), 'old dependencies'); write(path.join(project, 'frontend/dist/index.html'), 'old dashboard');
    const statePath = path.join(root, 'state.json'); write(statePath, JSON.stringify({ head: 'old-revision', enabled: true, running: true, guards: 0 }));
    for (const name of ['ssh','git','flock','npm','pm2','sleep','fixture-command']) nodeStub(path.join(bin, name), `require(${JSON.stringify(path.join(__dirname, 'deployment_command_fixture.cjs'))});`);
    fs.copyFileSync(path.join(SCRIPTS, 'deploy-release.sh'), path.join(stage, 'scripts/deploy-release.sh'));
    fs.copyFileSync(path.join(SCRIPTS, 'maintenance-tools.cjs'), path.join(stage, 'scripts/maintenance-tools.cjs'));
    const helper = (name, body) => shell(path.join(stage, 'scripts', name), body);
    helper('load-node-runtime.sh', ':');
    helper('load-maintenance-api.sh', 'forex_api_curl() { fixture-command api "$@"; }\nforex_require_paused_flat_running() { fixture-command guard; }');
    helper('deployment-lock.sh', 'forex_acquire_deployment_lock() { exec 9>"$1"; export FOREX_DEPLOY_LOCK_FD=9; fixture-command lock "$@"; }');
    helper('backup.sh', 'fixture-command backup "$@"'); helper('health-check.sh', 'fixture-command health "$@"');
    const env = cleanEnv({ PATH: bin + ':' + path.dirname(process.execPath) + ':' + process.env.PATH, TEST_ROOT: root, FOREX_PROJECT_DIR: project, FOREX_BACKUP_DIR: backups,
        FOREX_DEPLOY_REVISION: 'new-revision', FOREX_DEPLOY_EXPECTED_HEAD: 'old-revision' });
    const script = (file, args = [], extra = {}) => run('bash', [file, ...args], { env: { ...env, ...extra } });
    const state = (changes) => { const value = json(statePath); if (changes) { Object.assign(value, changes); write(statePath, JSON.stringify(value)); } return value; };
    const calls = () => lines(path.join(root, 'calls.jsonl'));
    const oldInstall = () => { assert.equal(state().head, 'old-revision'); assert.equal(read(path.join(project, 'backend/node_modules/original.txt')), 'old dependencies'); assert.equal(read(path.join(project, 'frontend/dist/index.html')), 'old dashboard'); };
    return { root, project, stage, backups, helper, script, state, calls, oldInstall,
        release: (extra = {}) => script(path.join(stage, 'scripts/deploy-release.sh'), [], extra),
        bootstrap: (extra = {}) => script(path.join(SCRIPTS, 'deploy-remote.sh'), [project, 'main'], { ARCHIVE_SOURCE: stage, ...extra }),
        retained: () => fs.readdirSync(backups).filter((name) => name.startsWith('.deploy-stage.')).map((name) => path.join(backups, name)) };
}
function dtest(name, body) { test(name, (t) => body(deployment(t))); }
dtest('launcher transports bootstrap and quotes remote arguments', (f) => {
    ok(f.script(path.join(SCRIPTS, 'deploy.sh'), [], { FOREX_BRANCH: 'release/review-1' }));
    assert.equal(f.calls().length, 1); const call = f.calls()[0];
    assert.deepEqual(call.slice(0, 3), ['ssh','adam@img.oakroad',`bash -s -- '${f.project}' 'release/review-1'`]); assert.equal(call[3], read(path.join(SCRIPTS, 'deploy-remote.sh')));
});
dtest('launcher rejects injection and option arguments before SSH', (f) => {
    for (const [key, value] of [['FOREX_DEPLOY_HOST','-oProxyCommand=bad'],['FOREX_DEPLOY_HOST','host;bad'],['FOREX_PROJECT_DIR',"/opt/app';bad;#"],['FOREX_PROJECT_DIR','/opt/../app'],['FOREX_BRANCH','main$(bad)'],['FOREX_BRANCH',"main'bad"]]) { assert.notEqual(f.script(path.join(SCRIPTS, 'deploy.sh'), [], { [key]: value }).status, 0); assert.deepEqual(f.calls(), []); }
});
dtest('bootstrap uses pinned archive when old checkout has no helpers', (f) => {
    f.helper('deploy-release.sh', 'fixture-command bootstrap-runner'); ok(f.bootstrap()); assert.deepEqual(fs.readdirSync(path.join(f.project, 'scripts')), []);
    assert(has(f.calls(), ['git','archive','new-revision'])); assert(f.calls().some((row) => has([row.slice(0, 3)], ['bootstrap-runner','new-revision','old-revision']))); assert.deepEqual(f.retained(), []);
});
dtest('bootstrap repeats archive runner at same revision', (f) => { f.state({ head: 'new-revision' }); f.helper('deploy-release.sh', 'fixture-command bootstrap-runner'); ok(f.bootstrap()); ok(f.bootstrap()); assert.equal(f.calls().filter((row) => row[0] === 'bootstrap-runner').length, 2); });
dtest('bootstrap keeps recovery stage only after failed cutover', (f) => {
    for (const cutover of [false, true]) {
        f.helper('deploy-release.sh', (cutover ? 'touch "$(dirname "$0")/../.cutover-started"\n' : '') + 'fixture-command bootstrap-runner');
        const result = f.bootstrap({ FAIL_AT: 'bootstrap-runner' }); assert.notEqual(result.status, 0); assert.equal(f.retained().length, Number(cutover)); assert(has(f.calls(), ['flock','-u','9']));
        if (cutover) { assert(result.stderr.includes(f.retained()[0])); assert(fs.existsSync(path.join(f.retained()[0], '.cutover-started'))); }
    }
});
dtest('non fast forward is rejected before archive or runner', (f) => { assert.notEqual(f.bootstrap({ FAIL_AT: 'not-fast-forward' }).status, 0); assert(!f.calls().some((row) => has([row.slice(0, 2)], ['git','archive']) || row[0] === 'bootstrap-runner')); });
dtest('bootstrap contention and dirty checkout do not fetch or pause', (f) => { for (const extra of [{ LOCK_BUSY: '1' },{ DIRTY: '1' }]) assert.notEqual(f.bootstrap(extra).status, 0); assert(!f.calls().some((row) => has([row.slice(0, 2)], ['git','fetch']) || row[0] === 'api')); });
dtest('success gates cutover and restores enabled only after health', (f) => {
    ok(f.release(Object.fromEntries(['OANDA_API_KEY','OANDA_ACCOUNT_ID','OANDA_ENVIRONMENT','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','EMAIL_PASS','SMTP_PASSWORD'].map((key) => [key, 'fixture-only']))));
    const milestones = [['api','trading/stop'],['guard',1],['npm','backend','test','--','--runInBand'],['npm','frontend','run','build'],['backup','1'],['guard',2],['pm2','stop','forex-backend','--silent'],['git','merge','--ff-only','new-revision'],['npm','backend','run','db:migrate'],['pm2','start','ecosystem.config.js','--env','production'],['health'],['api','trading/start']];
    const indices = milestones.map((event) => index(f.calls(), event)); assert(indices.every((value) => value >= 0)); assert.deepEqual(indices, [...indices].sort((a,b) => a-b));
    assert.deepEqual(Object.fromEntries(['head','enabled','running'].map((key) => [key, f.state()[key]])), { head: 'new-revision', enabled: true, running: true });
    assert.equal(read(path.join(f.project, 'frontend/dist/index.html')), 'new dashboard'); assert(fs.existsSync(path.join(f.project, 'backend/node_modules/prepared.txt')));
});
dtest('deployment needs no operator token or credential provisioning', (f) => { const result = f.release(); ok(result); assert(!fs.existsSync(path.join(f.project, '.keys'))); assert(!fs.existsSync(path.join(f.project, '.secrets'))); assert(!f.calls().some((row) => row[0] === 'setup')); assert(!result.stdout.toLowerCase().includes('login token')); assert.equal(f.state().enabled, true); });
dtest('same revision still tests builds backs up and checks health', (f) => { f.state({ head: 'new-revision' }); ok(f.release({ FOREX_DEPLOY_EXPECTED_HEAD: 'new-revision' })); for (const row of [['npm','backend','test','--','--runInBand'],['npm','frontend','run','build'],['backup','1'],['health']]) assert(has(f.calls(), row)); });
dtest('preparation failures preserve install and previous enabled state', (f) => { for (const point of ['backend:ci --include=dev','backend:test -- --runInBand','frontend:run build','backup']) { assert.notEqual(f.release({ FAIL_AT: point }).status, 0); f.oldInstall(); assert.equal(f.state().enabled, true); assert.equal(f.state().running, true); assert(!f.calls().some((row) => has([row.slice(0, 2)], ['pm2','stop']))); } });
dtest('initially paused remains paused', (f) => { f.state({ enabled: false }); ok(f.release()); assert.equal(f.state().enabled, false); assert(!has(f.calls(), ['api','trading/start'])); });
dtest('restores enabled intent through actual activation during cooldown', (f) => { ok(f.release({ STUB_ACTUAL_ACTIVATION: '1', STUB_LAST_LOSS_AT: String(Date.now()-60000), MAINTENANCE_TEST_NODE: process.execPath, MAINTENANCE_TEST_API: path.join(__dirname, 'maintenance_api_fixture.cjs'), MAINTENANCE_TEST_PROJECT: f.project })); assert.equal(f.state().enabled, true); assert(has(f.calls(), ['actual-readiness','COOLDOWN',false])); assert(index(f.calls(), ['health']) < index(f.calls(), ['api','trading/start'])); });
dtest('flat guard defers without stopping management', (f) => { assert.notEqual(f.release({ NOT_FLAT: '1' }).status, 0); f.oldInstall(); assert.equal(f.state().running, true); assert.equal(f.state().enabled, true); assert(!f.calls().some((row) => ['pm2','npm','backup'].includes(row[0]))); });
dtest('late flat guard prevents cutover', (f) => { assert.notEqual(f.release({ LATE_NOT_FLAT: '1' }).status, 0); f.oldInstall(); assert.equal(f.state().running, true); assert(!f.calls().some((row) => has([row.slice(0,2)], ['pm2','stop']))); });
dtest('unknown trading state is not guessed', (f) => { assert.notEqual(f.release({ INVALID_STATE: '1' }).status, 0); f.oldInstall(); assert(!has(f.calls(), ['api','trading/stop'])); assert(!has(f.calls(), ['api','trading/start'])); });
dtest('lost pause response attempts restoration', (f) => { assert.notEqual(f.release({ FAIL_AT: 'pause-response' }).status, 0); f.oldInstall(); assert.equal(f.state().enabled, true); assert(has(f.calls(), ['api','trading/start'])); });
dtest('lost resume response resolves observed persisted state', (f) => { ok(f.release({ FAIL_AT: 'resume-response' })); assert.equal(f.state().enabled, true); assert.equal(f.calls().filter((row) => has([row], ['api','trading/start'])).length, 1); });
dtest('readiness rejection leaves successful release paused', (f) => { const result = f.release({ READINESS_BLOCKED: '1' }); assert.equal(result.status, 2, result.stdout+result.stderr); assert.equal(f.state().head, 'new-revision'); assert.equal(f.state().enabled, false); assert.equal(f.state().running, true); assert(has(f.calls(), ['health'])); });
dtest('post cutover failure never resumes entries', (f) => { assert.notEqual(f.release({ FAIL_AT: 'health' }).status, 0); assert.equal(f.state().enabled, false); assert(!has(f.calls(), ['api','trading/start'])); assert(has(f.calls(), ['pm2','stop','forex-backend','--silent'])); });

function maintenance(t) {
    const project = temporary('forex-maintenance-test-'); t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    const bin = path.join(project, 'bin'); fs.mkdirSync(bin); fs.mkdirSync(path.join(project, 'backend'));
    const env = cleanEnv({ FOREX_PROJECT_DIR: project, FOREX_NODE_RUNTIME_LOADED: '1', PATH: bin + ':' + path.dirname(process.execPath) + ':' + process.env.PATH });
    nodeStub(path.join(bin, 'node'), `const {assert,fs,path,run}=require(${JSON.stringify(path.join(__dirname,'test_helpers.cjs'))});\nconst args=process.argv.slice(2);\nif(args[0]!=='server.js'){const r=run(${JSON.stringify(process.execPath)},args,{input:fs.readFileSync(0)});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exit(r.status);}\nassert.deepEqual(args,['server.js']);assert.equal(process.env.OANDA_API_KEY,'fixture-broker-token');assert.equal(process.env.OANDA_ACCOUNT_ID,'001-002-003');assert.equal(process.env.OANDA_ENVIRONMENT,'practice');fs.writeFileSync(path.join(process.env.FOREX_PROJECT_DIR,'node-started.json'),JSON.stringify(args));`);
    const encrypt = (name, value) => { const key = path.join(project, '.keys/encryption.key'); write(key, 'disposable-fixture-encryption-key\n', 0o600); fs.chmodSync(key, 0o600); const out = path.join(project, '.secrets', name); fs.mkdirSync(path.dirname(out), { recursive: true }); ok(run('openssl', ['enc','-aes-256-cbc','-pbkdf2','-iter','100000','-salt','-pass','file:'+key,'-out',out], { input: value+'\n', timeout: 10000 })); };
    const broker = () => { for (const [name,value] of [['oanda_api_key.enc','fixture-broker-token'],['oanda_account_id.enc','001-002-003'],['oanda_environment.enc','practice']]) encrypt(name,value); };
    const command = (name, source) => nodeStub(path.join(bin, name), source);
    const legacy = () => command('curl', `const {assert,fs,path}=require(${JSON.stringify(path.join(__dirname,'test_helpers.cjs'))});const args=process.argv.slice(2);const authorized=args.includes('--config');if(authorized)assert.equal(fs.readFileSync(0,'utf8'),'header = "Authorization: Bearer '+'ab'.repeat(32)+'"\\n');assert(!args.some(x=>x.includes('Authorization:')));const root=process.env.FOREX_PROJECT_DIR;fs.appendFileSync(path.join(root,'api-calls.jsonl'),JSON.stringify({authorized,args})+'\\n');if(authorized){console.log('{"success":true}');process.exit(0);}const body=process.env.FIXTURE_FIRST_BODY??'discarded unauthenticated response';if(args.includes('--output')){fs.writeFileSync(args[args.indexOf('--output')+1],body);assert.equal(args[args.indexOf('--write-out')+1],'%{http_code}');process.stdout.write(process.env.FIXTURE_FIRST_HTTP??'401');}else process.stdout.write(body);process.exit(Number(process.env.FIXTURE_FIRST_EXIT??22));`);
    const mutation = (extra = {}) => run('bash', ['-c','source "$1"; forex_api_curl -X POST http://localhost:3101/api/trading/stop','maintenance-test',path.join(SCRIPTS,'load-maintenance-api.sh')], { env: { ...env, ...extra }, timeout: 10000 });
    return { project, command, encrypt, broker, legacy, mutation, calls: () => lines(path.join(project,'api-calls.jsonl')),
        wrapper: () => run('bash', [path.join(SCRIPTS,'start-wrapper.sh')], { env, cwd: path.join(project,'backend'), timeout: 10000 }),
        request: () => run('bash', ['-c','source "$1"; forex_api_curl http://localhost:3101/api/health','maintenance-test',path.join(SCRIPTS,'load-maintenance-api.sh')], { env, timeout: 10000 }) };
}
function mtest(name, body) { test(name, (t) => body(maintenance(t))); }
mtest('start wrapper loads broker credentials without operator files/token', (f) => { f.broker(); const result=f.wrapper(); ok(result); assert(fs.existsSync(path.join(f.project,'node-started.json'))); assert.deepEqual(fs.readdirSync(path.join(f.project,'.keys')), ['encryption.key']); assert.deepEqual(fs.readdirSync(path.join(f.project,'.secrets')).sort(), ['oanda_account_id.enc','oanda_api_key.enc','oanda_environment.enc']); assert(!(result.stdout+result.stderr).includes('fixture-broker-token')); });
mtest('retired invalid operator file does not block startup', (f) => { f.broker(); write(path.join(f.project,'.secrets/operator_token.enc'),'retired-invalid-ciphertext'); ok(f.wrapper()); assert(fs.existsSync(path.join(f.project,'node-started.json'))); });
mtest('plain maintenance API needs no credentials and keeps timeouts', (f) => { f.command('curl', `const {assert,fs,path}=require(${JSON.stringify(path.join(__dirname,'test_helpers.cjs'))});const a=process.argv.slice(2);assert(!a.some(x=>x.includes('Authorization:')));assert(!a.includes('--config'));assert.equal(a[a.indexOf('--connect-timeout')+1],'5');assert.equal(a[a.indexOf('--max-time')+1],'20');fs.writeFileSync(path.join(process.env.FOREX_PROJECT_DIR,'curl-called.json'),JSON.stringify(a));console.log('{"status":"ok"}');`); const result=f.request();ok(result);assert.deepEqual(JSON.parse(result.stdout),{status:'ok'});assert(fs.existsSync(path.join(f.project,'curl-called.json')));assert(!fs.existsSync(path.join(f.project,'.keys')));assert(!fs.existsSync(path.join(f.project,'.secrets'))); });
mtest('legacy upgrade retries only rejected 401 with saved credential', (f) => { f.encrypt('operator_token.enc','ab'.repeat(32)); const bytes=()=>Object.fromEntries(['.keys','.secrets'].flatMap(dir=>fs.readdirSync(path.join(f.project,dir)).map(name=>[dir+'/'+name,fs.readFileSync(path.join(f.project,dir,name))])));const before=bytes();f.legacy();const result=f.mutation({FOREX_DEPLOY_LEGACY_ACCESS:'1'});ok(result);assert.deepEqual(JSON.parse(result.stdout),{success:true});assert.deepEqual(f.calls().map(row=>row.authorized),[false,true]);assert.deepEqual(bytes(),before);assert(!(result.stdout+result.stderr+read(path.join(f.project,'api-calls.jsonl'))).includes('ab'.repeat(32))); });
mtest('legacy access never replays success or ambiguous mutation failures', (f) => { f.legacy();for(const [code,status] of [['200',0],['500',22],['403',22],['000',28],['401',28]]) {fs.rmSync(path.join(f.project,'api-calls.jsonl'),{force:true});const result=f.mutation({FOREX_DEPLOY_LEGACY_ACCESS:'1',FIXTURE_FIRST_HTTP:code,FIXTURE_FIRST_EXIT:String(status),FIXTURE_FIRST_BODY:'original response'});assert.equal(result.status,status,result.stdout+result.stderr);assert.equal(result.stdout,'original response');assert.deepEqual(f.calls().map(row=>row.authorized),[false]);assert(!fs.existsSync(path.join(f.project,'.keys')));assert(!fs.existsSync(path.join(f.project,'.secrets')));} });
mtest('legacy 401 without saved credential refuses provisioning', (f) => {f.legacy();const result=f.mutation({FOREX_DEPLOY_LEGACY_ACCESS:'1'});assert.notEqual(result.status,0);assert.deepEqual(f.calls().map(row=>row.authorized),[false]);assert(!fs.existsSync(path.join(f.project,'.keys')));assert(!fs.existsSync(path.join(f.project,'.secrets')));assert(!result.stdout.includes('discarded unauthenticated response'));});
mtest('normal maintenance never uses retired credential on 401', (f) => {f.encrypt('operator_token.enc','ab'.repeat(32));f.legacy();assert.equal(f.mutation().status,22);assert.deepEqual(f.calls().map(row=>row.authorized),[false]);});
