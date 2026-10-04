'use client';

import Link from 'next/link';
import { useState } from 'react';

type Step = { id: string; text: string; points: number };
type Action = {
  id: string; name: string; icon: string; description: string; scheduledTime: string | null;
  points: number; firstStep: string; steps: Step[]; stepCount: number; progressCount: number;
  currentStep: Step | null; done: boolean;
};
type TodayData = { date: string; balance: number; earned: number; completed: number; actions: Action[]; settled: boolean };
type Reward = { id: string; name: string; icon: string; description: string; cost: number; stock: number | null; repeatable: boolean };
type RewardData = { items: Reward[]; balance: number; ownedRewardIds: string[] };
type Redemption = { id: string; rewardNameSnapshot: string; costSnapshot: number; redeemedAt: string; usedAt: string | null; status: 'AVAILABLE' | 'USED' | 'CANCELLED' };

function Header({kicker,title,sub}:{kicker:string;title:string;sub:string}) {
  return <header className="page-heading"><div className="eyebrow">{kicker}</div><h1>{title}</h1><p>{sub}</p></header>;
}

function ConfirmDialog({title,description,confirm,busy,onCancel,onConfirm}:{title:string;description:string;confirm:string;busy:boolean;onCancel:()=>void;onConfirm:()=>void}) {
  return <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onCancel();}}>
    <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <span className="eyebrow">请确认</span>
      <h2 id="dialog-title">{title}</h2>
      <p>{description}</p>
      <div className="dialog-actions"><button className="outline" onClick={onCancel} disabled={busy}>再想想</button><button className="primary" onClick={onConfirm} disabled={busy}>{busy?'处理中…':confirm}</button></div>
    </div>
  </div>;
}

export function Today({data,onComplete,readOnly=false,embedded=false,onPreviewLogin}:{data:TodayData | null;onComplete:(id:string,stepId?:string)=>Promise<boolean>|void;readOnly?:boolean;embedded?:boolean;onPreviewLogin?:()=>void}) {
  const [busy,setBusy]=useState<string|null>(null);
  if(!data)return null;
  const active=data.actions.filter(a=>!a.done);
  const focus=active[0];
  const totalSteps=data.actions.reduce((n,a)=>n+(a.stepCount||1),0);
  const completedSteps=data.actions.reduce((n,a)=>n+(a.stepCount?a.progressCount:Number(a.done)),0);
  const percent=totalSteps?Math.round(completedSteps/totalSteps*100):0;
  async function finish(action:Action) {
    if(busy||data?.settled||readOnly)return;
    setBusy(action.id);
    try { await onComplete(action.id,action.currentStep?.id); }
    finally { setBusy(null); }
  }
  const button=(action:Action,featured=false)=> {
    if(action.done)return <button className="completed" disabled>✓ 今天已完成</button>;
    if(data.settled)return <button className="completed" disabled>今天已结算</button>;
    if(readOnly)return <button className={featured?'primary':'outline'} onClick={onPreviewLogin}>登录成员账号后完成</button>;
    const value=action.currentStep?.points??action.points;
    return <button className="primary" disabled={!!busy} onClick={()=>void finish(action)}>{busy===action.id?'记录中…':`完成这一步 · +${value} 分`}</button>;
  };
  return <>
    {!embedded&&<Header kicker={data.date} title="今天，从这一小步开始" sub="完成当前步骤后，下一步会自动出现。"/>}
    <section className="today-overview" aria-label="今日概览">
      <div className="today-overview-main"><span>今日进度</span><strong>{completedSteps}<small> / {totalSteps} 步</small></strong><div className="progress-track"><span style={{width:`${percent}%`}}/></div><small>照自己的节奏来，已经完成 {percent}%</small></div>
      <div className="today-metric"><span>今日获得</span><strong>+{data.earned}<small> 分</small></strong></div>
      <Link className="today-metric metric-link" href="/points"><span>可用积分</span><strong>{data.balance}<small> 分</small></strong><small>查看明细 →</small></Link>
    </section>
    {focus?<section className="focus-card" aria-label="现在做这一步">
      <div className="focus-label">现在做这一步 <span>{focus.scheduledTime||'今天'}</span></div>
      <div className="focus-body"><span className="focus-icon">{focus.icon}</span><div><h2>{focus.name}</h2><p>{focus.currentStep?.text||focus.firstStep||'完成这项行动'}</p></div></div>
      <div className="focus-foot"><span>第 {focus.stepCount?focus.progressCount+1:1} / {focus.stepCount||1} 步</span>{button(focus,true)}</div>
    </section>:<section className="focus-card all-done"><span className="focus-icon">✦</span><div><h2>今天的行动都完成了</h2><p>每一步都已记入积分流水。</p></div><Link className="outline" href="/rewards">看看可以兑换什么 →</Link></section>}
    <div className="section-title"><h2>今日行动</h2><span>{data.completed} / {data.actions.length} 项完成</span></div>
    <div className="action-grid">{data.actions.map(a=><article className={'action-card '+(a.done?'done':'')} key={a.id}>
      <div className="card-top"><span className="action-icon">{a.icon}</span><span className="time">{a.done?'已完成':a.scheduledTime||'今天'}</span></div>
      <h3>{a.name}</h3>
      {a.stepCount>0?<><div className="pattern-progress">{a.done?'全部完成':`第 ${a.progressCount+1} / ${a.stepCount} 步`} · 已得 {a.steps.slice(0,a.progressCount).reduce((n,s)=>n+s.points,0)} / {a.points} 分</div><div className="progress-track"><span style={{width:`${100*a.progressCount/a.stepCount}%`}}/></div></>:null}
      {a.currentStep&&<div className="first-step"><small>接下来</small><strong>👉 {a.currentStep.text}</strong></div>}
      {!a.stepCount&&a.firstStep&&<div className="first-step"><small>第一步</small><strong>👉 {a.firstStep}</strong></div>}
      {a.description&&<p>{a.description}</p>}
      {a.progressCount>0&&<details className="completed-steps"><summary>已完成 {a.progressCount} 步</summary>{a.steps.slice(0,a.progressCount).map(s=><div key={s.id}>✓ {s.text}<span>+{s.points}</span></div>)}</details>}
      {button(a)}
    </article>)}</div>
    {!data.actions.length&&<div className="empty">今天还没有安排。管理员可以在 Pattern 页面逐步创建并分配。</div>}
    {data.settled&&<div className="hint">今天已结算，明天继续。</div>}
  </>;
}

