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

  const workers = "https://developers.cloudflare.com/workers/platform/pricing/";
  const d1 = "https://developers.cloudflare.com/d1/platform/pricing/";
  const r2 = "https://developers.cloudflare.com/r2/pricing/";
  const streamPricing = "https://developers.cloudflare.com/stream/pricing/";
  const technologyCosts = [
    ["Cloudflare Workers paid plan", "account subscriptions", "5", "0", workers, "$5/month minimum if the account is on Workers Paid. Enter 1 subscription if applicable."],
    ["Cloudflare Workers requests", "million requests", "0.30", "10", workers, "Enter dynamic Worker requests before subtracting the included allowance."],
    ["Cloudflare Workers CPU", "million CPU milliseconds", "0.02", "30", workers, "Workers Paid CPU duration. Use the monthly billing metric."],
    ["Cloudflare D1 reads", "million rows read", "0.001", "25000", d1, "Workers Paid allowance. Enter rows read, including scans."],
    ["Cloudflare D1 writes", "million rows written", "1", "50", d1, "Workers Paid allowance across D1 databases."],
    ["Cloudflare D1 storage", "GB-month", "0.75", "5", d1, "Workers Paid database storage."],
    ["Cloudflare R2 storage", "GB-month", "0.015", "10", r2, "Standard storage pricing."],
    ["Cloudflare R2 writes and lists", "million Class A operations", "4.50", "1", r2, "Standard storage operation pricing."],
    ["Cloudflare R2 reads", "million Class B operations", "0.36", "10", r2, "Standard storage operation pricing."],
    ["Cloudflare Stream storage", "blocks of 1,000 stored minutes", "5", "0", streamPricing, "Enter the number of prepaid 1,000-minute blocks, rounded up."],
    ["Cloudflare Stream delivery", "thousand viewer-minutes", "1", "0", streamPricing, "Video on demand and live viewing billed by delivered minutes."],
    ["Cloudflare Realtime calls", "GB of metered egress", "0.05", "1000", "https://developers.cloudflare.com/realtime/sfu/platform/pricing/", "Cloudflare SFU and TURN share one allowance. Use the aggregate for both."],
    ["Cloudflare Workers AI", "thousand billable Neurons", "0.011", "0", "https://developers.cloudflare.com/workers-ai/platform/pricing/", "Enter only Neurons billed above the daily allowance. Covers Cloudflare AI calls such as voice transcription and interpretation."],
    ["Gemini 2.5 Flash text and image input", "million paid input tokens", "0.30", "0", "https://aistudio.google.com/docs/pricing#gemini-2.5-flash", "Standard text, image and video input. Google says this model changes to 3.5 Flash-Lite rates on December 1, 2026."],
    ["Gemini 2.5 Flash output", "million paid output tokens", "2.50", "0", "https://aistudio.google.com/docs/pricing#gemini-2.5-flash", "Standard output including thinking tokens. Set a new phase for the published December 1 change."],
    ["Gemini speech synthesis input", "million paid text tokens", "0.50", "0", "https://aistudio.google.com/docs/pricing#gemini-2.5-flash-preview-tts", "2.5 Flash Preview TTS input used for voice generation."],
    ["Gemini speech synthesis output", "million paid audio tokens", "10", "0", "https://aistudio.google.com/docs/pricing#gemini-2.5-flash-preview-tts", "2.5 Flash Preview TTS audio output. Confirm the model used for the month."],
    ["Self-hosted TURN relay", "", "", "", "", "Optional fallback for direct WebRTC calls. Enter the server or managed relay bill only if Peebee uses it."],
    ["Cloudinary media", "monthly Plus subscriptions", "99", "0", "https://cloudinary.com/pricing", "Plus list price benchmark. Enter 1 only if billed on that plan."],
    ["Bunny Stream", "", "", "", "https://bunny.net/pricing/stream/", "Optional video provider. Enter the storage and CDN bill for the regions used."],
    ["Mux video", "", "", "", "https://www.mux.com/docs/pricing/video", "Optional video provider. Enter the invoice or model input, storage and delivery separately by resolution."],
    ["Livepeer video", "", "", "", "https://livepeer.studio/pricing", "Optional video provider. Growth has a $100 monthly minimum; the invoice also depends on usage."],
    ["Resend email", "monthly Pro subscriptions", "20", "0", "https://resend.com/pricing", "Pro list price benchmark. Confirm the active plan and any email or domain overage."],
    ["Africa’s Talking SMS and verification", "", "", "", "https://help.africastalking.com/en/", "Enter the Ugandan invoice or contracted rate for the sending route and destination."],
    ["Twilio SMS to Uganda", "outbound SMS segments", "0.3289", "0", "https://www.twilio.com/en-us/sms/pricing/ug", "Optional provider. Published outbound base rate; carrier and number fees can be separate."],
    ["WhatsApp Business messaging", "", "", "", "https://developers.facebook.com/documentation/business-messaging/whatsapp/overview/", "Optional activation channel. Enter the invoice or rate for the message category and destination."],
    ["Maps, routing and geocoding", "", "", "", "https://www.mapbox.com/pricing", "Admin can select OpenStreetMap, Google, Mapbox, MapTiler, Stadia, Thunderforest, Jawg or TomTom. Enter the active vendor’s bill."],
    ["Domain renewals", "", "", "", "", "Enter the registrar invoice. Set the same first and last expense month for a one-time renewal."],
    ["GitHub builds and artifacts", "", "", "", "https://docs.github.com/en/billing/concepts/product-billing/github-actions", "Confirm plan, runner minutes, storage and any included usage."],
    ["Payment gateway and payout fees", "", "", "", "", "Model fees borne by Peebee under Direct costs. Add a line here only for a separate fixed plan charge."],
  ];

  function infrastructureRows(currency) {
    return technologyCosts.map(([name, unit, unitCost, included]) => {
      const fixed = { ...cost(name), category: "technology", basis: "fixed", priceCurrency: "model", cadence: "annual" };
      if (!unit) return fixed;
      return { ...fixed, basis: "usage", priceCurrency: "USD", unitCost, included, quantity: "0",
        fx: currency === "USD" ? "1" : "", cadence: "monthly" };
    });
  }

  function createDefaults() {
    return structuredClone({
      company, currency: "UGX", start: currentMonth, months: "36",
      channels: catalog.map(({ key, name }) => ({ key, name })),
      ...Object.fromEntries(catalog.map(({ key, streams }) => [`channel-${key}`, streams])),
      ...Object.fromEntries(Object.keys(byId).filter(id => id !== "streams").map(id => [id, []])),
      directCosts: ["Payment provider fees borne by Peebee", "Fulfilment costs borne by Peebee", "Promotions and credits funded by Peebee"].map(direct),
      staff: ["Operations and support", "Engineering and product", "Sales and partner onboarding", "Finance and administration"]
        .map(name => ({ ...cost(name), roleType: "fixed", salaryBasis: "monthly", headcount: "0", burden: "0" })),
      expenses: [...infrastructureRows("UGX"),
        ...["Marketing", "Rent and utilities", "Professional fees and compliance", "Insurance"].map(name =>
          globalThis.FinancialLineItems.expenseDefaults(cost(name)))],
      hireEquipment: "none", vatCadence: "off", scenarios: "no", valuation: "no",
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

  globalThis.PeebeeDefaults = { company, catalog, technologyCosts, infrastructureRows, createDefaults, loadStarterRevenue };
})();
