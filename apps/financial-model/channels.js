(() => {
  const { channels, channelStreams } = globalThis.FinancialLineItems;
  const defaults = new Map(globalThis.PeebeeDefaults.catalog.map(channel => [channel.key, channel]));
  const channelKey = row => `channel-${row.key}`;
  const channelRows = answers => (Array.isArray(answers.channels) ? answers.channels : [])
    .filter(row => typeof row?.key === "string" && /^[a-z0-9-]{1,64}$/.test(row.key));

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
          label: `Revenue streams for ${name}`,
          stepLabel: name,
          exportLabel: `Revenue · ${name}`,
        };
      }),
    ]);
  }

  function consolidate(answers) {
    const streams = [];
    const lines = [];
    const groups = [];
    for (const channel of channelRows(answers)) {
      const sources = [];
      for (const stream of answers[channelKey(channel)] || []) {
        const index = streams.length;
        streams.push({ ...stream, name: `${channel.name} · ${stream.name}` });
        sources.push({ name: stream.name, index });
        lines.push([`${channel.name} · ${stream.name}`, row => row.details.streams[index].revenue, "detail"]);
      }
      groups.push({ key: channel.key, name: channel.name, streams: sources });
      lines.push([`${channel.name} total`, row => sources.reduce((total, source) => total + row.details.streams[source.index].revenue, 0), "total"]);
    }
    lines.push(["Consolidated revenue", "revenue", "total"]);
    return {
      answers: { ...answers, streams },
      groups,
      report: { id: "channel-revenue", name: "Revenue by channel", lines },
    };
  }

  globalThis.FinancialChannels = { questionsFor, consolidate };
})();
