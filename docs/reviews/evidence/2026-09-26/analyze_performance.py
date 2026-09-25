#!/usr/bin/env python3
"""Recompute the broker-verified ledger and summary from adjacent retained inputs."""
import json,datetime,collections,statistics,csv,pathlib,hashlib
D=pathlib.Path(__file__).resolve().parent;x=json.loads((D/'production-evidence.json').read_text());b=json.loads((D/'broker-evidence.json').read_text())
parse=lambda z:json.loads(z) if isinstance(z,str) else z
iso=lambda z:datetime.datetime.fromtimestamp(z/1000,datetime.timezone.utc).isoformat()
ts=sorted([t for t in x['trades'] if x['start_ms']<=t['entry_time']<x['end_ms']],key=lambda t:t['entry_time'])
intents={t['trade_id']:t for t in x['intents'] if t['trade_id']};tx={t['id']:t for t in b['transactions']}
rows=[];verification=[]
for t in ts:
 p=parse(t['broker_reconciliation_payload']);rt=p['liveRuntime'];c=parse(intents[t['trade_id']]['context_payload']);s=c['signal']['strategyContext'];e=p['sampledExcursion'];bt=b['trades'][t['oanda_trade_id']];entry=tx[t['oanda_trade_id']];closes=[tx[z] for z in bt['closingTransactionIDs']]
 risk=abs(t['units'])*rt['initialStopDistance']*float(entry['lossQuoteHomeConversionFactor']);sgn=1 if t['side']=='BUY' else -1; pip=.01 if t['instrument'].endswith('JPY') else .0001
 trigger=s['m15']['trigger'];bo=trigger['longBreakout'] or trigger['shortBreakout'];pb=trigger['longPullback'] or trigger['shortPullback']
 net=float(bt['realizedPL'])+float(bt['financing'])-sum(float(z.get('commission',0))+float(z.get('guaranteedExecutionFee',0)) for z in [entry]+closes)
 checks={'entry_price':float(bt['price'])==t['entry_price'],'exit_price':float(bt['averageClosePrice'])==t['exit_price'],'units':abs(float(bt['initialUnits']))==abs(t['units']),'net_pnl':abs(net-t['pnl_aud'])<1e-9,'entry_time_ms':abs(datetime.datetime.fromisoformat(bt['openTime'].replace('Z','+00:00')).timestamp()*1000-t['entry_time'])<1,'exit_time_ms':abs(datetime.datetime.fromisoformat(bt['closeTime'].replace('Z','+00:00')).timestamp()*1000-t['exit_time'])<1,'sample_lifetime':all(t['entry_time']<=z[0]<=t['exit_time'] for z in e['samples'])}
 assert all(checks.values()),(t['oanda_trade_id'],checks)
 verification.append({'broker_id':t['oanda_trade_id'],'checks':checks})
 rows.append({'id':t['oanda_trade_id'],'instrument':t['instrument'],'side':t['side'],'entry_time':t['entry_time'],'exit_time':t['exit_time'],'entry_utc':iso(t['entry_time']),'exit_utc':iso(t['exit_time']),'entry_price':t['entry_price'],'exit_price':t['exit_price'],'units':t['units'],'net_aud':t['pnl_aud'],'exit_reason':t['exit_reason'],'stop_distance':rt['initialStopDistance'],'initial_cash_risk_aud':risk,'net_cash_r':t['pnl_aud']/risk,'price_r':sgn*(t['exit_price']-t['entry_price'])/rt['initialStopDistance'],'holding_minutes':(t['exit_time']-t['entry_time'])/60000,'trigger':'BOTH' if bo and pb else 'BREAKOUT' if bo else 'PULLBACK','sessions':'+'.join(s['activeSessions']),'adx':s['h1']['adx'],'rsi':s['m15']['rsi'],'sampled_mfe_r':e['maxFavorableR'],'sampled_mae_r':e['maxAdverseR'],'sample_count':len(e['samples']),'sample_version':e['version'],'sample_status':e['lifetimeStatus'],'half_spread_cost_aud':sum(float(z.get('halfSpreadCost',0)) for z in [entry]+closes),'signal_close_to_fill_seconds':(t['entry_time']-s['signalCandleCloseTime'])/1000,'run_id':t['run_id'],'config_hash':t['config_hash']})
