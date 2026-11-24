'use client';
import {useEffect,useState} from 'react';
import {hasPermission,type TravelCreditOverview,type TravelCreditStatement} from '@peebee/shared';
import {SettingsPageShell} from '../../../components/SettingsPageShell';
import {Field,inputCls,ErrorNote,ugx} from '../../../components/work/ui';
import {Switch} from '../../../components/ui/Switch';
import {api,errorMessage} from '../../../lib/api';
import {useAuth} from '../../../lib/auth-context';
const button='min-h-10 rounded-full bg-gold px-4 text-sm font-bold text-ink';
export default function TravelCreditPage(){
 const {user}=useAuth(),allowed=hasPermission(user?.adminRole??null,'payments.manage');
 const [data,setData]=useState<TravelCreditOverview|null>(null),[detail,setDetail]=useState<TravelCreditStatement|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [name,setName]=useState(''),[owner,setOwner]=useState(''),[limit,setLimit]=useState('0');
 const [member,setMember]=useState(''),[memberActive,setMemberActive]=useState(false),[perBooking,setPerBooking]=useState('0'),[monthly,setMonthly]=useState('0');
 const load=async()=>setData(await api.getTravelCredit(true));
 useEffect(()=>{if(allowed)void load().catch(e=>setError(errorMessage(e)));},[allowed]);
 async function act(fn:()=>Promise<unknown>){if(busy)return;setBusy(true);setError('');try{await fn();await load();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 return <SettingsPageShell title="Corporate travel credit & vouchers" loading={!data&&allowed}>
 {!allowed?<p>Payment management permission is required.</p>:<>
 <ErrorNote message={error}/><p className="text-sm text-ink-500">Corporate credit is a receivable funded by Peebee until the approved owner repays from their wallet. Named travel vouchers hold actual issuer funds. These methods cover TaxiPress tickets and prepaid return packages; they are separate from promotional offers.</p>
 {data&&!data.ready?<p>Apply reviewed migration 0170 before enabling travel credit.</p>:data&&<>
 <section className="space-y-3 rounded-2xl bg-surface-1 p-4">
 <label className="flex items-center gap-3"><Switch checked={data.corporateEnabled} onChange={e=>setData({...data,corporateEnabled:e.target.checked})}/>Offer approved corporate credit</label>
 <label className="flex items-center gap-3"><Switch checked={data.vouchersEnabled} onChange={e=>setData({...data,vouchersEnabled:e.target.checked})}/>Offer prepaid travel vouchers</label>
 <Field label="Maximum voucher amount (UGX)"><input className={inputCls} inputMode="numeric" value={data.voucherMax} onChange={e=>setData({...data,voucherMax:Number(e.target.value)})}/></Field>
 <Field label="Voucher validity (days)"><input className={inputCls} inputMode="numeric" value={data.voucherDays} onChange={e=>setData({...data,voucherDays:Number(e.target.value)})}/></Field>
 <button className={button} disabled={busy} onClick={()=>void act(()=>api.setTravelCreditSettings(data))}>Save policy</button>
 </section>
 <section className="space-y-3 rounded-2xl bg-surface-1 p-4"><h2 className="font-bold">Create an approved company account</h2><p className="text-xs text-ink-500">New accounts start inactive. Verify the company and owner, set its credit limit, then explicitly activate it and approve each traveller&apos;s budgets.</p>
 <Field label="Company name"><input className={inputCls} value={name} onChange={e=>setName(e.target.value)}/></Field>
 <Field label="Owner phone or email"><input className={inputCls} value={owner} onChange={e=>setOwner(e.target.value)}/></Field>
 <Field label="Approved credit limit (UGX)"><input className={inputCls} inputMode="numeric" value={limit} onChange={e=>setLimit(e.target.value)}/></Field>
 <button className={button} disabled={busy} onClick={()=>void act(async()=>{await api.createTravelCreditAccount({name,owner,creditLimit:Number(limit)});setName('');setOwner('');})}>Create inactive account</button>
 </section>
 <section className="space-y-3"><h2 className="font-bold">Accounts</h2>{data.accounts.map(a=><button key={a.id} className="block w-full rounded-2xl bg-surface-1 p-4 text-left" onClick={()=>void act(async()=>{setDetail(await api.getTravelCreditStatement(a.id,true));setLimit(String(a.credit_limit));})}>{a.name} · {a.active?'Active':'Inactive'}<br/>Outstanding {ugx(a.outstanding)} · Limit {ugx(a.credit_limit)}</button>)}</section>
 {detail&&<section className="space-y-3 rounded-2xl bg-surface-1 p-4"><h2 className="font-bold">{detail.account.name}</h2><p>Owner: {detail.account.owner_id}. Negative outstanding is company credit following a refund after repayment.</p>
 <Field label="Account credit limit (UGX)"><input className={inputCls} value={limit} inputMode="numeric" onChange={e=>setLimit(e.target.value)}/></Field>
 <button className={button} disabled={busy} onClick={()=>void act(async()=>{await api.setTravelCreditAccount(detail.account.id,{active:!!detail.account.active,creditLimit:Number(limit)});setDetail(await api.getTravelCreditStatement(detail.account.id,true));})}>Save limit</button>{' '}
 <button className={button} disabled={busy} onClick={()=>void act(async()=>{await api.setTravelCreditAccount(detail.account.id,{active:!detail.account.active,creditLimit:detail.account.credit_limit});setDetail(await api.getTravelCreditStatement(detail.account.id,true));})}>{detail.account.active?'Suspend new spending':'Activate approved account'}</button>
 <h3 className="font-bold">Traveller authorization</h3>
 <Field label="Traveller phone or email"><input className={inputCls} value={member} onChange={e=>setMember(e.target.value)}/></Field>
 <Field label="Per-booking budget (UGX)"><input className={inputCls} inputMode="numeric" value={perBooking} onChange={e=>setPerBooking(e.target.value)}/></Field>
 <Field label="Monthly budget (UGX, Kampala calendar month)"><input className={inputCls} inputMode="numeric" value={monthly} onChange={e=>setMonthly(e.target.value)}/></Field>
 <label className="flex items-center gap-3"><Switch checked={memberActive} onChange={e=>setMemberActive(e.target.checked)}/>Authorize this traveller</label>
 <button className={button} disabled={busy} onClick={()=>void act(async()=>{await api.setTravelCreditMember(detail.account.id,{customer:member,active:memberActive,perBooking:Number(perBooking),monthlyLimit:Number(monthly)});setDetail(await api.getTravelCreditStatement(detail.account.id,true));})}>Save traveller authorization</button>
 {detail.members.map(m=><p key={m.user_id} className="text-xs">{m.user_id} · {m.active?'Authorized':'Suspended'} · Booking {ugx(m.per_booking)} · Month {ugx(m.monthly_limit)}</p>)}
 <h3 className="font-bold">Statement · most recent 500 entries</h3>{detail.ledger.map(l=><p key={l.id} className="break-words text-xs">{l.created_at} · {l.kind} · {ugx(l.amount)} · {l.order_id||l.reference||''}</p>)}
 </section>}
 <section className="space-y-3"><h2 className="font-bold">Funded vouchers</h2>{data.vouchers.map(v=><p key={v.id} className="break-words rounded-2xl bg-surface-1 p-3 text-xs">{v.id} · {v.state} · Remaining {ugx(v.balance)} / {ugx(v.amount)} · Recipient {v.recipient_id} · Issuer {v.issuer_id} · Expires {v.expires_at} UTC</p>)}</section>
 </>}
 </>}
 </SettingsPageShell>;
}
