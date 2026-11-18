(() => {
  const { byId, channels, channelStreams, scopedCostGroups } = globalThis.FinancialLineItems;
  const defaults = new Map(globalThis.PeebeeDefaults.catalog.map(channel => [channel.key, channel]));
  const channelKey = row => `channel-${row.key}`;
  const channelRows = answers => (Array.isArray(answers.channels) ? answers.channels : [])
    .filter(row => typeof row?.key === "string" && /^[a-z0-9-]{1,64}$/.test(row.key));

  const included = row => row?.enabled !== "no";
  const moduleScope = row => (typeof row?.moduleScope === "string" ? row.moduleScope.split(",") : [])
    .filter(key => /^[a-z0-9-]{1,64}$/.test(key));
  const activeModuleKeys = answers => new Set(channelRows(answers).filter(included).map(channel => channel.key));
  function costIsActive(row, active) {
    const keys = moduleScope(row);
    return included(row) && row.roleType !== "disabled" && (!keys.length || keys.some(key => active.has(key)));
  }
  const ridesGroups = [
    ["boda", "Boda"], ["car", "Car"], ["rideshare", "Rideshare"],
    ["self-drive", "Self-drive"], ["rider-plans", "Rider plans"], ["other", "Other Rides revenue"],
  ];
  const ridesPresets = new Map([
    ["Boda fare commission", "boda"], ["Car platform share", "car"],
    ["Self-drive rental fees retained by Peebee", "self-drive"], ["Recurring rider access subscriptions", "rider-plans"],
    ["Recurring Rider Pro subscriptions", "rider-plans"], ["One-time rider access and Pro fees", "rider-plans"],
  ]);

  function scopeMetadata(id, row) {
    const flags = row.enabled === "no" ? { enabled: "no" } : {};
    const preset = id.startsWith("channel-") && defaults.get(id.slice(8))?.streams.find(stream => stream.name === row.name);
    if (row.adminSource || preset) flags.adminSource = row.adminSource || preset.name;
    for (const mode of ["adminFee", "adminVat"]) {
      if (row[mode] === "follow" || row[mode] === "override") flags[mode] = row[mode];
    }
    if (id !== "channel-rides") return flags;
    if (ridesGroups.some(([key]) => key === row.forecastGroup)) return { ...flags, forecastGroup: row.forecastGroup };
    const group = ridesPresets.get(row.name) || (/ride[ -]?share|car[ -]?pool/i.test(row.name || "") ? "rideshare" : "other");
    return { ...flags, forecastGroup: group };
  }

  function forecastModules(answers) {
    return channelRows(answers).map(channel => {
      const streams = answers[channelKey(channel)] || [];
      const parts = channel.key === "rides" ? ridesGroups.flatMap(([key, name]) => {
        const entries = streams.flatMap((row, index) => scopeMetadata("channel-rides", row).forecastGroup === key ? [{ row, index }] : []);
        return entries.length || key === "rideshare" ? [{ key, name, entries }] : [];
      }) : streams.map((row, index) => ({ key: String(index), name: row.name || `Revenue stream ${index + 1}`, entries: [{ row, index }] }));
      return { channel, parts };
    });
  }

  function questionsFor(questions, answers) {
    return questions.flatMap(prompt => prompt.id !== "streams" ? [prompt] : [
      { ...channels, presets: [...defaults.values()].map(channel => channel.name) },
      ...channelRows(answers).map((row, index) => {
        const name = row.name || `Channel ${index + 1}`;
        return {
          ...channelStreams,
          note: defaults.get(row.key)?.note,
          presets: defaults.get(row.key)?.streams.map(stream => stream.name) || channelStreams.presets,
          presetRows: defaults.get(row.key)?.streams,
          id: channelKey(row),
          channelId: row.key,
          label: `Revenue streams for ${name}`,
          title: name,
          subtitle: "Revenue streams",
          exportLabel: `Revenue · ${name}`,
        };
      }),
    ]);
  }

  function consolidate(answers) {
    const streams = [];
    const lines = [];
    const groups = [];
    for (const channel of channelRows(answers).filter(included)) {
      const sources = [];
      for (const stream of (answers[channelKey(channel)] || []).filter(included)) {
        const index = streams.length;
        streams.push({ ...stream, name: `${channel.name} · ${stream.name}` });
        sources.push({ name: stream.name, index });
        lines.push([`${channel.name} · ${stream.name}`, row => row.details.streams[index].revenue, "detail"]);
      }
      groups.push({ key: channel.key, name: channel.name, streams: sources });
      lines.push([`${channel.name} total`, row => sources.reduce((total, source) => total + row.details.streams[source.index].revenue, 0), "total"]);
    }
    lines.push(["Consolidated revenue", "revenue", "footer"]);
    const active = new Set(groups.map(group => group.key));
    const streamIndexes = new Map(groups.map(group => [group.key, group.streams.map(stream => stream.index)]));
    const forecastItems = Object.fromEntries(Object.keys(byId).filter(id => id !== "streams").map(id => [
      id, (answers[id] || []).filter(row => scopedCostGroups.has(id) ? costIsActive(row, active) : included(row)).map(row => {
        const keys = [...new Set(moduleScope(row))];
        if (id !== "directCosts" || !keys.length || (row.basis !== "rate" && row.inventoryDemand !== "sales")) return row;
        return { ...row, revenueStreamIndexes: keys.flatMap(key => streamIndexes.get(key) || []) };
      }),
    ]));
    return {
      answers: { ...answers, ...forecastItems, streams },
      groups,
      report: { id: "channel-revenue", name: "Revenue by channel", lines },
    };
  }

  globalThis.FinancialChannels = { questionsFor, consolidate, included, scopeMetadata, forecastModules,
    scopedCostGroups, moduleScope, activeModuleKeys, costIsActive };
})();
