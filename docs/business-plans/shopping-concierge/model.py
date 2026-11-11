"""Generate the Shopping Concierge pricing and financial scenarios with Python 3."""

import json
from fractions import Fraction
from pathlib import Path

SHOPPING_FEE = 1_000
RIDE_MINIMUM = 2_000
FIRST_BAND_KM = 2
FIRST_BAND_RATE = 1_500
LATER_BAND_RATE = 1_000
PLATFORM_SHARE_PER_SIDE = Fraction(25, 1000)
MOBILE_MONEY_RATE = Fraction(3, 100)
PROVIDER_FEE_TAX_RATE = Fraction(15, 100)
STANDARD_VAT_RATE = Fraction(18, 100)
CORPORATE_TAX_RATE = Fraction(30, 100)
CASH_RIDER_FEE_RECOVERY = Fraction(95, 100)
VARIABLE_OPERATING_COST = 150
# Phase amounts exclude the UGX 2m rider branding and collateral in launch setup.
MARKETING_PHASES = {
    "pilot": {"meta": 1_500_000, "tiktok": 1_000_000, "google_search_and_app": 1_500_000},
    "corridor_expansion": {
        "meta": 3_500_000, "tiktok": 2_500_000, "google_search_and_app": 1_500_000,
        "collateral": 1_000_000, "radio": 5_000_000, "billboard": 10_000_000,
        "creators": 3_500_000, "sms": 1_500_000, "creative": 1_500_000,
        "marketing_contingency": 500_000, "permits": 1_000_000,
    },
    "retention": {
        "meta": 3_000_000, "tiktok": 2_000_000, "google_search_and_app": 1_500_000,
        "collateral": 1_000_000, "radio": 2_000_000, "creators": 1_500_000,
        "sms": 1_500_000, "creative": 500_000, "marketing_contingency": 1_500_000,
        "permits": 1_000_000,
    },
}


def quote(goods, distance_km):
    # Illustrative marginal distance bands. Example distances are whole kilometres.
    ride = max(
        RIDE_MINIMUM,
        min(distance_km, FIRST_BAND_KM) * FIRST_BAND_RATE
        + max(0, distance_km - FIRST_BAND_KM) * LATER_BAND_RATE,
    )
    delivery = ride + SHOPPING_FEE
    subtotal = goods + delivery
    share = subtotal * PLATFORM_SHARE_PER_SIDE
    return {
        "goods": goods,
        "distance_km": distance_km,
        "ride": ride,
        "shopping": SHOPPING_FEE,
        "delivery": delivery,
        "subtotal": subtotal,
        "customer_share": share,
        "rider_share": share,
        "customer_total": subtotal + share,
        "rider_delivery_earnings": delivery - share,
        "platform_fee_assessed": 2 * share,
    }


def payment_charges(pricing):
    collection = pricing["customer_total"] * MOBILE_MONEY_RATE
    rider_payout = pricing["goods"] + pricing["rider_delivery_earnings"]
    transfer = 1_000 if rider_payout < 125_000 else rider_payout * Fraction(12, 1000)
    return {
        "aggregator_collection_fee": collection,
        "mobile_money_payout_fee": transfer,
        "provider_fee_tax": (collection + transfer) * PROVIDER_FEE_TAX_RATE,
    }


def order_economics(pricing, cash_share):
    digital_share = 1 - cash_share
    cash_income = (
        pricing["customer_share"] + pricing["rider_share"] * CASH_RIDER_FEE_RECOVERY
    )
    collected_fees = cash_share * cash_income + digital_share * pricing["platform_fee_assessed"]
    payment = {name: digital_share * fee for name, fee in payment_charges(pricing).items()}
    payment_cost = sum(payment.values())
    return {
        **payment,
        "collected_fees": collected_fees,
        "payment_cost": payment_cost,
        "contribution": collected_fees - payment_cost - VARIABLE_OPERATING_COST,
    }


