(() => {
  const { byId } = globalThis.FinancialLineItems;
  const { currentMonth } = globalThis.FinancialAssumptions;
  const company = "Peebee";
  const stream = (name, method, fields) => ({ name, method, ...fields, growth: "0", days: "0" });
  const share = (name, rate) => stream(name, "percentage", { transactionValue: "0", rate: String(rate) });
  const orders = (name, count, orderValue, rate) => stream(name, "orders", {
    orders: String(count), orderValue: String(orderValue), rate: String(rate),
  });
  const subscription = (name, price) => stream(name, "subscription", {
    active: "0", newSubscribers: "0", churn: "0", price: String(price),
  });
  const units = (name, price) => stream(name, "units", { units: "0", price: String(price) });
  const monthly = name => stream(name, "direct", { amount: "0" });
  const cost = name => ({ name, amount: "0", month: "1", growth: "0" });
  const direct = name => ({ ...cost(name), basis: "fixed", stock: "0", inventoryDays: "0", payableDays: "0" });

  // Forecast inputs mirror repository defaults. The planner is standalone and does not read or change Admin settings.
  const catalog = [
    {
      key: "concierge", name: "Peebee Concierge",
      streams: [orders("Parcel delivery commission", 300, 5000, 0), orders("Shopping delivery commission", 150, 3000, 0),
        units("Concierge service fees", 0), share("Processing fees retained by Peebee", 0)],
      note: "The starting parcel and shopping counts and average delivery fees are illustrative planning estimates. For delivery commission, enter the delivery fee per order, excluding the value of goods. Delivery commission, service fees and processing fees start off in Monetization.",
    },
    {
      key: "buy", name: "Peebee Buy",
      streams: [share("Standard marketplace commission", 10), share("Elite marketplace commission", 5),
        share("Digital sales commission", 5), monthly("Marketplace promotion fees retained"),
        subscription("Pro Store monthly plans", 35000), subscription("Pro Live monthly plans", 75000),
        subscription("Elite monthly plans", 150000), monthly("Annual plan fees collected")],
      note: "Use separate sales volumes for standard, Elite and digital orders. Admin has a 5% promotion fee setting. Use the amount actually retained in the promotion fee line. Store plans default to free billing. The displayed plan prices apply only in paid mode. Count paying stores only.",
    },
    {
      key: "work", name: "Peebee Work",
      streams: [share("Home services commission", 15), share("Laundry provider commission", 15), units("Laundry customer fees", 0)],
      note: "Home services can override the default commission by service. Apply the laundry rate to provider earnings for the laundry work. Laundry customer fees default to off.",
    },
    {
      key: "rides", name: "Peebee Rides",
      streams: [share("Boda fare commission", 0), share("Car platform share", 10), monthly("Self-drive rental fees retained by Peebee"),
        subscription("Recurring rider access subscriptions", 0), subscription("Recurring Rider Pro subscriptions", 0),
        monthly("One-time rider access and Pro fees")],
      note: "Use the car settlement pool as the base for the default platform share. Vehicle category and rental terms can differ. Self-drive defaults to off with no agreed platform rate. Rider access and Pro billing default to off. Enter a monthly equivalent when a recurring plan bills weekly.",
    },
    {
      key: "learn", name: "Peebee Learn",
      streams: [share("Course and masterclass commission", 10), share("Bundle commission", 10),
        share("School pass commission", 10), share("School fee commission", 10)],
      note: "Use the Learn payment path for the Learn rate. Count a course sold through digital checkout under Buy only. Include TV-assisted enrolments with their original Learn sale.",
    },
    {
      key: "food", name: "Peebee Food",
      streams: [monthly("Food fees retained by Peebee")],
      note: "Enter the fees Peebee earns from food orders. Confirm collection terms in the restaurant agreement or settlement data.",
    },
    {
      key: "pharmacy", name: "Peebee Pharmacy",
      streams: [monthly("Pharmacy fees retained by Peebee")],
      note: "Enter Peebee's earned fees from pharmacy orders. Prescription receipts belong to the pharmacy unless Peebee is the seller.",
    },
    {
      key: "gas", name: "Peebee Gas",
      streams: [monthly("Gas partner fees retained by Peebee")],
      note: "Use the Peebee fees in partner agreements. Fuel sales in the Gas app are outlet turnover.",
    },
    {
      key: "taxipress", name: "TaxiPress",
      streams: [share("Digital seat commission", 0), share("Cash seat commission", 0), units("Seat-choice fees", 0)],
      note: "Cash and digital fare commission default to 0%. If Admin uses flat commission, change the driver to units and use booked seats and the flat fee.",
    },
    {
      key: "talent", name: "Peebee Jobs & Talent",
      streams: [share("Employer gig and project commission", 3), share("Worker gig commission", 10), share("Worker project commission", 8),
        units("Project listing fees", 2000), units("Hiring listing fees", 20000), units("Boost fees", 5000),
        units("Contact unlock fees", 1000), units("Application fees", 500), monthly("Placement and other hiring fees"),
        subscription("Worker Pro plans", 15000), subscription("Employer Pro plans", 40000)],
      note: "Jobs & Talent starts off and its migration-seeded fee rules start inactive. Count only paid activity after activation, including any free allowances and plan discounts. Placement fees use a minimum and maximum, so enter the monthly amount earned.",
    },
    {
      key: "services", name: "Peebee Services",
      streams: [share("Services platform commission", 5)],
      note: "Apply the commission to service payments handled by the Services platform. Work bookings use their own row under Peebee Work.",
    },
    {
      key: "creator-media", name: "Peebee Channels & Ads",
      streams: [share("Creator membership share", 15), share("Paid post share", 20),
        share("Tips share", 10), share("Live gift share", 10), share("Fundraising fee", 0), share("Ad revenue after creator share", 45)],
      note: "Creator monetization, fundraising and ads default to off. Use paid activity only after activation. The ad share assumes the configured 55% creator share. Track merchant promotion fees only once.",
    },
    {
      key: "wallet", name: "Peebee Wallet",
      streams: [monthly("Wallet fees retained by Peebee")],
      note: "Use net fees earned by Peebee from wallet activity. Customer balances, top-ups and withdrawals are movements of funds.",
    },
  ];

  function createDefaults() {
    return structuredClone({
      company, currency: "UGX", start: currentMonth, months: "36",
      channels: catalog.map(({ key, name }) => ({ key, name })),
      ...Object.fromEntries(catalog.map(({ key, streams }) => [`channel-${key}`, streams])),
      ...Object.fromEntries(Object.keys(byId).filter(id => id !== "streams").map(id => [id, []])),
      directCosts: ["Payment provider fees borne by Peebee", "Fulfilment costs borne by Peebee", "Promotions and credits funded by Peebee"].map(direct),
      staff: ["Operations and support", "Engineering and product", "Sales and partner onboarding", "Finance and administration"]
        .map(name => ({ ...cost(name), headcount: "0", burden: "0" })),
      expenses: ["Hosting, storage and video", "Maps and routing", "Messaging and verification",
        "Marketing", "Rent and utilities", "Professional fees and compliance", "Insurance"].map(cost),
      scenarios: "no", valuation: "no",
    });
  }

  globalThis.PeebeeDefaults = { company, catalog, createDefaults };
})();
