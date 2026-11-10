"""Reproduce the illustrative Shopping Concierge model; no live data or settings writes.

Run with the Codex bundled Python (Pillow is needed only for the chart).
Every commercial input below is an assumption, not an observed result or quote.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MONTHS_Y1 = [100, 150, 250, 350, 500, 650, 800, 1000, 1200, 1500, 1800, 2100]
MONTHS_Y2 = [2400, 2700, 3000, 3300, 3600, 3900, 4200, 4500, 4800, 5100, 5100, 5400]

def rounded_fee(amount):
    # Default app fee rounding: nearest UGX 500, half steps round upwards.
    return math.floor(amount / 500 + 0.5) * 500

def economics(basket=60000, provider_rate=0.02, support=500, loss=300, communications=100):
    delivery, service, commission_rate, processing_rate = 6000, 2000, 0.25, 0.02
    base = basket + delivery
    commission = rounded_fee(delivery * commission_rate)
    processing = rounded_fee(base * processing_rate)
    collection = base + service + processing
    provider_cost = collection * provider_rate
    core_revenue = service + commission
    fees_collected = core_revenue + processing
    contribution = fees_collected - provider_cost - support - loss - communications
    rider_payout = collection - service - processing - commission
    # Match the current cash handler: surcharge and commission come out of
    # the cash order's item-plus-delivery total, not an added customer surcharge.
    cash_platform_fees = service + processing + commission
    cash_rider_earnings = delivery - cash_platform_fees
    return dict(basket=basket, delivery=delivery, service=service,
                commission_rate=commission_rate, commission=commission,
                processing_rate=processing_rate, processing=processing,
                customer_payment=collection, provider_rate=provider_rate,
                provider_cost=provider_cost, core_revenue=core_revenue,
                fees_collected=fees_collected, support=support, loss=loss,
                communications=communications, contribution=contribution,
                rider_payout=rider_payout, rider_gross_earnings=rider_payout-basket,
                cash_customer_payment=base, cash_platform_fees=cash_platform_fees,
                cash_rider_gross_earnings=cash_rider_earnings)

base = economics()
cases = {
    "downside": economics(80000, 0.025, 800, 800, 100),
    "base": base,
    "upside": economics(50000, 0.015, 350, 150, 100),
}
annual = []
for year, orders, monthly_fixed, acquisition in [(1, sum(MONTHS_Y1), 8000000, 18000000),
                                                (2, sum(MONTHS_Y2), 10000000, 30000000),
                                                (3, 96000, 16000000, 48000000)]:
    contribution = orders * base["contribution"]
    annual.append(dict(year=year, orders=orders, goods_value=orders*base["basket"],
                       customer_payments=orders*base["customer_payment"],
                       core_revenue=orders*base["core_revenue"],
                       processing_recovery=orders*base["processing"],
                       fees_collected=orders*base["fees_collected"],
                       contribution=contribution, fixed_costs=monthly_fixed*12,
                       acquisition=acquisition,
                       operating_result=contribution-monthly_fixed*12-acquisition))

cashflow = []
cash = 160000000 - 20000000  # proposed funding less one-time launch preparation
for month, orders in enumerate(MONTHS_Y1 + MONTHS_Y2[:6], 1):
    fixed, acquisition = (8000000, 1500000) if month <= 12 else (10000000, 2500000)
    contribution = orders * base["contribution"]
    cash += contribution - fixed - acquisition
    cashflow.append(dict(month=month, orders=orders, contribution=contribution,
                         fixed=fixed, acquisition=acquisition, closing_cash=cash))

funding = dict(proposed_raise=160000000, setup=20000000,
               year_1_burn=-annual[0]["operating_result"],
               months_13_18_burn=sum(x["fixed"]+x["acquisition"]-x["contribution"] for x in cashflow[12:]),
               month_18_cash=cash,
               minimum_base_cash=min(x["closing_cash"] for x in cashflow))
downside_burn = 20000000 + (114000000 - sum(MONTHS_Y1)*0.5*cases["downside"]["contribution"]) + (75000000 - sum(MONTHS_Y2[:6])*0.5*cases["downside"]["contribution"])
funding["downside_18_month_need_before_buffer"] = downside_burn
funding["downside_shortfall_before_buffer"] = downside_burn - funding["proposed_raise"]
market = []
for label, accounts, frequency in [("low",10000,1),("base",20000,2),("high",30000,3)]:
    orders = accounts * frequency * 12
    market.append(dict(scenario=label, accounts=accounts, monthly_frequency=frequency,
                       annual_orders=orders, annual_goods_value=orders*base["basket"],
                       annual_core_revenue_pool=orders*base["core_revenue"]))
break_even = {str(y["year"]): math.ceil((y["fixed_costs"]+y["acquisition"])/12/base["contribution"]) for y in annual}

# Independent reconciliation checks catch revenue/principal confusion and cash gaps.
assert sum(MONTHS_Y1) == 10400 and sum(MONTHS_Y2) == 48000
assert base["customer_payment"] == base["rider_payout"] + base["fees_collected"]
assert base["rider_gross_earnings"] == 4500 and base["cash_rider_gross_earnings"] == 1000
assert base["contribution"] == 2710
assert [x["operating_result"] for x in annual] == [-85816000, -19920000, 20160000]
assert funding["setup"] + funding["year_1_burn"] + funding["months_13_18_burn"] + cash == funding["proposed_raise"]
assert cash == 30403000 and downside_burn == 193434375

result = dict(status="Illustrative assumptions only; not a forecast or current admin settings",
              currency="UGX", periods="Years since commercial launch; no calendar launch date assumed",
              reviewed_code_commit="4871a68f9e475728c7e45624d817a7f06968d671",
              cases=cases, annual=annual, cashflow_18_months=cashflow, funding=funding,
              market_scenarios=market, break_even_orders_per_month=break_even)
(ROOT / "financial-model.json").write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8")

def chart():
    from PIL import Image, ImageDraw, ImageFont
    im = Image.new("RGB", (1500, 720), "#fffdf7")
    d = ImageDraw.Draw(im)
    font = lambda size: ImageFont.truetype("C:/Windows/Fonts/arial.ttf", size)
    ink, gold, gray = "#27251f", "#9d7928", "#69665f"
    d.text((65,35), "Shopping Concierge illustrative operating results", font=font(35), fill=ink)
    d.text((65,85), "UGX millions | Assumptions only | Before tax and launch setup costs", font=font(23), fill=gray)
    left, right, top, bottom, maxval, minval = 160, 1430, 145, 600, 300, -120
    yy = lambda v: top + (maxval-v)/(maxval-minval)*(bottom-top)
    for v in [-100,0,100,200,300]:
        y = yy(v)
        d.line((left,y,right,y), fill="#d8d4c8", width=2 if v == 0 else 1)
        d.text((65,y-14), str(v), font=font(23), fill=gray)
    series = [("Contribution", "contribution", gold), ("Fixed costs and acquisition", None, "#b5afa0"), ("Operating result", "operating_result", ink)]
    for i, row in enumerate(annual):
        center = 360+i*440
        for j, (_, key, color) in enumerate(series):
            value = (row[key] if key else row["fixed_costs"]+row["acquisition"])/1000000
            x = center+(j-1)*95
            d.rectangle((x-35,min(yy(0),yy(value)),x+35,max(yy(0),yy(value))), fill=color)
            label = f"{value:.1f}"
            box = d.textbbox((0,0),label,font=font(22))
            d.text((x-(box[2]-box[0])/2,yy(value)-29 if value>=0 else yy(value)+8),label,font=font(22),fill=ink)
        d.text((center-45,615),f"Year {i+1}",font=font(24),fill=ink)
    for x,(label,_,color) in zip([140,510,1090],series):
        d.rectangle((x,675,x+20,695),fill=color)
        d.text((x+30,670),label,font=font(22),fill=ink)
    im.save(ROOT / "operating-scenarios.png")

if __name__ == "__main__":
    chart()
    print(json.dumps({"annual":annual,"funding":funding,"break_even":break_even},indent=2))
