const ReminderStatus = (() => {
  function daysSince(date, now) {
    const [y, m, d] = date.split('-').map(Number);
    return Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, m - 1, d)) / 86400000);
  }
  function clock(item, now = new Date()) {
    const end = item.kind === 'end', kind = end ? '截止' : '开始';
    if (item.dateOnly) {
      // Compare calendar days, so DST and the configured reminder hour cannot change the result.
      const days = daysSince(item.date, now);
      return {
        text: days > 0 ? `${end ? '已逾期' : '已开始'} ${days} 天` : days === 0 ? `今日${kind}` : `${item.date} ${kind}`,
        overdue: end && days > 0
      };
    }
    const seconds = Math.ceil(item.target - now.getTime() / 1000), n = Math.abs(seconds);
    const days = Math.floor(n / 86400), h = Math.floor(n % 86400 / 3600), m = Math.floor(n % 3600 / 60), s = n % 60;
    const duration = `${days ? days + '天 ' : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return {text: seconds > 0 ? duration : (end ? '已逾期 ' : '已开始 ') + duration, overdue: end && seconds <= 0};
  }
  function meta(item) {
    const kind = item.kind === 'end' ? '截止' : '开始';
    return item.dateOnly ? `${item.date} ${kind} · 仅日期` : `${new Date(item.target * 1000).toLocaleString('zh-CN')} · ${kind}`;
  }
  function sort(items, now = new Date()) {
    return items.map(item => {
      let target = item.target;
      const overdue = clock(item, now).overdue;
      if (item.kind === 'end' && item.dateOnly) {
        const [y, m, d] = item.date.split('-').map(Number);
        target = new Date(y, m - 1, d + 1).getTime() / 1000;
      }
      // Match the displayed precision: one calendar day sorts above 17 hours.
      if (overdue) target = -(item.dateOnly ? daysSince(item.date, now) * 86400 : Math.floor(now.getTime() / 1000 - item.target));
      return {item, target, tier: overdue ? 0 : item.kind === 'end' ? 1 : 2};
    }).sort((a, b) => a.tier - b.tier || a.target - b.target || (a.item.key < b.item.key ? -1 : a.item.key > b.item.key ? 1 : 0)).map(entry => entry.item);
  }
  return Object.freeze({clock, meta, sort});
})();
