'use strict';
// Restore orchestration against disposable real SQLite/tar fixtures and stubs.
const { test } = require('node:test');
const { assert, fs, path, SCRIPTS, NODE_MODULES, cleanEnv, write, shell, run, ok, read, json, temporary, database, unsafeArchive, archiveMembers, paxRecord } = require('./test_helpers.cjs');
const zlib = require('node:zlib');
const NativeDatabase = require(require.resolve('better-sqlite3', { paths: [NODE_MODULES] }));
function fixture(t) {
    const root = temporary('forex-restore-test-'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const project = path.join(root,'install/forex-trading-bot'), backups = path.join(root,'backups'), bin = path.join(root,'bin'), log = path.join(root,'calls.log');
    for(const dir of ['backend/data','scripts','.keys','.secrets']) fs.mkdirSync(path.join(project,dir),{recursive:true}); fs.mkdirSync(backups);fs.mkdirSync(bin);
    const config=path.join(project,'backend/data/trading_config.json');write(config,JSON.stringify({enableTrading:false,enforceConfigFreeze:true}));
    for(const relative of ['backend/package.json','backend/server.js','ecosystem.config.js','scripts/start-wrapper.sh','scripts/load-maintenance-api.sh']) write(path.join(project,relative),'{}\n');
    shell(path.join(project,'scripts/health-check.sh'),'exit 0'); write(path.join(project,'.keys/encryption.key'),'original-key');write(path.join(project,'.secrets/oanda_api_key.enc'),'original-broker-secret');
    const db=path.join(project,'backend/data/trading.db'); database(db,'CREATE TABLE trades(mode TEXT,is_open INT); CREATE TABLE strategy_runs(id INT); CREATE TABLE broker_order_intents(status TEXT); CREATE TABLE broker_position_quarantines(status TEXT);');
    const snapshot=path.join(backups,'trading_20990101_000000.db');fs.copyFileSync(db,snapshot);const archive=path.join(backups,'forex_backup_20990101_000000.tar.gz');
    const makeArchive=(format=null)=>ok(run('tar',[...(format?['--format='+format]:[]),'-czf',archive,'--exclude=.keys','--exclude=.secrets','--exclude=trading.db','-C',path.dirname(project),path.basename(project)],{env:cleanEnv({COPYFILE_DISABLE:'1'})}));
    makeArchive();
    shell(path.join(bin,'flock'),'exit 0');shell(path.join(bin,'sleep'),'exit 0');
    shell(path.join(bin,'npm'),'echo "npm $*" >> "$CALL_LOG"\nif [ "${QUEUE_BUSY_AFTER_NPM:-0}" = 1 ]; then touch "$CALL_LOG.queue-busy"; fi\n[ "${FAIL_NPM:-0}" != 1 ]');
    shell(path.join(bin,'pm2'),'echo "pm2 $*" >> "$CALL_LOG"\ncase "$1" in pid) echo "${PM2_PID:-1234}";; start) [ "${FAIL_START:-0}" != 1 ] || exit 1;; esac');
    shell(path.join(bin,'curl'),`echo "curl $*" >> "$CALL_LOG"
case "$*" in
 *'/summary'*) header=$(cat); case "$header" in *'Authorization: Bearer '*) ;; *) exit 99;; esac;;
 *) case "$*" in *'--config -'*|*'Authorization:'*) exit 99;; esac;;
esac
case "$*" in
 *'/summary'*) printf '{"account":{"openTradeCount":"%s","pendingOrderCount":"%s"}}' "\${OPEN_TRADES:-0}" "\${PENDING_ORDERS:-0}";;
 *'/engine/stats'*)
   [ "\${ENGINE_STATS_DOWN:-0}" != 1 ] || exit 22
   if [ -f "$CALL_LOG.queue-busy" ]; then printf '{"isProcessingQueue":true,"queueLength":0}';
   elif [ -n "\${ENGINE_STATS:-}" ]; then printf '%s' "$ENGINE_STATS";
   else printf '{"isProcessingQueue":false,"queueLength":0}'; fi;;
 *'/health'*) [ "\${API_DOWN:-0}" != 1 ] || exit 22; printf '{"config":{"enableTrading":%s}}' "\${API_ENABLED:-false}";;
 *) exit 98;;
esac`);
    const env=cleanEnv({PATH:bin+':'+path.dirname(process.execPath)+':'+process.env.PATH,FOREX_NODE_RUNTIME_LOADED:'1',FOREX_PROJECT_DIR:project,FOREX_BACKUP_DIR:backups,CALL_LOG:log,OANDA_API_KEY:'test-broker-token',OANDA_ACCOUNT_ID:'001-002-003',OANDA_ENVIRONMENT:'practice'});
    const restore=(extra={},source=archive,verify=false)=>run('bash',[path.join(SCRIPTS,'restore.sh'),source,...(verify?['--verify-only']:['--confirm','RESTORE'])],{env:{...env,...extra}});
    const calls=()=>fs.existsSync(log)?read(log):'';
    const notStopped=()=>{assert(!calls().includes('pm2 stop'));assert(fs.existsSync(path.join(project,'.keys/encryption.key')));};
    const rollback=()=>fs.readdirSync(path.dirname(project)).filter(name=>name.startsWith('forex-trading-bot.rollback.')).map(name=>path.join(path.dirname(project),name));
    const guard=(extra={})=>run('bash',['-c','source "$1"; forex_require_paused_flat_running','guard-test',path.join(SCRIPTS,'load-maintenance-api.sh')],{env:{...env,...extra},timeout:10000});
    return {root,project,backups,log,config,db,snapshot,archive,restore,calls,notStopped,rollback,guard,makeArchive,env};
}
function rtest(name,body){test(name,t=>body(fixture(t)));}
rtest('success preserves credentials original install and paused state',f=>{ok(f.restore());assert.equal(f.rollback().length,1);for(const location of [f.project,f.rollback()[0]]){assert.equal(read(path.join(location,'.secrets/oanda_api_key.enc')),'original-broker-secret');assert.equal(read(path.join(location,'.keys/encryption.key')),'original-key');}assert.equal(json(f.config).enableTrading,false);assert(!f.calls().includes('/trading/start'));assert(!f.calls().includes('test-broker-token'));});
rtest('database only restore uses current source',f=>{ok(f.restore({},f.snapshot));assert(fs.existsSync(path.join(f.project,'RESTORE_MANIFEST.json')));});
rtest('verify only never contacts broker or stops service',f=>{ok(f.restore({},f.archive,true));assert(!fs.existsSync(f.log));});
rtest('missing matched snapshot refuses newest fallback',f=>{fs.renameSync(f.snapshot,path.join(f.backups,'trading_unrelated.db'));assert.notEqual(f.restore().status,0);f.notStopped();});
rtest('corrupt snapshot rejected before stop',f=>{write(f.snapshot,'not SQLite');assert.notEqual(f.restore().status,0);f.notStopped();});
rtest('archive traversal and links rejected before stop',f=>{for(const [name,link] of [['../escape',false],['forex-trading-bot/link',true]]){unsafeArchive(f.archive,name,link);assert.notEqual(f.restore().status,0);f.notStopped();assert(!fs.existsSync(path.join(f.root,'escape')));}});
rtest('snapshot with open trade rejected before stop',f=>{database(f.snapshot,"INSERT INTO trades VALUES('live',1)");assert.notEqual(f.restore().status,0);f.notStopped();});
rtest('live enable or current ambiguity rejected',f=>{write(f.config,'{"enableTrading":true}');assert.notEqual(f.restore().status,0);f.notStopped();write(f.config,'{"enableTrading":false}');database(f.db,"INSERT INTO broker_order_intents VALUES('AMBIGUOUS')");assert.notEqual(f.restore().status,0);f.notStopped();});
rtest('broker pending or open blocks restore',f=>{for(const extra of [{PENDING_ORDERS:'1'},{OPEN_TRADES:'1'}]){assert.notEqual(f.restore(extra).status,0);f.notStopped();}});
rtest('preparation failure does not stop current runtime',f=>{assert.notEqual(f.restore({FAIL_NPM:'1'}).status,0);f.notStopped();});
rtest('busy malformed or unavailable queue blocks restore before broker',f=>{for(const extra of [{ENGINE_STATS:'{"isProcessingQueue":true,"queueLength":0}'},{ENGINE_STATS:'{"isProcessingQueue":false,"queueLength":1}'},{ENGINE_STATS:'{"isProcessingQueue":"false","queueLength":0}'},{ENGINE_STATS:'{"isProcessingQueue":false,"queueLength":false}'},{ENGINE_STATS:'{}'},{ENGINE_STATS:'invalid-json'},{ENGINE_STATS_DOWN:'1'}]){assert.notEqual(f.restore(extra).status,0);f.notStopped();assert(!f.calls().includes('/summary'));}});
rtest('entry queue rechecked after preparation',f=>{assert.notEqual(f.restore({QUEUE_BUSY_AFTER_NPM:'1'}).status,0);f.notStopped();assert.equal(f.calls().split('/engine/stats').length-1,2);});
rtest('cutover failure preserves original and never enables',f=>{const result=f.restore({FAIL_START:'1'});assert.notEqual(result.status,0);assert.equal(f.rollback().length,1);assert.equal(read(path.join(f.rollback()[0],'.secrets/oanda_api_key.enc')),'original-broker-secret');assert.equal(f.calls().split('pm2 start').length-1,1);assert(!f.calls().includes('/trading/start'));assert(result.stderr.includes('Runtime remains stopped'));});
rtest('stopped API recovery still requires direct broker flatness',f=>{assert.notEqual(f.restore({API_DOWN:'1',PM2_PID:'0',PENDING_ORDERS:'1'}).status,0);f.notStopped();});
rtest('cutover guard rechecks broker and API after preparation',f=>{ok(f.guard());for(const extra of [{OPEN_TRADES:'1'},{PENDING_ORDERS:'1'},{API_DOWN:'1'},{API_ENABLED:'true'},{ENGINE_STATS:'{"isProcessingQueue":true,"queueLength":0}'},{ENGINE_STATS:'{}'},{ENGINE_STATS_DOWN:'1'}])assert.notEqual(f.guard(extra).status,0);write(f.config,'{"enableTrading":true}');assert.notEqual(f.guard().status,0);f.notStopped();});

for (const format of ['gnu', 'pax', 'ustar']) rtest(`healthy ${format.toUpperCase()} archive retains actual extended long paths`, f => {
    const relative = format === 'ustar' ? path.join('backend', 'p'.repeat(110), 'fixture.json')
        : path.join('backend', 'long-path', (format === 'pax' ? 'λ'.repeat(80) : 'x'.repeat(150)) + '.json');
    const bytes = Buffer.from('long-path-fixture\0\xff', 'latin1'); write(path.join(f.project, relative), bytes);
    const tarFormat = format === 'gnu' && run('tar', ['--version']).stdout.includes('bsdtar') ? 'gnutar' : format;
    f.makeArchive(tarFormat);
    const stage = path.join(f.root, 'verified-long-stage'); fs.mkdirSync(stage);
    const result = run(process.execPath, [path.join(SCRIPTS,'restore-stage.cjs'),f.project,f.archive,stage], {env:f.env});
    ok(result); assert.deepEqual(fs.readFileSync(path.join(result.stdout.trim(), relative)), bytes);
    assert(!fs.existsSync(f.log));
});
rtest('corrupt tar checksum is rejected before source extraction or stop', f => {
    const raw = zlib.gunzipSync(fs.readFileSync(f.archive)); raw[0] ^= 1;
    fs.writeFileSync(f.archive,zlib.gzipSync(raw));
    const result=f.restore(); assert.notEqual(result.status,0); assert.match(result.stderr,/checksum/); f.notStopped();
    assert.deepEqual(fs.readdirSync(f.backups).filter(name=>name.startsWith('.restore-stage.')),[]);
});
rtest('immutable verification ignores WAL and does not touch snapshot or sidecars', f => {
    const writer = new NativeDatabase(f.snapshot);
    try {
        writer.pragma('journal_mode = WAL'); writer.pragma('wal_checkpoint(TRUNCATE)');
        writer.exec("INSERT INTO broker_order_intents VALUES('AMBIGUOUS')");
        const files=[f.snapshot,f.snapshot+'-wal',f.snapshot+'-shm'];
        const before=files.map(file=>({bytes:fs.readFileSync(file),mtime:fs.statSync(file).mtimeMs}));
        ok(run(process.execPath,[path.join(SCRIPTS,'restore-stage.cjs'),'--verify-db',f.snapshot],{env:f.env}));
        files.forEach((file,i)=>{assert.deepEqual(fs.readFileSync(file),before[i].bytes);assert.equal(fs.statSync(file).mtimeMs,before[i].mtime);});
        const result=f.restore({},f.snapshot,true);assert.notEqual(result.status,0);assert.match(result.stderr,/complete standalone SQLite snapshot/);f.notStopped();
    } finally { writer.close(); }
});
rtest('live readonly guard observes committed WAL ambiguity without changing main database', f => {
    const writer = new NativeDatabase(f.db);
    try {
        writer.pragma('journal_mode = WAL');writer.pragma('wal_checkpoint(TRUNCATE)');
        writer.exec("INSERT INTO broker_order_intents VALUES('AMBIGUOUS')");
        const before=fs.readFileSync(f.db),wal=fs.readFileSync(f.db+'-wal');
        const result=run(process.execPath,[path.join(SCRIPTS,'restore-safety.cjs'),f.project],{env:f.env});
        assert.notEqual(result.status,0);assert.match(result.stderr,/unresolved|uncertain|ambigu/i);
        assert.deepEqual(fs.readFileSync(f.db),before);assert.deepEqual(fs.readFileSync(f.db+'-wal'),wal);f.notStopped();
    } finally {writer.close();}
});
rtest('pre-install staged SQLite guard uses installed backend without NODE_PATH or staged modules', f => {
    const stage=path.join(f.root,'release');fs.mkdirSync(path.join(stage,'scripts'),{recursive:true});
    for(const name of ['restore-safety.cjs','maintenance-db.cjs'])fs.copyFileSync(path.join(SCRIPTS,name),path.join(stage,'scripts',name));
    fs.symlinkSync(NODE_MODULES,path.join(f.project,'backend/node_modules'),'dir');
    const env={...f.env};delete env.NODE_PATH;
    const command=[path.join(stage,'scripts/restore-safety.cjs'),f.project];
    ok(run(process.execPath,command,{env}));assert(!fs.existsSync(path.join(stage,'backend/node_modules')));
    database(f.db,"INSERT INTO broker_order_intents VALUES('AMBIGUOUS')");
    const result=run(process.execPath,command,{env});assert.notEqual(result.status,0);assert.match(result.stderr,/unresolved|uncertain|ambigu/i);f.notStopped();
});

for (const format of ['pax', 'gnu', 'ustar']) rtest(`${format.toUpperCase()} effective traversal is rejected before any staged payload is written`, f => {
    const root=path.basename(f.project), safe={name:root+'/backend/early.txt',data:'must-not-be-written'};
    const normal={name:root+'/backend/later.txt',data:'unsafe-effective-path'};
    const members = format==='pax' ? [safe,{name:root+'/PaxHeader',type:'x',data:paxRecord('path','../escape')},normal]
        : format==='gnu' ? [safe,{name:'././@LongLink',type:'L',magic:'ustar ',data:'../escape\0'},normal]
            : [safe,{...normal,name:'escape',prefix:root+'/..'}];
    archiveMembers(f.archive,members);const stage=path.join(f.root,'unsafe-stage');fs.mkdirSync(stage);
    const result=run(process.execPath,[path.join(SCRIPTS,'restore-stage.cjs'),f.project,f.archive,stage],{env:f.env});
    assert.notEqual(result.status,0);assert.match(result.stderr,/unsafe|unexpected path/);assert.deepEqual(fs.readdirSync(stage),[]);assert(!fs.existsSync(path.join(f.root,'escape')));f.notStopped();
});
rtest('actual WAL SQLite backup validates without snapshot mutations or sidecars', async f => {
    const writer=new NativeDatabase(f.db);
    try {
        writer.pragma('journal_mode = WAL');writer.pragma('wal_checkpoint(TRUNCATE)');
        const snapshot=path.join(f.backups,'actual-wal-backup.db');await writer.backup(snapshot);
        const before=fs.readFileSync(snapshot);assert.deepEqual([...before.subarray(18,20)],[2,2]);
        ok(run(process.execPath,[path.join(SCRIPTS,'restore-stage.cjs'),'--verify-db',snapshot],{env:f.env}));
        assert.deepEqual(fs.readFileSync(snapshot),before);assert(!fs.existsSync(snapshot+'-wal'));assert(!fs.existsSync(snapshot+'-shm'));
        writer.exec("INSERT INTO broker_order_intents VALUES('AMBIGUOUS')");
        const uncertain=path.join(f.backups,'actual-uncertain-backup.db');await writer.backup(uncertain);
        const result=run(process.execPath,[path.join(SCRIPTS,'restore-stage.cjs'),'--verify-db',uncertain],{env:f.env});
        assert.notEqual(result.status,0);assert.match(result.stderr,/open or uncertain broker state/);f.notStopped();
    } finally {writer.close();}
});
rtest('valid SQLite image lacking live lifecycle schema is rejected before stop', f => {
    fs.rmSync(f.snapshot);database(f.snapshot,'CREATE TABLE trades(mode TEXT,is_open INT);');
    const result=f.restore();assert.notEqual(result.status,0);assert.match(result.stderr,/supported live lifecycle schema/);f.notStopped();
});
rtest('restore invoked from installed scripts keeps helpers available after older archive cutover', f => {
    // The archive was made before these current helpers were installed. It
    // remains a supported older source shape with the original required files.
    for(const name of ['restore.sh','load-node-runtime.sh','load-maintenance-api.sh','restore-stage.cjs',
        'restore-safety.cjs','maintenance-db.cjs','maintenance-tools.cjs']) {
        fs.copyFileSync(path.join(SCRIPTS,name),path.join(f.project,'scripts',name));
    }
    const result=run('bash',[path.join(f.project,'scripts/restore.sh'),f.archive,'--confirm','RESTORE'],{env:f.env});
    ok(result);assert.equal(json(f.config).enableTrading,false);assert.equal(f.rollback().length,1);
    assert.equal(read(path.join(f.project,'.secrets/oanda_api_key.enc')),'original-broker-secret');
    assert(!f.calls().includes('/trading/start'));
});
rtest('sparse extended archive is rejected before any staged payload is written', f => {
    const root=path.basename(f.project);
    archiveMembers(f.archive,[{name:root+'/backend/early.txt',data:'must-not-be-written'},
        {name:root+'/PaxHeader',type:'x',data:paxRecord('GNU.sparse.size','8')+paxRecord('GNU.sparse.map','7,1')},
        {name:root+'/backend/sparse.bin',data:'x'}]);
    const stage=path.join(f.root,'sparse-stage');fs.mkdirSync(stage);
    const result=run(process.execPath,[path.join(SCRIPTS,'restore-stage.cjs'),f.project,f.archive,stage],{env:f.env});
    assert.notEqual(result.status,0);assert.match(result.stderr,/sparse/i);assert.deepEqual(fs.readdirSync(stage),[]);f.notStopped();
});
