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
});
