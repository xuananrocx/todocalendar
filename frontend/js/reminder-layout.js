// Measure natural card heights, never the flex-filled list viewport.
const ReminderLayout = {
  height(document) {
    const cards = [...document.querySelectorAll('.reminder-item')].slice(0, 3);
    if (!cards.length) return null;
    const outerHeight = el => {
      if (!el || el.hidden) return 0;
      const style = getComputedStyle(el);
      return el.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    };
    const listStyle = getComputedStyle(document.getElementById('reminderList'));
    const listPadding = (parseFloat(listStyle.paddingTop) || 0) + (parseFloat(listStyle.paddingBottom) || 0);
    const height = outerHeight(document.querySelector('.reminder-header'))
      + outerHeight(document.querySelector('.reminder-footer'))
      + outerHeight(document.getElementById('reminderError'))
      + listPadding + cards.reduce((sum, card) => sum + outerHeight(card), 0);
    return Math.min(520, Math.max(160, Math.ceil(height)));
  },
};
