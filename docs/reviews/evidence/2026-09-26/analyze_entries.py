#!/usr/bin/env python3
"""Recompute descriptive entry and sampled-excursion comparisons."""
import json, statistics, collections, math
from datetime import datetime,timezone
from pathlib import Path
base=Path(__file__).resolve().parent
p=json.loads((base/'production-evidence.json').read_text())
start=p['start_ms'];end=p['end_ms']
def parse(x):return json.loads(x) if isinstance(x,str) else x
def iso(x):return datetime.fromtimestamp(x/1000,timezone.utc).isoformat() if x is not None else None
alltrades=sorted(p['trades'],key=lambda t:t['entry_time'])
rows=[]
for t in alltrades:
 b=parse(t['broker_reconciliation_payload']); rt=b['liveRuntime']; ctx=rt['entryTelemetry']['strategyContext'];m=ctx['m15'];h=ctx['h1'];tr=m['trigger']; ex=b.get('sampledExcursion',{});d=1 if t['side']=='BUY' else -1;sd=rt['initialStopDistance'];pip=.01 if t['instrument'].endswith('JPY') else .0001
 ispb=tr['longPullback'] or tr['shortPullback'];isb=tr['longBreakout'] or tr['shortBreakout']
 prior=next((r for r in reversed(rows) if r['instrument']==t['instrument']),None)
 dec=[x for x in p['decisions'] if x['trade_id']==t['trade_id'] or x['trade_id']==t['id'] or str(x['trade_id'])==str(t['oanda_trade_id'])]
 attempts=[x for x in p['decisions'] if any(x['setup_id']==z['setup_id'] for z in dec)]
 row={'broker_trade_id':str(t['oanda_trade_id']),'instrument':t['instrument'],'side':t['side'],'entry_time':t['entry_time'],'exit_time':t['exit_time'],'entry_utc':iso(t['entry_time']),'exit_utc':iso(t['exit_time']),'pnl_aud':t['pnl_aud'],'exit_reason':t['exit_reason'],'price_r':d*(t['exit_price']-t['entry_price'])/sd,'holding_minutes':t['holding_period_ms']/60000,'initial_stop_pips':sd/pip,'trigger_combination':'both' if ispb and isb else 'pullback_only' if ispb else 'breakout_only','signal_candle_close_utc':iso(ctx['signalCandleCloseTime']),'entry_delay_minutes':(t['entry_time']-ctx['signalCandleCloseTime'])/60000,'sessions':ctx['activeSessions'],'h1_adx':h['adx'],'h1_di_spread':d*(h['pdi']-h['mdi']),'h1_close_distance_to_ema20_atr':d*(h['close']-h['fastEma'])/m['atr'],'h1_ema20_ema50_spread_atr':d*(h['fastEma']-h['slowEma'])/m['atr'],'rsi':m['rsi'],'body_ratio':m['bodyRatio'],'range_atr':m['rangeAtr'],'signal_distance_ema20_atr':d*(m['close']-m['fastEma'])/m['atr'],'signal_distance_ema50_atr':d*(m['close']-m['slowEma'])/m['atr'],'signal_distance_breakout_level_atr':d*(m['close']-(tr['breakoutHigh'] if d==1 else tr['breakoutLow']))/m['atr'],'cost_to_stop_ratio':ctx['costs']['costToStopRatio'],'final_spread_pips':rt['entryTelemetry']['finalSpreadPips'],'same_pair_previous':None if prior is None else {'broker_trade_id':prior['broker_trade_id'],'side':prior['side'],'exit_reason':prior['exit_reason'],'pnl_aud':prior['pnl_aud'],'gap_minutes':(t['entry_time']-prior['exit_time'])/60000},'excursion':{k:ex.get(k) for k in ['version','lifetimeStatus','maxFavorableR','maxAdverseR','observations','firstObservedAt','lastObservedAt','confirmedBrokerClosedAt','excludedAfterClose']},'has_legacy_excursion':bool(ex.get('legacyAggregate')),'decision_attempt_count':len(attempts),'pricing_rejections_before_fill':dict(collections.Counter(x['rejection_code'] for x in attempts if x['outcome']!='FILLED'))}
 if ex.get('version')==2:
  s=ex['samples']; vals=[q[2] for q in s if q[2] is not None]
  row['excursion_validation']={'all_samples_inside_lifetime':all(t['entry_time']<=q[0]<=ex['confirmedBrokerClosedAt'] for q in s),'sample_times_strictly_increasing':all(a[0]<b[0] for a,b in zip(s,s[1:])),'count_matches':len(s)==ex['observations'],'mfe_matches':math.isclose(max([0]+vals),ex['maxFavorableR'],abs_tol=1e-10),'mae_matches':math.isclose(-min([0]+vals),ex['maxAdverseR'],abs_tol=1e-10),'max_between_sample_gap_seconds':max([(b[0]-a[0])/1000 for a,b in zip(s,s[1:])],default=None),'first_sample_lag_seconds':(s[0][0]-t['entry_time'])/1000 if s else None,'last_sample_to_exit_seconds':(t['exit_time']-s[-1][0])/1000 if s else None}
 rows.append(row)
new=[r for r in rows if start<=r['entry_time']<end]
old=[r for r in rows if 1789295700000<=r['entry_time']<start]
def total(rs):
 return {'trades':len(rs),'wins':sum(r['pnl_aud']>0 for r in rs),'losses':sum(r['pnl_aud']<0 for r in rs),'flat':sum(r['pnl_aud']==0 for r in rs),'pnl_aud':round(sum(r['pnl_aud'] for r in rs),4),'price_r':sum(r['price_r'] for r in rs)}
def groups(rs,key):
 d=collections.defaultdict(list)
 for r in rs:d[' + '.join(r[key]) if isinstance(r[key],list) else r[key]].append(r)
 return {k:total(v) for k,v in d.items()}
result={'start_ms':start,'end_ms':end,'new_week':{'summary':total(new),'by_pair':groups(new,'instrument'),'by_side':groups(new,'side'),'by_trigger':groups(new,'trigger_combination'),'by_exit':groups(new,'exit_reason'),'by_session':groups(new,'sessions'),'trades':new},'previous_review':{'summary':total(old),'by_trigger':groups(old,'trigger_combination')},'combined_same_baseline_period':{'summary':total(old+new),'by_trigger':groups(old+new,'trigger_combination')},'warnings':['All MFE/MAE are sampled, not tick-complete extrema.','Same-pair previous reflects observed tape, not state after alternative entry exclusions.','Indicator splits are descriptive; no threshold selected or candidate P&L forecast.']}
(base/'entry-analysis.json').write_text(json.dumps(result,indent=2)+'\n')
for r in new:
 print(r['broker_trade_id'],r['instrument'],r['side'],r['entry_utc'],r['pnl_aud'],r['exit_reason'],r['trigger_combination'],'MFE',round(r['excursion']['maxFavorableR'],3),'MAE',round(r['excursion']['maxAdverseR'],3),'ADX',round(r['h1_adx'],2),'RSI',r['rsi'],'rangeATR',round(r['range_atr'],3),'body',round(r['body_ratio'],3),'delay',round(r['entry_delay_minutes'],2),'duration',round(r['holding_minutes'],2),'prior',r['same_pair_previous'])
print(json.dumps({k:v for k,v in result.items() if k not in ['new_week']}))
print(json.dumps({k:v for k,v in result['new_week'].items() if k!='trades'}))