def projection(pricing, orders, fixed, cash_share, incremental_marketing=0):
    unit = order_economics(pricing, cash_share)
    operating_result = orders * unit["contribution"] - fixed - incremental_marketing
    corporate_tax = max(0, operating_result) * CORPORATE_TAX_RATE
    output_vat = orders * unit["collected_fees"] * STANDARD_VAT_RATE / (1 + STANDARD_VAT_RATE)
    vat_case_profit = operating_result - output_vat
    return {
        "orders": orders,
        "goods_value": orders * pricing["goods"],
        "delivery_charges": orders * pricing["delivery"],
        "customer_order_value": orders * pricing["customer_total"],
        "customer_fee_assessed": orders * pricing["customer_share"],
        "rider_fee_assessed": orders * pricing["rider_share"],
        "platform_fees_assessed": orders * pricing["platform_fee_assessed"],
        "platform_fee_income": orders * unit["collected_fees"],
        "aggregator_collection_cost": orders * unit["aggregator_collection_fee"],
        "mobile_money_payout_cost": orders * unit["mobile_money_payout_fee"],
        "provider_fee_tax": orders * unit["provider_fee_tax"],
        "payment_cost": orders * unit["payment_cost"],
        "variable_operating_cost": orders * VARIABLE_OPERATING_COST,
        "contribution": orders * unit["contribution"],
        "fixed_operating_cost": fixed,
        "incremental_marketing": incremental_marketing,
        "operating_result": operating_result,
        "illustrative_corporate_income_tax": corporate_tax,
        "result_after_income_tax": operating_result - corporate_tax,
        "vat_registered_sensitivity": {
            "vat_inclusive_output_tax_no_input_credit": output_vat,
            "operating_result": vat_case_profit,
            "result_after_income_tax": vat_case_profit - max(0, vat_case_profit) * CORPORATE_TAX_RATE,
        },
    }


def first_year_runway(pricing, monthly_orders, cash_share, vat_inclusive=False):
    monthly_fixed = 2_000_000
    unit = order_economics(pricing, cash_share)
    contribution = unit["contribution"]
    if vat_inclusive:
        contribution -= unit["collected_fees"] * STANDARD_VAT_RATE / (1 + STANDARD_VAT_RATE)
    cumulative_result = 0
    months = []
    for month, orders in enumerate(monthly_orders, start=1):
        result = orders * contribution - monthly_fixed
        cumulative_result += result
        months.append({
            "month": month,
            "orders": orders,
            "operating_cash_result": result,
            "cumulative_operating_cash_result": cumulative_result,
        })
    return {
        "cash_share": cash_share,
        "vat_inclusive": vat_inclusive,
        "contribution_per_order": contribution,
        "monthly_fixed_cost": monthly_fixed,
        "months": months,
        "peak_operating_cash_deficit": max(0, -min(row["cumulative_operating_cash_result"] for row in months)),
    }


