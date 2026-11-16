(() => {
  const { byId } = globalThis.FinancialLineItems;
  const { currentMonth } = globalThis.FinancialAssumptions;
  const company = "Peebee";
  const stream = (name, method, fields) => ({ name, method, ...fields, growth: "0", days: "0" });
  const orders = (name, count, orderValue, rate) => stream(name, "orders", {
    orders: String(count), orderValue: String(orderValue), rate: String(rate),
  });
  const subscription = (name, active, newSubscribers, price) => stream(name, "subscription", {
    active: String(active), newSubscribers: String(newSubscribers), churn: "5", price: String(price),
  });
  const units = (name, count, price) => stream(name, "units", { units: String(count), price: String(price) });
  const cost = name => ({ name, amount: "0", month: "1", growth: "0" });
  const direct = name => ({ ...cost(name), basis: "fixed", stock: "0", inventoryDays: "0", payableDays: "0" });

  // Starter estimates describe a launch scenario. Volumes and unverified prices are editable forecast assumptions.
  const catalog = [
    {
      key: "concierge", name: "Peebee Concierge",
      streams: [orders("Parcel delivery commission", 300, 5000, 8), orders("Shopping delivery commission", 150, 3000, 8),
        units("Concierge service fees", 450, 500), orders("Processing fees retained by Peebee", 180, 8000, 1)],
      note: "Use the delivery fee per order as the commission base and exclude the value of goods. The starter assumes order fees are enabled and applies processing fees only to eligible paid transactions.",
    },
    {
      key: "buy", name: "Peebee Buy",
      streams: [orders("Standard marketplace commission", 500, 35000, 10), orders("Elite marketplace commission", 160, 55000, 5),
        orders("Digital sales commission", 60, 20000, 5), units("Marketplace promotion fees retained", 8, 5000),
        subscription("Pro Store monthly plans", 12, 2, 35000), subscription("Pro Live monthly plans", 4, 1, 75000),
        subscription("Elite monthly plans", 3, 1, 150000), units("Annual plan fees collected", 1, 350000)],
      note: "Use separate sales volumes for standard, Elite and digital orders. The starter assumes paid billing. Count only paying stores and keep annual plan sales separate from monthly subscribers. For promotions enter the average fee Peebee retains.",
    },
    {
      key: "work", name: "Peebee Work",
      streams: [orders("Home services commission", 90, 50000, 15), orders("Laundry provider commission", 140, 24000, 15),
        units("Laundry customer fees", 140, 500)],
      note: "Home services can override the default commission by service. Apply the laundry rate to provider earnings for the laundry work. The starter assumes laundry customer fees are enabled in addition to provider commission.",
    },
    {
      key: "rides", name: "Peebee Rides",
      streams: [orders("Boda fare commission", 800, 6500, 5), orders("Car platform share", 180, 24000, 10),
        orders("Self-drive rental fees retained by Peebee", 8, 120000, 10),
        subscription("Recurring rider access subscriptions", 30, 4, 10000), subscription("Recurring Rider Pro subscriptions", 12, 2, 15000),
        units("One-time rider access and Pro fees", 5, 10000)],
      note: "Use the car settlement pool as the base for the default platform share. Vehicle category and rental terms can differ. The starter assumes self-drive and rider subscriptions are enabled and uses an illustrative rental take rate. Separate one-time buyers from recurring subscribers.",
    },
    {
      key: "learn", name: "Peebee Learn",
      streams: [orders("Course and masterclass commission", 100, 35000, 10), orders("Bundle commission", 30, 60000, 10),
        orders("School pass commission", 40, 25000, 10), orders("School fee commission", 35, 90000, 10)],
      note: "Use the Learn payment path for the Learn rate. Count a course sold through digital checkout under Buy only. Include TV-assisted enrolments with their original Learn sale.",
    },
    {
      key: "food", name: "Peebee Food",
      streams: [orders("Food fees retained by Peebee", 420, 24000, 8)],
      note: "The fees use an illustrative restaurant order commission. Replace the rate with the agreed terms.",
    },
    {
      key: "pharmacy", name: "Peebee Pharmacy",
      streams: [orders("Pharmacy fees retained by Peebee", 90, 32000, 5)],
      note: "The starter uses an illustrative commission on partner pharmacy orders. Only Peebee’s fee counts as revenue.",
    },
    {
      key: "gas", name: "Peebee Gas",
      streams: [orders("Gas partner fees retained by Peebee", 140, 45000, 2)],
      note: "The starter applies an illustrative fee to eligible partner transactions. Fuel sales belong to the outlet.",
    },
    {
      key: "taxipress", name: "TaxiPress",
      streams: [orders("Digital seat commission", 220, 12000, 4), orders("Cash seat commission", 320, 12000, 3),
        units("Seat-choice fees", 45, 500)],
      note: "The starter assumes cash and digital fares have separate commissions. For flat pricing, use booked seats and the fee per seat.",
    },
    {
      key: "talent", name: "Peebee Jobs & Talent",
      streams: [orders("Employer gig and project commission", 65, 90000, 3), orders("Worker gig commission", 50, 66000, 10),
        orders("Worker project commission", 15, 170000, 8), units("Project listing fees", 18, 2000),
        units("Hiring listing fees", 8, 20000), units("Boost fees", 15, 5000),
        units("Contact unlock fees", 30, 1000), units("Application fees", 70, 500),
        units("Placement and other hiring fees", 3, 50000),
        subscription("Worker Pro plans", 20, 5, 15000), subscription("Employer Pro plans", 8, 2, 40000)],
      note: "The starter assumes paid services are enabled. Employer and worker commissions apply to opposite sides of the same contract. Use chargeable events after free allowances and discounts. Placement uses the average fee earned per placement.",
    },
    {
      key: "services", name: "Peebee Services",
      streams: [orders("Services platform commission", 65, 85000, 5)],
      note: "Apply the commission to service payments handled by the Services platform. Work bookings use their own row under Peebee Work.",
    },
    {
      key: "creator-media", name: "Peebee Channels & Ads",
      streams: [orders("Creator membership share", 120, 8000, 15), orders("Paid post share", 180, 3000, 20),
        orders("Tips share", 70, 4000, 10), orders("Live gift share", 110, 2500, 10),
        orders("Fundraising fee", 35, 20000, 0), orders("Ad revenue after creator share", 200, 3000, 45)],
      note: "The starter assumes creator monetization and ads are enabled. Ad units represent groups of 1,000 paid impressions at an illustrative CPM. Donations carry a 0% take rate. Track merchant promotion fees only once.",
    },
    {
      key: "wallet", name: "Peebee Wallet",
      streams: [units("Wallet fees retained by Peebee", 280, 500)],
      note: "Use the net fee Peebee earns per chargeable wallet transaction. Wallet balances and transfer principal are movements of funds.",
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

  function loadStarterRevenue(answers) {
    for (const channel of answers.channels || []) {
      const starter = catalog.find(item => item.key === channel.key || item.name === channel.name);
      if (!starter) continue;
      const id = `channel-${channel.key}`;
      const rows = answers[id] || [];
      const byName = new Map(starter.streams.map(row => [row.name, row]));
      const updated = rows.map(row => {
        const preset = byName.get(row.name);
        if (!preset) return row;
        byName.delete(row.name);
        return { ...preset, growth: row.growth || preset.growth, days: row.days || preset.days };
      });
      answers[id] = [...updated, ...Array.from(byName.values(), row => ({ ...row }))];
    }
  }

  globalThis.PeebeeDefaults = { company, catalog, createDefaults, loadStarterRevenue };
})();
