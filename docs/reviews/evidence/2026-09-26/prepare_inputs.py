#!/usr/bin/env python3
"""Retain minimal review inputs from read-only local captures; never contacts a service."""
import argparse, hashlib, json
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('capture_directory',type=Path)
parser.add_argument('--output',type=Path,default=Path(__file__).parent)
a=parser.parse_args();a.output.mkdir(parents=True,exist_ok=True)
def read(name):return json.loads((a.capture_directory/name).read_text())
def parse(value):return json.loads(value) if isinstance(value,str) else value
def select(value,keys):return {k:value[k] for k in keys if k in value}
p=read('production-evidence.json');b=read('broker-evidence.json')
# Keep numerical strategy settings; exclude unrelated operator/notification settings.
config_keys=['liveReleaseVersion','strategy','riskPerTrade','maxCapitalAtRisk','maxOpenPositions','timeStopHours','intradayTargetRiskMultiple','enableBreakeven','breakevenTriggerRiskMultiple','sessionCloseTimeZone','sessionCloseLocalHour','sessionCloseLocalMinute']
x=select(p,['start_ms','end_ms','captured_at','revision']);x['trades']=[]
for t in p['trades']:
 row=select(t,['id','trade_id','oanda_trade_id','instrument','side','units','entry_price','exit_price','entry_time','exit_time','exit_reason','pnl_aud','pnl_pips','holding_period_ms','run_id','config_hash','is_open'])
 payload=parse(t['broker_reconciliation_payload']);rt=payload['liveRuntime']
 minimal_rt=select(rt,['initialStopDistance','initialStopLossPrice','entryTelemetry','instrumentMetadata'])
 minimal_rt['exitConfig']=select(rt['exitConfig'],config_keys)
 row['broker_reconciliation_payload']={'liveRuntime':minimal_rt,'sampledExcursion':payload.get('sampledExcursion',{})}
 x['trades'].append(row)
x['intents']=[]
for i in p['intents']:
 row=select(i,['intent_id','trade_id','broker_trade_id','created_at_ms','status','attempt_count'])
 c=parse(i['context_payload']);row['context_payload']=select(c,['signal','quoteToAudRate','riskBudgetAud','worstFillRiskAud','entryReferencePrice'])
 row['context_payload']['config']=select(c['config'],config_keys);x['intents'].append(row)
x['decisions']=[select(d,['id','trade_id','setup_id','decision_time','signal_candle_time','instrument','side','outcome','rejection_code','entry_reference_price','can_reconsider']) for d in p['decisions']]
# Distinct completed-candle regime observations suffice for the optional reset screen.
x['signals']=[];seen=set()
for s in p['signals']:
 ctx=parse(s['decision_context']).get('strategyContext',{});h=ctx.get('h1')
 if not h:continue
 key=(s['instrument'],s['signal_candle_time'],h.get('longRegime'),h.get('shortRegime'))
 if key in seen:continue
 seen.add(key);row=select(s,['instrument','timestamp','signal_candle_time'])
 row['decision_context']={'strategyContext':{'h1':select(h,['longRegime','shortRegime'])}};x['signals'].append(row)
# No account identifiers, credentials, complete configs or unrelated operational data.
y=select(b,['captured_at','summary','openTrades','pendingOrders','M1','M15']);y['trades']={}
for tid,t in b['trades'].items():y['trades'][tid]=select(t,['id','instrument','price','openTime','initialUnits','state','currentUnits','realizedPL','closingTransactionIDs','financing','dividendAdjustment','closeTime','averageClosePrice','stopLossOrder','takeProfitOrder'])
y['transactions']=[select(t,['id','time','type','instrument','units','price','tradeID','reason','accountBalance','lossQuoteHomeConversionFactor','gainQuoteHomeConversionFactor','tradeOpened','tradesClosed','pl','financing','commission','guaranteedExecutionFee','halfSpreadCost','stopLossOnFill','takeProfitOnFill','priceBound','positionFill']) for t in b['transactions']]
for name,data in [('production-evidence.json',x),('broker-evidence.json',y)]:
 (a.output/name).write_text(json.dumps(data,separators=(',',':'))+'\n')
manifest={'review_interval_utc':['2026-09-21T10:35:00Z','2026-09-25T20:45:00Z'],'source_revision':p['revision'],'capture_time':p['captured_at'],'raw_sources':{name:{'local_path':str(a.capture_directory/name),'sha256':hashlib.sha256((a.capture_directory/name).read_bytes()).hexdigest()} for name in ['production-evidence.json','broker-evidence.json','runtime-logs.json']},'retained_inputs':'The similarly named retained files are reduced inputs, not byte-identical raw exports. Raw captures remain temporary. No credentials were exported.'}
(a.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'trades':len(x['trades']),'intents':len(x['intents']),'decisions':len(x['decisions']),'distinct_regime_observations':len(x['signals'])}))