def main():
    reference = quote(60_000, 1)
    years = [(6_000, 24_000_000), (18_000, 36_000_000), (36_000, 48_000_000)]
    base_cash_share = Fraction(80, 100)
    phase_budgets = {phase: sum(uses.values()) for phase, uses in MARKETING_PHASES.items()}
    pilot_budget = phase_budgets["pilot"]
    full_marketing_budget = sum(phase_budgets.values())
    base = [
        projection(reference, orders, fixed, base_cash_share, pilot_budget if year == 1 else 0)
        for year, (orders, fixed) in enumerate(years, start=1)
    ]
    sensitivities = {
        str(percent): {
            "per_order": order_economics(reference, Fraction(percent, 100)),
            "year_three": projection(reference, *years[-1], Fraction(percent, 100)),
        }
        for percent in (0, 50, 80, 95, 100)
    }
    monthly_orders = [100, 150, 250, 550, 600, 650, 600, 600, 600, 600, 650, 650]
    launch_budget = {
        "checkout_distance_and_fee_work": 6_000_000,
        "payment_testing_and_compliance_preparation": 2_000_000,
        "rider_recruitment_and_training": 2_000_000,
        "pilot_launch_materials_and_community_activation": 2_000_000,
    }
    funding_uses = {
        "launch_setup": sum(launch_budget.values()),
        "operating_runway": 22_000_000,
        "pilot_digital_advertising": pilot_budget,
        "working_capital": 4_000_000,
        "contingency": 2_000_000,
    }
    result = {
        "currency": "UGX",
        "status": "Founder pricing policy with illustrative distance bands and planning assumptions",
        "inputs": {
            "ride_minimum": RIDE_MINIMUM,
            "shopping_fee": SHOPPING_FEE,
            "illustrative_first_band_km": FIRST_BAND_KM,
            "illustrative_first_band_ugx_per_km": FIRST_BAND_RATE,
            "illustrative_later_band_ugx_per_km": LATER_BAND_RATE,
            "platform_share_per_side": PLATFORM_SHARE_PER_SIDE,
            "mobile_money_collection_rate": MOBILE_MONEY_RATE,
            "provider_fee_tax_rate_scenario": PROVIDER_FEE_TAX_RATE,
            "standard_vat_rate_sensitivity": STANDARD_VAT_RATE,
            "illustrative_corporate_income_tax_rate": CORPORATE_TAX_RATE,
            "cash_rider_fee_recovery_rate": CASH_RIDER_FEE_RECOVERY,
            "variable_operating_cost": VARIABLE_OPERATING_COST,
            "base_cash_share": base_cash_share,
        },
        "example_quotes": [
            {**pricing, **payment_charges(pricing)}
            for pricing in (quote(goods, km) for goods, km in
                            [(10_000, 1), (20_000, 2), (40_000, 3), (60_000, 1), (60_000, 5)])
        ],
        "reference_quote": reference,
        "base_years": base,
        "cash_share_sensitivity_percent": sensitivities,
        "cumulative_base_operating_result": sum(row["operating_result"] for row in base),
        "funding_ask": {
            "horizon_months": 12,
            "total": sum(funding_uses.values()),
            "uses": funding_uses,
            "marketing_strategy": {
                "phase_uses": MARKETING_PHASES,
                "phase_budgets_outside_setup": phase_budgets,
                "phase_order_targets": {
                    "pilot": sum(monthly_orders[:3]),
                    "corridor_expansion": sum(monthly_orders[3:6]),
                    "retention": sum(monthly_orders[6:]),
                },
                "phase_core_operating_results_before_marketing": {
                    "pilot": projection(reference, sum(monthly_orders[:3]), 6_000_000, base_cash_share)["operating_result"],
                    "corridor_expansion": projection(reference, sum(monthly_orders[3:6]), 6_000_000, base_cash_share)["operating_result"],
                    "retention": projection(reference, sum(monthly_orders[6:]), 12_000_000, base_cash_share)["operating_result"],
                },
                "collateral_in_setup": launch_budget["pilot_launch_materials_and_community_activation"],
                "full_marketing_spend_including_setup_collateral": full_marketing_budget + launch_budget["pilot_launch_materials_and_community_activation"],
                "ask_through_corridor_expansion": sum(funding_uses.values()) + phase_budgets["corridor_expansion"],
                "full_funding_envelope": sum(funding_uses.values()) + full_marketing_budget - pilot_budget,
                "year_one_with_full_marketing": projection(reference, *years[0], base_cash_share, full_marketing_budget),
            },
            "launch_setup_breakdown": launch_budget,
            "working_capital_breakdown": {
                "purchasing_and_settlement_reserve": 3_000_000,
                "refunds_and_disputes_reserve": 1_000_000,
            },
            "base": first_year_runway(reference, monthly_orders, base_cash_share),
            "downside": first_year_runway(
                reference, [orders // 2 for orders in monthly_orders], Fraction(1, 2), vat_inclusive=True
            ),
        },
    }
    Path(__file__).with_name("financial-model.json").write_text(
        json.dumps(result, indent=2, default=float) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