export function Rewards({data,onRedeem,readOnly=false,embedded=false,onPreviewLogin}:{data:RewardData | null;onRedeem:(id:string)=>Promise<boolean>;readOnly?:boolean;embedded?:boolean;onPreviewLogin?:()=>void}) {
  const [selected,setSelected]=useState<Reward|null>(null),[busy,setBusy]=useState(false),[success,setSuccess]=useState<string|null>(null);
  if(!data)return null;
  const owned=new Set(data.ownedRewardIds);
  async function redeem() {
    if(!selected)return;
    setBusy(true);
    try { if(await onRedeem(selected.id)){setSuccess(selected.name);setSelected(null);} }
    finally {setBusy(false);}
  }
  return <>
    {!embedded&&<Header kicker="REWARDS" title="把积分换成喜欢的事" sub="选好奖励，确认兑换。兑换后会放进“我的奖励”，使用时再核销。"/>}
    <div className="store-balance"><div><span>当前可用</span><strong>{data.balance}<small> 积分</small></strong></div>{readOnly?<button className="outline" onClick={onPreviewLogin}>登录成员账号查看奖励 →</button>:<Link href="/rewards/mine">我的奖励 →</Link>}</div>
    {success&&<div className="success-panel" role="status"><strong>✓ 已兑换「{success}」</strong><span>积分已扣除，奖励已放入“我的奖励”。</span><Link href="/rewards/mine">去查看 →</Link></div>}
    <div className="section-title"><h2>奖励商店</h2><span>{data.items.length} 件奖励</span></div>
    <div className="action-grid">{data.items.map(r=>{
      const shortage=Math.max(0,r.cost-data.balance),soldOut=r.stock===0,ownedOnce=!r.repeatable&&owned.has(r.id);
      return <article className="reward-card" key={r.id}>
        <div className="card-top"><div className="reward-icon">{r.icon}</div><span className="time">{r.repeatable?'可重复兑换':'每人限一次'}</span></div>
        <h3>{r.name}</h3><p>{r.description||'具体内容与使用时间请和家人确认。'}</p>
        {shortage>0&&!soldOut&&!ownedOnce&&<div className="reward-shortage">还差 {shortage} 分{!readOnly&&<> · <Link href="/today">去做行动 →</Link></>}</div>}
        <div className="reward-foot"><span>{r.cost} <small>积分</small></span><button className="primary" disabled={soldOut||ownedOnce||shortage>0} onClick={readOnly?onPreviewLogin:()=>setSelected(r)}>{soldOut?'已兑完':ownedOnce?'已兑换':shortage>0?'积分不足':readOnly?'登录成员账号兑换':'兑换奖励'}</button></div>
      </article>;
    })}</div>
    {!data.items.length&&<div className="empty-state"><span>◇</span><h2>奖励清单还没定好</h2><p>管理员可以先在“管理后台 → 奖励”添加内容、使用限制和积分价格。</p></div>}
    {selected&&<ConfirmDialog title={`兑换「${selected.name}」？`} description={`需要 ${selected.cost} 积分，兑换后预计剩余 ${data.balance-selected.cost} 分。兑换和使用是两步，领取后可在“我的奖励”中使用。`} confirm={`确认兑换 · ${selected.cost} 分`} busy={busy} onCancel={()=>setSelected(null)} onConfirm={()=>void redeem()}/>}
  </>;
}

