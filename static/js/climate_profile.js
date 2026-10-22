(function () {
  'use strict';
  const periods = ['1990-2019', '2020-2049', '2050-2079'];
  const colours = ['#a7c4e8', '#f2c14e', '#ff793f'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const longMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const number = n => Number.isFinite(n) ? (Math.abs(n) < .05 ? 0 : n).toFixed(1).replace('-', '−') : '—';
  // Axis ticks: whole numbers when the step allows, without a trailing ".0".
  const tick = (v, step) => step >= 1 ? String(Math.round(v)).replace('-', '−') : number(v);
  const cache = new Map();
  const pending = new Map();

  async function get(url, signal) {
    const response = await fetch(url, {signal});
    let body;
    try {
      body = await response.json();
    } catch (_) {
      const error = new Error('Could not load climate data. Try again.');
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(body.error || 'Could not load climate data.');
      error.status = response.status;
      throw error;
    }
    return body;
  }
  function load(scope, member, signal) {
    const key = scope + '|' + member;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (!signal && pending.has(key)) return pending.get(key);
    const promise = get('/api/climate/profile?' + new URLSearchParams({scope, member}), signal).then(data => {
      if (cache.size >= 32) cache.delete(cache.keys().next().value);
      cache.set(key, data);
      return data;
    });
    if (!signal) {
      pending.set(key, promise);
      const clear = () => { if (pending.get(key) === promise) pending.delete(key); };
      promise.then(clear, clear);
    }
    return promise;
  }
  function forget(scope, member) { cache.delete(scope + '|' + member); }
  function chart(metric, month, wide) {
    const values = periods.flatMap(p => metric.values[p]).filter(Number.isFinite);
    if (!values.length) return '<p>No monthly data</p>';
    const minimum = Math.min(...values), maximum = Math.max(...values);
    const padding = Math.max((maximum - minimum) * .12, metric.units === '°C' ? 1 : 5);
    const rawStep = (maximum - minimum + 2 * padding) / 4;
    const power = 10 ** Math.floor(Math.log10(rawStep));
    const step = [1, 2, 5, 10].find(n => n * power >= rawStep) * power;
    const lo = Math.floor((minimum - padding) / step) * step;
    const hi = Math.ceil((maximum + padding) / step) * step;
    const width = wide ? 740 : 520, right = width - 27;
    const x = i => 53 + i * (right - 53) / 11;
    const y = v => 218 - (v - lo) / (hi - lo) * 192;
    let svg = `<svg class="cp-chart" viewBox="0 0 ${width} 260" role="img" aria-label="${escape(metric.label)}: monthly averages for three periods">`;
    svg += `<rect class="cp-month-band" x="${x(month - 1) - 13}" y="22" width="26" height="196"/>`;
    for (let v = lo; v <= hi + step / 100; v += step) {
      svg += `<path class="cp-grid" d="M53 ${y(v)}H${right}"/><text x="45" y="${y(v) + 4}" text-anchor="end">${tick(v, step)}</text>`;
    }
    if (lo < 0 && hi > 0) svg += `<path class="cp-zero" d="M53 ${y(0)}H${right}"/>`;
    svg += `<text x="53" y="13">${escape(metric.units)}</text>`;
    months.forEach((m, i) => { svg += `<text x="${x(i)}" y="240" text-anchor="middle">${m}</text>`; });
    periods.forEach((p, j) => {
      let path = '', gap = true;
      metric.values[p].forEach((v, i) => {
        if (!Number.isFinite(v)) { gap = true; return; }
        path += `${gap ? 'M' : 'L'}${x(i)} ${y(v)} `; gap = false;
      });
      svg += `<path d="${path}" fill="none" stroke="${colours[j]}" stroke-width="2.8" ${j === 1 ? 'stroke-dasharray="7 4"' : ''}/>`;
      const v = metric.values[p][month - 1];
      if (Number.isFinite(v)) svg += `<circle cx="${x(month - 1)}" cy="${y(v)}" r="4" fill="${colours[j]}" stroke="#101827" stroke-width="1.5"/>`;
    });
    return svg + '</svg>';
  }
  // Monthly totals read best as bars from zero: three bars per month, one per period.
  function bars(metric, month, wide) {
    const values = periods.flatMap(p => metric.values[p]).filter(Number.isFinite);
    if (!values.length) return '<p>No monthly data</p>';
    const rawStep = Math.max(...values) * 1.1 / 4 || 1;
    const power = 10 ** Math.floor(Math.log10(rawStep));
    const step = [1, 2, 5, 10].find(n => n * power >= rawStep) * power, hi = step * 4;
    const width = wide ? 740 : 520, right = width - 27, band = (right - 53) / 12, bw = band * .26;
    const x = i => 53 + (i + .5) * band;
    const y = v => 218 - v / hi * 192;
    let svg = `<svg class="cp-chart" viewBox="0 0 ${width} 260" role="img" aria-label="${escape(metric.label)}: mean monthly totals for three periods">`;
    svg += `<rect class="cp-month-band" x="${x(month - 1) - band / 2}" y="22" width="${band}" height="196"/>`;
    for (let v = 0; v <= hi + step / 100; v += step) {
      svg += `<path class="cp-grid" d="M53 ${y(v)}H${right}"/><text x="45" y="${y(v) + 4}" text-anchor="end">${tick(v, step)}</text>`;
    }
    svg += `<text x="53" y="13">${escape(metric.units)}</text>`;
    months.forEach((m, i) => { svg += `<text x="${x(i)}" y="240" text-anchor="middle">${m}</text>`; });
    periods.forEach((p, j) => metric.values[p].forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      svg += `<rect x="${(x(i) + (j - 1.5) * bw).toFixed(1)}" y="${y(Math.max(v, 0)).toFixed(1)}" width="${(bw - 1).toFixed(1)}" ` +
        `height="${(v > 0 ? Math.max(1, 218 - y(v)) : 0).toFixed(1)}" fill="${colours[j]}" opacity="${i === month - 1 ? 1 : .8}"/>`;
    }));
    return svg + '</svg>';
  }
  function caption(metric, month, period) {
    const a = metric.values[periods[0]][month - 1], b = metric.values[period][month - 1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 'No comparison available for this month.';
    if (period === periods[0]) return `${longMonths[month - 1]} average for 1990–2019.`;
    const d = b - a;
    if (Math.abs(d) < .05) return `${longMonths[month - 1]}: less than 0.1 ${metric.units} change from 1990–2019 to ${period.replace('-', '–')}.`;
    const change = number(Math.abs(d)) + ' ' + metric.units + (d > 0 ? ' higher' : ' lower');
    return `${longMonths[month - 1]}: ${change} in ${period.replace('-', '–')} than in 1990–2019.`;
  }
  function spread(metric, month, period) {
    if (period === periods[0]) return '';
    const changes = Object.values(metric.member_changes[period] || {}).map(a => a[month - 1]).filter(Number.isFinite);
    if (!changes.length) return '<p class="cp-spread">No member comparison available.</p>';
    const rounded = changes.map(n => Number(n.toFixed(1)));
    const higher = rounded.filter(n => n > 0).length, lower = rounded.filter(n => n < 0).length;
    const counts = [];
    if (higher) counts.push(`${higher} of ${changes.length} members higher`);
    if (lower) counts.push(`${lower}${counts.length ? '' : ` of ${changes.length} members`} lower`);
    const unchanged = changes.length - higher - lower;
    if (unchanged) counts.push(`${unchanged}${counts.length ? '' : ` of ${changes.length} members`} no change at 0.1 ${escape(metric.units)}`);
    return `<p class="cp-spread">${counts.join(' · ')}` +
      `<br>Change across members: ${number(Math.min(...changes))} to ${number(Math.max(...changes))} ${escape(metric.units)}</p>`;
  }
  function render(el, data, options = {}) {
    const month = options.month || 7, period = options.period || periods[2];
    const metrics = ['Tmax_mean', 'Prec_sum', 'CWBPT'];
    el.innerHTML = `<div class="cp-cards">` + metrics.map(id => {
      const m = data.metrics[id];
      const n = m.n_cells?.[month - 1];
      return `<article class="cp-card" data-metric="${id}"><h3>${escape(m.label)}</h3>` +
        `<p class="cp-caption">${escape(caption(m, month, period))}</p>` +
        `<div class="cp-values">` + periods.map((p, j) => `<div><span class="cp-period" style="color:${colours[j]}">${p.replace('-', '–')}</span><strong>${number(m.values[p][month - 1])}<small> ${escape(m.units)}</small></strong></div>`).join('') + '</div>' +
        `<h4>${id === 'Prec_sum' ? 'Mean monthly totals' : 'Monthly averages'}</h4>${id === 'Prec_sum' ? bars(m, month, options.wall) : chart(m, month, options.wall)}${spread(m, month, period)}` +
        (data.kind !== 'cell' ? `<p class="cp-support">${n ? n.toLocaleString('en-GB') + ' valid climate cells' : 'No valid climate cells'}</p>` : '') +
        '</article>';
    }).join('') + '</div>';
    const et = data.metrics.ETPT_sum;
    el.insertAdjacentHTML('beforeend', `<p class="cp-footnote">${escape(data.source)}. 1990–2019 observed; later periods projected. ${data.member === 'mean' ? 'Ensemble mean' : 'Member ' + escape(data.member)}. ` +
      `Water balance = precipitation − PT evapotranspiration` +
      (Number.isFinite(et.values[period][month - 1]) ? ` (${number(et.values[period][month - 1])} mm in ${months[month - 1]} ${period.replace('-', '–')}).` : '.') +
      `</p>`);
  }
  window.ClimaScopeProfile = {load, get, render, forget, escape, periods, months};
})();
