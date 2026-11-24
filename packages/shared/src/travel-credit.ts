export type TravelAccount={id:string;name:string;owner_id:string;active:number;available:number;credit_limit?:number;outstanding?:number;member_active?:number;per_booking?:number;monthly_limit?:number;monthly_used?:number};
export type TravelVoucher={id:string;issuer_id:string;recipient_id:string;amount:number;balance:number;state:string;expires_at:string;request_id?:string|null};
export type TravelCreditOverview={ready:boolean;corporateEnabled:boolean;vouchersEnabled:boolean;voucherMax:number;voucherDays:number;accounts:TravelAccount[];vouchers:TravelVoucher[]};
export type TravelCreditSource={accountId?:string;voucherId?:string;voucherCode?:string};
export type TravelCreditQuote={total:number;sponsored:number;walletAmount:number;label:string;allocations:{orderId:string;amount:number}[]};
export type TravelCreditStatement={account:TravelAccount&{credit_limit:number;outstanding:number};ledger:{id:string;kind:string;amount:number;order_id:string|null;reference:string|null;created_at:string}[];members:{user_id:string;active:number;per_booking:number;monthly_limit:number}[]};
