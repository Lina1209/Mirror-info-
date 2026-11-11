document.addEventListener('DOMContentLoaded', () => {
    const menuOpenBtn = document.getElementById('menuOpen');
    const menuCloseBtn = document.getElementById('menuClose');
    const mobileMenu = document.getElementById('mobileMenu');
    if (menuOpenBtn && mobileMenu) menuOpenBtn.addEventListener('click', () => mobileMenu.classList.add('is-open'));
    if (menuCloseBtn && mobileMenu) menuCloseBtn.addEventListener('click', () => mobileMenu.classList.remove('is-open'));
    document.querySelectorAll('[data-menu-link]').forEach(l => l.addEventListener('click', () => mobileMenu && mobileMenu.classList.remove('is-open')));
});