opened=[t['tradeOpened']['tradeID'] for t in b['transactions'] if t.get('tradeOpened')]
assert set(opened)==set(t['oanda_trade_id'] for t in ts)
assert all(a['exit_time']<c['entry_time'] for a,c in zip(ts,ts[1:]))
assert all(t['exit_time']<x['end_ms'] for t in ts)
assert not any(t['entry_time']<x['start_ms']<t['exit_time'] for t in x['trades'])
net=sum(t['net_aud'] for t in rows);gains=sum(t['net_aud'] for t in rows if t['net_aud']>0);losses=sum(-t['net_aud'] for t in rows if t['net_aud']<0)
opening=float(tx[ts[0]['oanda_trade_id']]['accountBalance']);closing=float(tx[b['trades'][ts[-1]['oanda_trade_id']]['closingTransactionIDs'][-1]]['accountBalance']);assert abs(closing-opening-net)<1e-8
balance=opening;peak=opening;dd=ddpct=0
for r in rows:
 balance+=r['net_aud'];peak=max(peak,balance);dd=max(dd,peak-balance);ddpct=max(ddpct,(peak-balance)/peak*100);r['balance_aud']=balance
summary={'start_utc':iso(x['start_ms']),'end_utc':iso(x['end_ms']),'trades':len(rows),'wins':sum(r['net_aud']>0 for r in rows),'losses':sum(r['net_aud']<0 for r in rows),'flat':sum(r['net_aud']==0 for r in rows),'net_aud':net,'gross_gains':gains,'gross_losses':losses,'profit_factor':gains/losses,'opening_balance':opening,'closing_balance':closing,'return_pct':net/opening*100,'net_cash_r':sum(r['net_cash_r'] for r in rows),'price_r':sum(r['price_r'] for r in rows),'mean_cash_r':statistics.mean(r['net_cash_r'] for r in rows),'realized_max_drawdown_aud':dd,'realized_max_drawdown_pct':ddpct,'median_hold_minutes':statistics.median(r['holding_minutes'] for r in rows),'max_hold_minutes':max(r['holding_minutes'] for r in rows),'half_spread_cost_aud':sum(r['half_spread_cost_aud'] for r in rows),'since_sep6_count':len(x['trades']),'since_sep6_net_aud':sum(t['pnl_aud'] for t in x['trades']),'same_run_count':sum(t['run_id']==ts[0]['run_id'] for t in x['trades']),'same_run_net':sum(t['pnl_aud'] for t in x['trades'] if t['run_id']==ts[0]['run_id'])}
for key in ['instrument','side','trigger','exit_reason','sessions']:
 summary[key]={v:{'count':len(rr:=[r for r in rows if r[key]==v]),'net_aud':sum(r['net_aud'] for r in rr),'price_r':sum(r['price_r'] for r in rr)} for v in sorted(set(r[key] for r in rows))}
(D/'performance-summary.json').write_text(json.dumps(summary,indent=2)+'\n');(D/'ledger.json').write_text(json.dumps(rows,indent=2)+'\n');(D/'broker-verification.json').write_text(json.dumps({'all_new_broker_openings_matched':True,'rows':verification,'financing':sum(float(z.get('financing',0)) for z in b['transactions']),'commission':sum(float(z.get('commission',0)) for z in b['transactions']),'guaranteed_fee':sum(float(z.get('guaranteedExecutionFee',0)) for z in b['transactions'])},indent=2)+'\n')
with (D/'trade-ledger.csv').open('w') as f:
 w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
print(json.dumps(summary,indent=2))
