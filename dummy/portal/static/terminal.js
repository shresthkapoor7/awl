'use strict';
// Local presentation only. All business operations use ordinary HTML forms.
document.querySelectorAll('[data-collapse]').forEach(button => {
  button.addEventListener('click', () => {
    const nav = document.querySelector('.navigation');
    nav.classList.toggle('collapsed');
    button.textContent = nav.classList.contains('collapsed') ? '»' : '«';
    button.setAttribute('aria-expanded', String(!nav.classList.contains('collapsed')));
  });
});
