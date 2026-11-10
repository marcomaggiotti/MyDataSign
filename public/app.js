'use strict';

document.addEventListener('DOMContentLoaded', () => {
  // Registration: show company fields only for company accounts.
  const companyBlock = document.querySelector('.company-only');
  if (companyBlock) {
    const sync = () => {
      const checked = document.querySelector('input[name="account_type"]:checked');
      companyBlock.hidden = !checked || checked.value !== 'company';
    };
    document.querySelectorAll('input[name="account_type"]').forEach((el) => el.addEventListener('change', sync));
    sync();
  }

  // Listing form: add another schema row.
  const addField = document.getElementById('add-field');
  const rows = document.getElementById('field-rows');
  if (addField && rows) {
    addField.addEventListener('click', () => {
      const last = rows.querySelector('tr:last-child');
      const clone = last.cloneNode(true);
      clone.querySelectorAll('input').forEach((input) => { input.value = ''; });
      clone.querySelectorAll('select').forEach((select) => { select.selectedIndex = 0; });
      rows.appendChild(clone);
      clone.querySelector('input').focus();
    });
  }

  if (document.body.dataset.demo || document.querySelector('.demo-banner')) setupDemo();
});

/**
 * Static demo (npm run build:demo): there is no server, so filters run in the
 * browser and forms either jump to a pre-rendered page or show a notice.
 */
function setupDemo() {
  const notice = (message) => {
    let el = document.querySelector('.demo-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'demo-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el.timer);
    el.timer = setTimeout(() => el.classList.remove('show'), 3200);
  };

  document.querySelectorAll('form').forEach((form) => {
    if (form.method.toLowerCase() !== 'post') return;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const target = form.getAttribute('action') || '';
      if (/^order-\d+\.html$/.test(target)) {
        window.location.href = target;
      } else if (/^(login|register)/.test(window.location.pathname.split('/').pop())) {
        window.location.href = 'dashboard.html';
      } else if (target === 'index.html') {
        window.location.href = 'index.html';
      } else {
        notice('Demo mode: nothing is saved. Deploy MyDataSign on Render to use it for real.');
      }
    });
  });

  const grid = document.querySelector('.grid');
  const filterForm = document.querySelector('form.filters');
  if (!grid || !filterForm) return;

  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of params) {
    const field = filterForm.elements.namedItem(key);
    if (field) field.value = value;
  }
  const topic = params.get('topic') || '';
  document.querySelectorAll('.topic-strip .chip').forEach((chip) => {
    const chipTopic = new URLSearchParams(chip.getAttribute('href').split('?')[1] || '').get('topic') || '';
    chip.classList.toggle('active', chipTopic === topic);
  });

  const q = (params.get('q') || '').toLowerCase();
  const maxPrice = Number.parseFloat(String(params.get('max_price') || '').replace(',', '.'));
  const cards = Array.from(grid.querySelectorAll('.card'));
  let visible = 0;
  cards.forEach((card) => {
    const d = card.dataset;
    const show = (!topic || d.topic === topic)
      && (!params.get('area') || d.area === params.get('area'))
      && (!params.get('seller') || d.seller === params.get('seller'))
      && (!q || d.text.includes(q))
      && (Number.isNaN(maxPrice) || Number(d.price) <= maxPrice * 100);
    card.hidden = !show;
    if (show) visible += 1;
  });

  const sort = params.get('sort') || 'newest';
  const key = (c) => (sort === 'newest' ? -Number(c.dataset.created) : Number(c.dataset.price));
  cards.sort((a, b) => (sort === 'price_desc' ? key(b) - key(a) : key(a) - key(b))).forEach((c) => grid.appendChild(c));

  if (visible === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty panel';
    empty.innerHTML = '<h2>No data packages match</h2><p class="muted">Try another topic or area.</p>';
    grid.after(empty);
  }
}
