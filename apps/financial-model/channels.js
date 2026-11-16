(() => {
  const { channels, channelStreams } = globalThis.FinancialLineItems;
  const { example } = globalThis.FinancialAssumptions;
  const channelNames = channels.presets;
  const channelKey = row => `channel-${row.key}`;
  const channelRows = answers => (Array.isArray(answers.channels) ? answers.channels : [])
    .filter(row => typeof row?.key === "string" && /^[a-z0-9-]{1,64}$/.test(row.key));

  function questionsFor(questions, answers) {
    return questions.flatMap(prompt => prompt.id !== "streams" ? [prompt] : [
      channels,
      ...channelRows(answers).map((row, index) => {
        const name = row.name || `Channel ${index + 1}`;
        return {
          ...channelStreams,
          id: channelKey(row),
          label: `Revenue streams for ${name}`,
          exportLabel: `Revenue · ${name}`,
        };
      }),
    ]);
  }

  function consolidate(answers) {
    const streams = [];
    const lines = [];
    for (const channel of channelRows(answers)) {
      const indices = [];
      for (const stream of answers[channelKey(channel)] || []) {
        const index = streams.length;
        streams.push({ ...stream, name: `${channel.name} · ${stream.name}` });
        indices.push(index);
        lines.push([`${channel.name} · ${stream.name}`, row => row.details.streams[index].revenue, "detail"]);
      }
      lines.push([`${channel.name} total`, row => indices.reduce((total, i) => total + row.details.streams[i].revenue, 0), "total"]);
    }
    lines.push(["Consolidated revenue", "revenue", "total"]);
    return {
      answers: { ...answers, streams },
      report: { id: "channel-revenue", name: "Revenue by channel", lines },
    };
  }

  const multiExample = {
    ...example,
    company: "Peebee (illustrative)", currency: "UGX",
    channels: channelNames.map((name, index) => ({ name, key: `example-${index}` })),
    "channel-example-0": [
      { name: "Transaction fees", method: "percentage", transactionValue: "20000000", rate: "5", growth: "3", days: "0" },
      { name: "Share of rider payouts", method: "percentage", transactionValue: "10000000", rate: "10", growth: "3", days: "0" },
      { name: "Rider subscriptions", method: "subscription", active: "40", newSubscribers: "6", churn: "4", price: "25000", growth: "3", days: "0" },
    ],
    "channel-example-1": [{ name: "Marketplace commissions", method: "percentage", transactionValue: "18000000", rate: "8", growth: "4", days: "0" }],
    "channel-example-2": [{ name: "Service bookings", method: "units", units: "160", price: "7500", growth: "4", days: "7" }],
    "channel-example-3": [{ name: "Ride commissions", method: "percentage", transactionValue: "18000000", rate: "12", growth: "5", days: "0" }],
    "channel-example-4": [{ name: "Course enrolments", method: "units", units: "35", price: "45000", growth: "3", days: "0" }],
    directCosts: [{ name: "Payment processing", basis: "rate", rate: "4", stock: "0", inventoryDays: "0", payableDays: "0" }],
    staff: [{ name: "Operations", headcount: "5", amount: "800000", burden: "10", month: "1", growth: "8" }],
    expenses: [{ name: "Software", amount: "450000", month: "1", growth: "5" }, { name: "Marketing", amount: "800000", month: "1", growth: "5" }],
    accounts: [{ name: "Bank", amount: "20000000" }], receivables: [], payables: [], ownedAssets: [], investments: [], existingLoans: [], newLoans: [],
    contributions: [], valuation: "no",
  };

  globalThis.FinancialChannels = { questionsFor, consolidate, multiExample };
})();
