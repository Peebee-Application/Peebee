(() => {
  const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  const compactRate = new Intl.NumberFormat(undefined, { style: "percent", notation: "compact", maximumFractionDigits: 1 });

  function scale(values, unit) {
    const low = Math.min(0, ...values);
    const high = Math.max(0, ...values);
    const size = ((high - low) || (unit === "rate" ? 0.01 : 1)) / 4;
    const power = 10 ** Math.floor(Math.log10(size));
    const multiple = [1, 2, 2.5, 5, 10].find(value => value * power >= size);
    const step = (multiple || 1) * power || size || 1;
    const first = Math.floor(low / step);
    const last = Math.max(first + 1, Math.ceil(high / step));
    return {
      min: first * step, max: last * step,
      ticks: Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step),
    };
  }

  function axisLabel(value, unit) {
    const number = unit === "rate" ? value * 100 : value;
    if (Math.abs(number) >= 1e15 || (number !== 0 && Math.abs(number) < 0.05)) {
      return number.toExponential(1) + (unit === "rate" ? "%" : "");
    }
    return (unit === "rate" ? compactRate : compact).format(value);
  }

  function mountChart(canvas, chart, readout, format) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return () => {};
    const dashes = [[], [7, 3], [2, 4], [10, 4, 2, 4]];
    const data = chart.series.flatMap(series => series.values.filter(Number.isFinite));
    const axis = scale(data, chart.unit);
    const length = chart.periods.length;
    let selected = length - 1;
    let plot;

    function announce() {
      const title = document.createElement("strong");
      title.textContent = chart.periods[selected];
      const items = chart.series.map(series => {
        const item = document.createElement("span");
        item.textContent = `${series.label} ${format(series.values[selected], chart.unit)}`;
        return item;
      });
      readout.replaceChildren(title, ...items);
    }

    function draw() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      const colors = getComputedStyle(canvas);
      const ink = colors.getPropertyValue("--ink").trim();
      const palette = [colors.getPropertyValue("--gold").trim(), ink, colors.getPropertyValue("--quiet").trim(), ink];
      const ratio = Math.min(2, devicePixelRatio || 1);
      const pixels = [Math.round(width * ratio), Math.round(height * ratio)];
      if (canvas.width !== pixels[0]) canvas.width = pixels[0];
      if (canvas.height !== pixels[1]) canvas.height = pixels[1];
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.font = "11px system-ui";
      const labels = axis.ticks.map(value => axisLabel(value, chart.unit));
      const left = Math.max(...labels.map(text => ctx.measureText(text).width)) + 12;
      const right = width - 12;
      const top = 12;
      const bottom = height - 26;
      const stride = (right - left) / length;
      plot = { left, stride };
      const x = index => left + (index + 0.5) * stride;
      const y = value => bottom - (bottom - top) * ((value - axis.min) / (axis.max - axis.min));
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      ctx.fillStyle = palette[2];
      axis.ticks.forEach((value, index) => {
        const position = y(value);
        ctx.lineWidth = 1;
        ctx.strokeStyle = ink;
        ctx.globalAlpha = value === 0 ? 0.45 : 0.12;
        ctx.beginPath();
        ctx.moveTo(left, position);
        ctx.lineTo(right, position);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillText(labels[index], left - 7, position);
      });
      const labelCount = Math.min(length, Math.max(2, Math.floor((right - left) / 65)));
      ctx.textAlign = "center";
      for (let i = 0; i < labelCount; i++) {
        const index = labelCount === 1 ? 0 : Math.round(i * (length - 1) / (labelCount - 1));
        ctx.fillText(chart.periods[index].split(" ")[0], Math.max(left + 12, Math.min(right - 16, x(index))), bottom + 15);
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top - 4, right - left, bottom - top + 8);
      ctx.clip();
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.moveTo(x(selected), top);
      ctx.lineTo(x(selected), bottom);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (chart.type === "bars") {
        const bar = Math.min(stride * 0.76 / chart.series.length, 24);
        chart.series.forEach((series, i) => {
          ctx.fillStyle = palette[i];
          series.values.forEach((value, index) => {
            ctx.globalAlpha = index === selected ? 1 : 0.75;
            const base = y(0);
            const end = y(value);
            ctx.fillRect(x(index) + (i - chart.series.length / 2) * bar, Math.min(base, end), Math.max(0.35, bar * 0.82), Math.abs(base - end));
          });
        });
      } else {
        chart.series.forEach((series, i) => {
          ctx.strokeStyle = palette[i];
          ctx.fillStyle = palette[i];
          ctx.lineWidth = 2;
          ctx.setLineDash(dashes[i]);
          ctx.beginPath();
          let connected = false;
          series.values.forEach((value, index) => {
            if (value === null) { connected = false; return; }
            if (connected) ctx.lineTo(x(index), y(value));
            else ctx.moveTo(x(index), y(value));
            connected = true;
          });
          ctx.stroke();
          ctx.setLineDash([]);
          series.values.forEach((value, index) => {
            if (value === null || (index !== selected && length > 14)) return;
            ctx.beginPath();
            ctx.arc(x(index), y(value), index === selected ? 4 : 2, 0, Math.PI * 2);
            ctx.fill();
          });
        });
      }
      ctx.restore();
    }

    function inspect(index) {
      const target = Math.max(0, Math.min(length - 1, index));
      if (target === selected) return;
      selected = target;
      announce();
      draw();
    }

    const locate = event => {
      if (plot) inspect(Math.floor((event.clientX - canvas.getBoundingClientRect().left - plot.left) / plot.stride));
    };
    canvas.addEventListener("pointermove", event => { if (event.pointerType === "mouse") locate(event); });
    canvas.addEventListener("pointerdown", locate);
    canvas.addEventListener("keydown", event => {
      const index = { ArrowLeft: selected - 1, ArrowRight: selected + 1, Home: 0, End: length - 1 }[event.key];
      if (index === undefined) return;
      event.preventDefault();
      inspect(index);
    });
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    document.addEventListener("appearancechange", draw);
    announce();
    draw();
    return () => {
      observer.disconnect();
      document.removeEventListener("appearancechange", draw);
    };
  }

  function mount(root, analysis, format) {
    const disposers = analysis.charts.map(chart => mountChart(root.querySelector(`[data-chart="${chart.id}"]`), chart,
      root.querySelector(`#chart-readout-${chart.id}`), format));
    return () => disposers.forEach(dispose => dispose());
  }

  globalThis.ForecastCharts = { mount };
})();