export function Mine({data,onUse}:{data:Redemption[] | null;onUse:(id:string)=>Promise<boolean>}) {
  const [selected,setSelected]=useState<Redemption|null>(null),[busy,setBusy]=useState(false),[success,setSuccess]=useState<string|null>(null);
  if(!data)return null;
  const available=data.filter(r=>r.status==='AVAILABLE'),past=data.filter(r=>r.status!=='AVAILABLE');
  async function use() {
    if(!selected)return;
    setBusy(true);
    try {if(await onUse(selected.id)){setSuccess(selected.rewardNameSnapshot);setSelected(null);}}
    finally {setBusy(false);}
  }
  return <>
    <Header kicker="MY REWARDS" title="我的奖励" sub="兑换只是领取；真正使用时，点击“确认使用”才会核销。"/>
    {success&&<div className="success-panel" role="status"><strong>✓ 已使用「{success}」</strong><span>使用记录已保存。</span></div>}
    <div className="section-title"><h2>待使用</h2><span>{available.length} 件</span></div>
    <div className="reward-wallet">{available.map(r=><article className="wallet-ticket" key={r.id}><div><span className="eyebrow">可使用</span><h3>{r.rewardNameSnapshot}</h3><p>{new Date(r.redeemedAt).toLocaleDateString('zh-CN')} 兑换 · {r.costSnapshot} 积分</p></div><button className="primary" onClick={()=>setSelected(r)}>确认使用</button></article>)}</div>
    {!available.length&&<div className="empty-state"><span>◇</span><h2>暂时没有待使用的奖励</h2><p>去奖励商店看看想兑换什么。</p><Link className="outline" href="/rewards">浏览奖励 →</Link></div>}
    {past.length>0&&<><div className="section-title"><h2>历史记录</h2><span>{past.length} 件</span></div><div className="list">{past.map(r=><div className="list-row" key={r.id}><div><strong>{r.rewardNameSnapshot}</strong><small>{r.status==='USED'&&r.usedAt?new Date(r.usedAt).toLocaleDateString('zh-CN')+' 使用':new Date(r.redeemedAt).toLocaleDateString('zh-CN')+' 兑换'} · {r.costSnapshot} 积分</small></div><span className="muted">{r.status==='USED'?'已使用':'已取消'}</span></div>)}</div></>}
    {selected&&<ConfirmDialog title={`现在使用「${selected.rewardNameSnapshot}」？`} description="确认后这张奖励会标记为已使用，无法再次使用。这一步不会再次扣积分。" confirm="确认使用" busy={busy} onCancel={()=>setSelected(null)} onConfirm={()=>void use()}/>}
  </>;
}
