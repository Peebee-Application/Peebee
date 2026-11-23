import type {ApiClient,TaxipressBookingInput} from '../../../packages/shared/src/api-client';
import type {AuthUser} from '../../../packages/shared/src/domain';
import type {TaxipressConfig,TaxipressReturnPackage,TaxipressBooking} from '../../../packages/shared/src/taxipress';
type Context={ui:Record<string,any>;api:ApiClient;user:()=>AuthUser|null;config:()=>TaxipressConfig|null;trips:()=>any[];bookings:()=>TaxipressBooking[];selected:()=>TaxipressBooking|null;
  input:(holdId?:string)=>TaxipressBookingInput;prepareSeats:()=>Promise<string|undefined>;refresh:()=>Promise<void>;select:(b:TaxipressBooking)=>void;requestLogin:(screen:string)=>void;clearDraft:()=>void};
export function installReturnPackages(c:Context){
  const {ui,api}=c,state=ui.TaxibeeSource.state,esc=(v:unknown)=>ui.escapeHtml(String(v??'')),money=(n:number)=>ui.formatUGX(n);
  let packages:TaxipressReturnPackage[]=[],busy=false,epoch=0;
  let paymentId:string|null=null;
  const key=()=>`taxibee-return-checkout:${c.user()?.id||'guest'}`;
  const mode=()=>['open','same-day','date-specific'].includes(state.returnMode)?state.returnMode:'open';
  const available=()=>!!c.config()?.returnPackagesEnabled;
  function estimate(trip=state.activeTrip){
    const config=c.config(),out=config?.routes.find(r=>r.id===trip?.routeId);
    const back=config?.routes.find(r=>r.relayRouteId===out?.relayRouteId&&r.id!==out?.id);
    if(!out||!back)return null;
    const i=c.input(),adults=i.adults||1,children=i.childSeats||0,pct=config?.childSeatFarePercent??100,d=config?.returnDiscountPercent||0;
    const fare=(n:number)=>n*adults+Math.round(n*pct/100)*children;
    const rawOut=fare(out.farePerSeat),rawBack=fare(back.farePerSeat);
    const outFare=Math.max(1,rawOut-Math.round(rawOut*d/100)),backFare=Math.max(1,rawBack-Math.round(rawBack*d/100));
    return {out:outFare+ui.luggageTotal()+ui.seatReservationFee(),back:backFare+ui.luggageTotal(),saving:rawOut+rawBack-outFare-backFare};
  }
  ui.tripReviewFare=()=>ui.checkoutTotal();
  const tripResult=ui.renderTripResult;
  ui.renderTripResult=(trip:any)=>{
    const template=document.createElement('template');template.innerHTML=tripResult(trip);
    if(state.ticketType==='return'){
      const price=template.content.querySelector('.taxi-price-tag strong'),e=estimate(trip);
      if(price)price.textContent=e?money(e.out+e.back):'Return unavailable';
    }
    return template.innerHTML;
  };
  const button=(action:string,label:string,attrs='')=>`<button type="button" class="button button--primary" data-action="${action}" ${attrs}>${label}</button>`;
  ui.reviewReturnOptions=()=>!available()?'<p>Return packages are not offered on this service right now.</p>':state.ticketType!=='return'
    ? `<div class="compact-option-intro"><div><strong>Add a prepaid return</strong><p>Both journeys are paid together. Return capacity is selected later.</p></div>${button('quick-return-toggle','Add return')}</div>`
    : `<div class="compact-choice-grid">${[['open','Open return'],['same-day','Same day'],['date-specific','Choose return date']].map(([v,label])=>`<button class="compact-choice ${mode()===v?'is-selected':''}" type="button" data-action="return-mode" data-value="${v}">${label}</button>`).join('')}</div>${mode()==='date-specific'?`<div class="field"><label for="review-return-date">Return date</label><input id="review-return-date" type="date" data-field="return-date" value="${esc(state.returnDate||'')}"></div>`:''}<p>The return must be used within ${c.config()?.returnValidityDays||0} days on the reverse direction. ${c.config()?.returnDiscountPercent||0}% fare discount; luggage and seat-choice charges are shown separately. Your return does not reserve a future departure.</p>${button('quick-return-toggle','Remove return')}`;
  ui.renderReturns=()=>`${ui.screenHead('Return package','Outbound booking and prepaid reverse journey.')}${ui.reviewReturnOptions()}`;
  const checkout=ui.renderCheckout;
  ui.renderCheckout=()=>{
    const template=document.createElement('template');template.innerHTML=checkout();
    if(state.ticketType==='return'){
      template.content.querySelectorAll('.detail-row').forEach(row=>{if(['Return saving','Base ticket fare','Seat reservation fee','Luggage charges','Service fee'].includes(row.querySelector('span')?.textContent||''))row.remove();});
      const e=estimate();
      const head=template.content.querySelector('.screen-head p');if(head)head.textContent='Review the prepaid outbound and return package. The final server quote includes payment fees.';
      if(e)template.content.querySelectorAll('.detail-list').forEach(list=>list.insertAdjacentHTML('beforeend',`<div class="detail-row"><span>Outbound allocation</span><strong>${money(e.out)}</strong></div><div class="detail-row"><span>Return allocation</span><strong>${money(e.back)}</strong></div><div class="detail-row"><span>Package fare saving</span><strong>${money(e.saving)}</strong></div><p>Allocations include luggage on both journeys and any outbound seat choice. Payment fees are confirmed in the server quote.</p>`));
      template.content.querySelector('.checkout-pay-btn span')?.replaceChildren(document.createTextNode('Review return package'));
      template.content.querySelectorAll('.quick-return-upsell').forEach(el=>el.remove());
    }
    return template.innerHTML;
  };
  async function load(){
    const run=++epoch,who=c.user()?.id;
    if(!who){packages=[];return;}
    const next=await api.getTaxipressReturns();
    if(run!==epoch||who!==c.user()?.id)return;
    packages=next.packages;
  }
  const card=(p:TaxipressReturnPackage)=>`<article class="card"><h3>Return package</h3><p>${esc(p.returnRoute?.fromName||'Return')} → ${esc(p.returnRoute?.toName||'journey')} · ${esc(p.returnState)}</p><p>${p.returnDate?`Travel date: ${esc(p.returnDate)} · `:''}Valid until ${esc(new Date(p.validUntil).toLocaleString('en-UG'))}</p><p>Outbound: ${money(p.outboundAmount)} · Return: ${money(p.returnAmount)}${p.refunded?` · Refunded: ${money(p.refunded)}`:''}</p>${p.returnBookingId?button('return-ticket','View return ticket',`data-booking="${esc(p.returnBookingId)}"`):p.returnState==='pending'&&p.returnPaid>0?button('return-redeem-form','Choose return departure',`data-id="${esc(p.id)}"`)+button('return-date-form','Change return date',`data-id="${esc(p.id)}"`)+button('return-cancel-review','Cancel unused return',`data-id="${esc(p.id)}"`):''}${p.outboundBookingId?button('return-ticket','View outbound ticket',`data-booking="${esc(p.outboundBookingId)}"`):''}${p.returnState==='pending'&&!p.outboundPaid?button('return-pay','Review package payment',`data-id="${esc(p.id)}"`):''}${button('return-refresh','Refresh package status',`data-id="${esc(p.id)}"`)}</article>`;
  const tickets=ui.renderTickets,ticket=ui.renderTicket;
  ui.renderTickets=()=>tickets()+(c.user()?packages.map(card).join(''):'');
  ui.renderTicket=()=>ticket()+(c.user()?packages.filter(p=>p.outboundBookingId===c.selected()?.id||p.returnBookingId===c.selected()?.id).map(card).join(''):'');
  const navigate=ui.navigate;
  ui.navigate=(screen:string,...args:any[])=>{navigate(screen,...args);if(c.user()&&['tickets','trips','ticket'].includes(screen))void load().then(()=>{if(['tickets','trips','ticket'].includes(state.screen))ui.renderCurrentScreen();}).catch(e=>ui.toast(e.message,'danger'));};
  let quoted:TaxipressReturnPackage|null=null;
  function showReview(q:TaxipressReturnPackage){
    ui.openModal('Confirm return package',`<p>Outbound: ${esc(q.returnRoute?.toName)} → ${esc(q.returnRoute?.fromName)}<br>Return: ${esc(q.returnRoute?.fromName)} → ${esc(q.returnRoute?.toName)}</p><p>Outbound allocation: ${money(q.outboundAmount)}<br>Return allocation: ${money(q.returnAmount)}</p><p>Wallet total: ${money(q.checkout?.wallet??q.wallet??q.total)}<br>Mobile-money total: ${money(q.checkout?.mobileMoney??q.mobileMoney??q.total)}</p><p>Return ${esc(q.mode)}${q.returnDate?` · ${esc(q.returnDate)}`:''}, valid until ${esc(new Date(q.validUntil).toLocaleString('en-UG'))}. Reverse direction only; seats are reserved when you redeem after outbound boarding. Unused return refund: ${q.refundPercent}%.</p><label for="return-payment-method">Pay with</label><select id="return-payment-method"><option value="wallet">Peebee wallet</option><option value="mobile">Mobile money</option></select><label for="return-msisdn">Mobile-money phone</label><input id="return-msisdn" type="tel" value="${esc(c.user()?.phone||'')}"><label><input id="return-package-consent" type="checkbox"> I accept both journey allocations and return conditions.</label>`,button('return-buy','Buy prepaid package'));
  }
  async function review(){
    if(busy)return;
    busy=true;
    try {
    if(!c.user()){c.requestLogin('checkout');return;}
    if(!available())throw new Error('Return packages are not offered right now.');
    if(state.paymentMethod==='cash'||state.taxibeeOpenTicket||state.taxibeeOfferCode)throw new Error('Choose wallet or mobile money. Packages already include their return discount and cannot use open-ticket or offer-code checkout.');
    const who=c.user()!.id;
    const stored=JSON.parse(sessionStorage.getItem(key())||'null');
    let next:TaxipressReturnPackage;
    if(stored?.stage==='creating')next=(await api.getTaxipressReturn(stored.id)).package;
    else{
      const holdId=await c.prepareSeats();
      if(who!==c.user()?.id)return;
      next=(await api.quoteTaxipressReturn({...c.input(holdId),mode:mode(),date:mode()==='date-specific'?state.returnDate:undefined})).package;
    }
    if(who!==c.user()?.id)return;
    quoted=next;
    if(stored?.stage!=='creating')sessionStorage.setItem(key(),JSON.stringify({id:quoted.id,stage:'quoted'}));
    showReview(quoted);
    } finally {busy=false;}
  }
  async function act(action:string,el:HTMLElement){
    const who=c.user()?.id;
    const owned=async<T>(request:Promise<T>)=>{const value=await request;if(who!==c.user()?.id)throw new Error('The signed-in account changed.');return value;};
    if(!who){c.requestLogin(state.screen);return;}
    const p=packages.find(p=>p.id===el.dataset.id);
    if(action==='return-buy'){
      if(!quoted||!(document.getElementById('return-package-consent') as HTMLInputElement)?.checked)throw new Error('Accept the package conditions to continue.');
      sessionStorage.setItem(key(),JSON.stringify({id:quoted.id,stage:'creating'}));
      const method=(document.getElementById('return-payment-method') as HTMLSelectElement).value;
      const msisdn=(document.getElementById('return-msisdn') as HTMLInputElement).value;
      const created=(await owned(api.createTaxipressReturn(quoted.id))).package;
      if(created.outboundPaid>0||['pending','unknown'].includes(created.payment?.status||'')){
        sessionStorage.removeItem(key());c.clearDraft();ui.closeModal();await owned(c.refresh());await owned(load());
        c.select((await owned(api.getTaxipressBooking(created.outboundBookingId!))).booking);ui.navigate('ticket');
        ui.toast('Existing package payment found. Refresh its status before paying again.','info');return;
      }
      const accepted=method==='wallet'?(quoted.checkout?.wallet??quoted.wallet):(quoted.checkout?.mobileMoney??quoted.mobileMoney);
      if((method==='wallet'?created.checkout?.wallet:created.checkout?.mobileMoney)!==accepted){quoted=created;throw new Error('The payment total changed. Close this dialog and review the package again.');}
      const funded=await owned(api.fundOrder(created.orderId!,{paymentMethod:method==='wallet'?'wallet':'mobile_money',useWallet:method==='wallet',msisdn:method==='mobile'?msisdn:undefined,acceptedAmount:accepted}));
      if(funded.payment?.status==='failed')throw new Error('The package payment failed. Refresh before retrying.');
      paymentId=funded.payment?.id||null;
      sessionStorage.removeItem(key());c.clearDraft();ui.closeModal();
      if(funded.redirectUrl){location.assign(funded.redirectUrl);return;}
      await owned(c.refresh());await owned(load());
      const b=(await owned(api.getTaxipressBooking(created.outboundBookingId!))).booking;c.select(b);ui.navigate('ticket');return;
    }
    if(action==='return-ticket'){const b=c.bookings().find(b=>b.id===el.dataset.booking);if(b){c.select(b);ui.navigate('ticket');}return;}
    if(!p)throw new Error('Refresh My Tickets to load the package.');
    if(action==='return-pay'){quoted=(await owned(api.getTaxipressReturn(p.id))).package;sessionStorage.setItem(key(),JSON.stringify({id:p.id,stage:'creating'}));showReview(quoted);return;}
    if(action==='return-refresh'){const id=p.payment?.id||paymentId;if(id&&['pending','unknown'].includes(p.payment?.status||''))await owned(api.refreshPayment(id));await owned(c.refresh());await owned(load());ui.renderCurrentScreen();return;}
    if(action==='return-redeem-form'){
      const cfg=c.config(),route=cfg?.routes.find(r=>r.id===p.returnRouteId);
      const queue=await owned(api.getTaxipressQueue(p.returnRouteId));
      const departures=queue.line.filter(v=>v.bookable&&v.seatsLeft>0);
      return ui.openModal('Choose return departure',`<p>${esc(route?.fromName)} → ${esc(route?.toName)}. Return seats use best-available allocation at no new charge.</p>`+(departures.length?departures.map(v=>button('return-redeem',`${esc(v.plate)} · ${v.seatsLeft} spaces`,`data-id="${esc(p.id)}" data-queue="${esc(v.id)}"`)).join(''):'<p>No return departures available.</p>'),'');
    }
    if(action==='return-redeem'){const r=await owned(api.redeemTaxipressReturn(p.id,el.dataset.queue!));await owned(c.refresh());c.select(r.booking);ui.closeModal();await owned(load());ui.navigate('ticket');return;}
    if(action==='return-cancel-review')return ui.openModal('Cancel unused return',`<p>Refund policy: ${p.refundPercent}% of the unused return collection (${money(Math.round(p.returnPaid*p.refundPercent/100))}). The outbound journey is unchanged.</p>`,button('return-cancel','Confirm return cancellation',`data-id="${esc(p.id)}"`));
    if(action==='return-cancel'){await owned(api.cancelTaxipressReturn(p.id));ui.closeModal();await owned(c.refresh());await owned(load());ui.navigate('tickets');return;}
    if(action==='return-date-form')return ui.openModal('Change return date',`<label for="return-new-date">Travel date within original validity</label><input id="return-new-date" type="date" value="${esc(p.returnDate||'')}">`,button('return-date-save','Save date',`data-id="${esc(p.id)}"`));
    if(action==='return-date-save'){await owned(api.changeTaxipressReturnDate(p.id,{mode:'date-specific',date:(document.getElementById('return-new-date') as HTMLInputElement).value}));ui.closeModal();await owned(load());ui.navigate('tickets');}
  }
  document.addEventListener('click',event=>{
    const el=(event.target as Element).closest<HTMLElement>('[data-action]'),action=el?.dataset.action||'';
    if(action==='taxibee-pay'){
      const b=c.bookings().find(b=>b.id===el?.dataset.id);
      if(b?.returnPackage?.leg==='outbound'){event.preventDefault();event.stopImmediatePropagation();const who=c.user()?.id;void api.getTaxipressReturn(b.returnPackage.id).then(r=>{if(!who||who!==c.user()?.id)return;quoted=r.package;showReview(quoted);}).catch(e=>ui.toast(e.message,'danger'));return;}
    }
    if(['quick-return-toggle','toggle-return-switch','select-ticket-type','return-mode'].includes(action)){
      event.preventDefault();event.stopImmediatePropagation();
      if(!available())return ui.toast('Return packages are not offered right now.','info');
      if(action==='quick-return-toggle'||action==='toggle-return-switch')state.ticketType=state.ticketType==='return'?'oneway':'return';
      if(action==='select-ticket-type')state.ticketType=el!.dataset.value;
      if(action==='return-mode'){state.returnMode=el!.dataset.value;state.ticketType='return';}
      ui.renderCurrentScreen();return;
    }
    if(!action.startsWith('return-'))return;
    event.preventDefault();event.stopImmediatePropagation();if(busy)return;busy=true;
    void act(action,el!).catch(e=>ui.toast(e.message,'danger')).finally(()=>{busy=false;});
  },true);
  return {review,estimate,load,reset(){sessionStorage.removeItem(key());++epoch;packages=[];quoted=null;busy=false;paymentId=null;}};
}
