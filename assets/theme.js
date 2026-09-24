/* ============================================================
   RAVYNN — Standalone Website JavaScript
   ============================================================ */

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

/* ============================================================
   CART (localStorage)
   ============================================================ */
const Cart = {
  KEY: 'ravynn_cart',
  get() { try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch { return []; } },
  save(items) { try { localStorage.setItem(this.KEY, JSON.stringify(items)); } catch {} this.updateCount(); },
  add(product, size, qty = 1) {
    const items = this.get();
    const key = `${product.id}-${size}`;
    const ex = items.find(i => i.key === key);
    if (ex) { ex.qty += qty; }
    else { items.push({ key, id: product.id, handle: product.handle, title: product.title, size, price: product.price, image: product.images[0], qty }); }
    this.save(items);
  },
  remove(key) { this.save(this.get().filter(i => i.key !== key)); },
  update(key, qty) {
    if (qty <= 0) return this.remove(key);
    const items = this.get();
    const item = items.find(i => i.key === key);
    if (item) { item.qty = qty; this.save(items); }
  },
  total() { return this.get().reduce((s, i) => s + i.price * i.qty, 0); },
  count() { return this.get().reduce((s, i) => s + i.qty, 0); },
  updateCount() {
    const n = this.count();
    $$('.cart-count').forEach(el => { el.textContent = n; el.style.display = n > 0 ? '' : 'none'; });
  }
};

/* ============================================================
   PRODUCTS (from JSON)
   ============================================================ */
const Products = {
  all: [],
  async load() {
    if (this.all.length) return;
    try {
      const res = await fetch('assets/products.json');
      const data = await res.json();
      this.all = data.products;
    } catch (e) { console.error('Products load failed', e); }
  },
  byHandle(h) { return this.all.find(p => p.handle === h); },
  byType(t) { return (!t || t === 'all') ? this.all : this.all.filter(p => p.type.toLowerCase() === t.toLowerCase()); },
  byCollection(c) {
    if (!c || c === 'all') return this.all;
    return this.all.filter(p => p.collections?.includes(c));
  },
  search(q) {
    const ql = q.toLowerCase();
    return this.all.filter(p => p.title.toLowerCase().includes(ql) || p.type.toLowerCase().includes(ql) || p.tags?.some(t => t.includes(ql)));
  },
  fmt(price) { return '₹' + price.toLocaleString('en-IN'); },
  card(p) {
    const disc = p.compare_at_price > 0 ? Math.round((1 - p.price / p.compare_at_price) * 100) : 0;
    return `<a href="product.html?p=${p.handle}" class="product-card">
      <div class="product-card-image-wrap">
        <img src="${p.images[0]}" alt="${p.title}" loading="lazy">
        ${disc ? `<span class="product-badge">${disc}% OFF</span>` : ''}
        <button class="product-card-wish" onclick="event.preventDefault();this.classList.toggle('wished')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
      </div>
      <div class="product-card-info">
        <div class="product-card-name">${p.title}</div>
        <div class="product-card-price">
          ${p.compare_at_price > 0 ? `<span class="compare">${Products.fmt(p.compare_at_price)}</span>` : ''}
          ${Products.fmt(p.price)}
        </div>
      </div>
    </a>`;
  }
};

/* ============================================================
   HERO CAROUSEL
   ============================================================ */
class HeroCarousel {
  constructor(el) {
    this.el = el;
    this.slides = $$('.hero-slide', el);
    this.dots = $$('.hero-dot', el);
    this.cur = 0; this.timer = null;
    if (this.slides.length > 1) this.init();
  }
  init() {
    this.dots.forEach((d, i) => d.addEventListener('click', () => this.go(i)));
    let sx = 0;
    this.el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    this.el.addEventListener('touchend', e => { const d = sx - e.changedTouches[0].clientX; if (Math.abs(d) > 50) d > 0 ? this.go(this.cur+1) : this.go(this.cur-1); }, { passive: true });
    this.auto();
    this.el.addEventListener('mouseenter', () => clearInterval(this.timer));
    this.el.addEventListener('mouseleave', () => this.auto());
  }
  go(i) {
    this.slides[this.cur]?.classList.remove('active');
    this.dots[this.cur]?.classList.remove('active');
    this.cur = (i + this.slides.length) % this.slides.length;
    this.slides[this.cur]?.classList.add('active');
    this.dots[this.cur]?.classList.add('active');
  }
  auto() { this.timer = setInterval(() => this.go(this.cur + 1), 4000); }
}

/* ============================================================
   SEARCH OVERLAY
   ============================================================ */
class SearchOverlay {
  constructor() {
    this.overlay = $('#search-overlay');
    this.input = this.overlay?.querySelector('.search-input');
    this.grid = this.overlay?.querySelector('.search-products');
    this.init();
  }
  init() {
    $$('[data-open-search]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); this.open(); }));
    this.overlay?.querySelector('.search-close')?.addEventListener('click', () => this.close());
    document.addEventListener('keydown', e => e.key === 'Escape' && this.close());
    this.input?.addEventListener('input', () => this.search(this.input.value));
    Products.load().then(() => this.renderProducts(Products.all.slice(0, 8)));
  }
  open() { this.overlay?.classList.add('open'); this.input?.focus(); }
  close() { this.overlay?.classList.remove('open'); if (this.input) this.input.value = ''; }
  async search(q) {
    const results = q.trim() ? Products.search(q) : Products.all.slice(0, 8);
    this.renderProducts(results.slice(0, 8));
  }
  renderProducts(list) { if (this.grid) this.grid.innerHTML = list.map(p => Products.card(p)).join(''); }
}

/* ============================================================
   MOBILE MENU
   ============================================================ */
class MobileMenu {
  constructor() {
    this.menu = $('#mobile-menu');
    this.overlay = $('#site-overlay');
    $$('[data-open-menu]').forEach(b => b.addEventListener('click', () => this.open()));
    this.menu?.querySelector('[data-close-menu]')?.addEventListener('click', () => this.close());
    this.overlay?.addEventListener('click', () => this.close());
  }
  open() { this.menu?.classList.add('open'); this.overlay?.classList.add('active'); }
  close() { this.menu?.classList.remove('open'); this.overlay?.classList.remove('active'); }
}

/* ============================================================
   NEW & POPULAR (homepage)
   ============================================================ */
class NewPopular {
  constructor(el) {
    this.el = el;
    this.grid = el.querySelector('.product-grid');
    this.tabs = $$('.new-popular-tab', el);
    Products.load().then(() => {
      this.show('all');
      this.tabs.forEach(tab => tab.addEventListener('click', () => {
        this.tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.show(tab.dataset.type || 'all');
      }));
    });
  }
  show(type) { if (this.grid) this.grid.innerHTML = Products.byType(type).slice(0, 10).map(p => Products.card(p)).join(''); }
}

/* ============================================================
   COLLECTION PAGE
   ============================================================ */
class CollectionPage {
  constructor() {
    this.grid = $('.product-grid');
    this.sortSel = $('#sort-select');
    this.activeFilters = {};
    this.products = [];
    Products.load().then(() => {
      const params = new URLSearchParams(location.search);
      const col = params.get('c') || 'all';
      this.products = Products.byCollection(col);
      // Update page title
      const titleEl = $('.collection-page-title, .page-title');
      if (titleEl && col !== 'all') {
        const colData = col.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        titleEl.textContent = colData;
        document.title = `${colData} — RAVYNN`;
      }
      this.render();
      $$('.filter-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const g = btn.dataset.filterGroup, v = btn.dataset.filterValue;
          btn.classList.toggle('active');
          if (!this.activeFilters[g]) this.activeFilters[g] = [];
          if (btn.classList.contains('active')) { this.activeFilters[g].push(v); }
          else { this.activeFilters[g] = this.activeFilters[g].filter(x => x !== v); }
          this.render();
        });
      });
      this.sortSel?.addEventListener('change', () => this.render());
    });
  }
  filter(list) {
    let r = [...list];
    for (const [g, vals] of Object.entries(this.activeFilters)) {
      if (!vals.length) continue;
      if (g === 'type') r = r.filter(p => vals.includes(p.type));
      if (g === 'price') r = r.filter(p => vals.some(v => {
        const [mn, mx] = v.split('-').map(Number);
        return p.price >= mn && (!mx || p.price <= mx);
      }));
    }
    return r;
  }
  sort(list) {
    const v = this.sortSel?.value || 'featured';
    const a = [...list];
    if (v === 'price-asc') a.sort((x,y) => x.price - y.price);
    else if (v === 'price-desc') a.sort((x,y) => y.price - x.price);
    else if (v === 'newest') a.sort((x,y) => y.id - x.id);
    return a;
  }
  render() {
    if (!this.grid) return;
    const list = this.sort(this.filter(this.products));
    this.grid.innerHTML = list.length ? list.map(p => Products.card(p)).join('') : '<p style="padding:60px 20px;color:#888;text-align:center">No products found.</p>';
  }
}

/* ============================================================
   PRODUCT PAGE
   ============================================================ */
class ProductPage {
  constructor() {
    this.product = null; this.selectedSize = null;
    const params = new URLSearchParams(location.search);
    const handle = params.get('p');
    if (!handle) return;
    Products.load().then(() => {
      this.product = Products.byHandle(handle);
      if (!this.product) return;
      this.render();
      this.initGallery();
      this.initSizes();
      this.initAccordions();
      this.initAddToBag();
      this.initCouponCopy();
      this.loadRelated();
    });
  }

  render() {
    const p = this.product;
    document.title = `${p.title} — RAVYNN`;
    const disc = p.compare_at_price > 0 ? Math.round((1 - p.price / p.compare_at_price) * 100) : 0;

    const nameEl = $('.product-name'); if (nameEl) nameEl.textContent = p.title;
    const priceEl = $('.product-price');
    if (priceEl) priceEl.innerHTML = `${p.compare_at_price > 0 ? `<span class="compare">${Products.fmt(p.compare_at_price)}</span>` : ''}<span>${Products.fmt(p.price)}</span>${disc ? `<span class="saved">${disc}% OFF</span>` : ''}`;

    // Desktop: main image + thumbs
    const mainImg = $('#product-main-img');
    if (mainImg) mainImg.src = p.images[0];
    const thumbsEl = $('.product-thumbs');
    if (thumbsEl) thumbsEl.innerHTML = p.images.map((img,i) => `<div class="product-thumb${i===0?' active':''}" data-full-src="${img}" tabindex="0"><img src="${img}" alt="${p.title}" loading="${i===0?'eager':'lazy'}" width="120"></div>`).join('');

    // Mobile gallery
    const mSlides = $('.mobile-slides');
    if (mSlides) mSlides.innerHTML = p.images.map((img,i) => `<div class="mobile-slide${i===0?' active':''}" data-index="${i}"><img src="${img}" alt="${p.title}" loading="${i===0?'eager':'lazy'}"></div>`).join('');
    const mDots = $('.mobile-slide-dots');
    if (mDots && p.images.length > 1) mDots.innerHTML = p.images.map((_,i) => `<span class="mobile-dot${i===0?' active':''}"></span>`).join('');

    // Description
    const detailBody = document.querySelector('.product-accordion:first-child .product-accordion-body');
    if (detailBody && p.description) detailBody.innerHTML = p.description;
  }

  initGallery() {
    // Desktop
    const thumbs = $$('.product-thumb'), mainImg = $('#product-main-img');
    thumbs.forEach(t => t.addEventListener('click', () => {
      thumbs.forEach(x => x.classList.remove('active')); t.classList.add('active');
      if (mainImg) { mainImg.removeAttribute('srcset'); mainImg.removeAttribute('sizes'); mainImg.src = t.dataset.fullSrc || t.querySelector('img')?.src; }
    }));
    // Mobile carousel
    const slides = $$('.mobile-slide'), dots = $$('.mobile-dot'), gallery = $('.mobile-gallery');
    if (!slides.length) return;
    let cur = 0;
    const go = i => { slides[cur]?.classList.remove('active'); dots[cur]?.classList.remove('active'); cur = (i+slides.length)%slides.length; slides[cur]?.classList.add('active'); dots[cur]?.classList.add('active'); };
    $('.mobile-slide-prev')?.addEventListener('click', () => go(cur-1));
    $('.mobile-slide-next')?.addEventListener('click', () => go(cur+1));
    let sx = 0;
    gallery?.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, {passive:true});
    gallery?.addEventListener('touchend', e => { const d = sx-e.changedTouches[0].clientX; if(Math.abs(d)>40) d>0?go(cur+1):go(cur-1); }, {passive:true});
  }

  initSizes() {
    const p = this.product, grid = $('.size-grid');
    if (!grid || !p.sizes?.length) return;
    grid.innerHTML = p.sizes.map(s => `<label class="size-btn"><input type="radio" name="size" value="${s}" class="visually-hidden">${s}</label>`).join('');
    $$('.size-btn').forEach(btn => btn.addEventListener('click', () => {
      $$('.size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.selectedSize = btn.querySelector('input')?.value;
    }));
  }

  initAccordions() {
    $$('.product-accordion-header').forEach(h => h.addEventListener('click', () => h.closest('.product-accordion')?.classList.toggle('open')));
    document.querySelector('.product-accordion')?.classList.add('open');
  }

  initAddToBag() {
    const btn = $('.add-to-bag-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!this.selectedSize) { $('.size-grid')?.classList.add('shake'); setTimeout(() => $('.size-grid')?.classList.remove('shake'), 500); return; }
      Cart.add(this.product, this.selectedSize);
      btn.textContent = '✓ ADDED TO BAG'; btn.classList.add('added');
      setTimeout(() => { btn.textContent = 'ADD TO BAG'; btn.classList.remove('added'); }, 2000);
    });
  }

  initCouponCopy() {
    $$('.coupon-copy').forEach(btn => btn.addEventListener('click', () => {
      const code = btn.closest('.coupon-card')?.querySelector('.coupon-code')?.textContent?.trim().split('\n').slice(-1)[0]?.trim();
      if (code) { navigator.clipboard.writeText(code).catch(()=>{}); const orig = btn.innerHTML; btn.textContent = '✓'; setTimeout(() => btn.innerHTML = orig, 1500); }
    }));
  }

  loadRelated() {
    const grid = $('.upsell-section .product-grid');
    if (!grid) return;
    const same = Products.all.filter(p => p.id !== this.product.id && p.type === this.product.type).slice(0, 5);
    const list = same.length >= 3 ? same : Products.all.filter(p => p.id !== this.product.id).slice(0, 5);
    grid.innerHTML = list.map(p => Products.card(p)).join('');
  }
}

/* ============================================================
   CART PAGE
   ============================================================ */
class CartPage {
  constructor() { this.render(); }
  render() {
    const itemsEl = $('.cart-items-list'), summaryEl = $('.cart-summary-box');
    if (!itemsEl) return;
    const items = Cart.get();
    if (!items.length) {
      itemsEl.innerHTML = `<div class="cart-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:52px;height:52px;margin-bottom:16px;color:#aaa"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg><h2>Your bag is empty</h2><p style="color:#888;margin:12px 0 24px">You haven't added anything yet.</p><a href="collection.html" class="add-to-bag-btn" style="display:inline-block;padding:14px 32px;text-decoration:none">SHOP NOW</a></div>`;
      if (summaryEl) summaryEl.style.display = 'none';
      return;
    }
    itemsEl.innerHTML = items.map(item => `<div class="cart-item" data-key="${item.key}">
      <div class="cart-item-image"><img src="${item.image}" alt="${item.title}" loading="lazy"></div>
      <div class="cart-item-details">
        <div class="cart-item-title">${item.title}</div>
        <div class="cart-item-variant">Size: ${item.size}</div>
        <div class="cart-item-price">${Products.fmt(item.price)}</div>
        <div class="cart-item-qty">
          <button class="qty-btn" data-action="dec" data-key="${item.key}">−</button>
          <span>${item.qty}</span>
          <button class="qty-btn" data-action="inc" data-key="${item.key}">+</button>
          <button class="cart-remove" data-key="${item.key}">Remove</button>
        </div>
      </div>
    </div>`).join('');
    if (summaryEl) {
      const sub = Cart.total(), ship = sub >= 999 ? 0 : 99;
      summaryEl.style.display = '';
      summaryEl.querySelector('.summary-subtotal').textContent = Products.fmt(sub);
      summaryEl.querySelector('.summary-shipping').textContent = ship === 0 ? 'FREE' : Products.fmt(ship);
      summaryEl.querySelector('.summary-total').textContent = Products.fmt(sub + ship);
    }
    $$('.qty-btn').forEach(btn => btn.addEventListener('click', () => {
      const key = btn.dataset.key, item = Cart.get().find(i => i.key === key);
      if (item) { Cart.update(key, btn.dataset.action === 'inc' ? item.qty+1 : item.qty-1); this.render(); }
    }));
    $$('.cart-remove').forEach(btn => btn.addEventListener('click', () => { Cart.remove(btn.dataset.key); this.render(); }));
  }
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  Cart.updateCount();
  new SearchOverlay();
  new MobileMenu();
  $$('.hero-carousel').forEach(el => new HeroCarousel(el));

  // Coupon copy (product page static coupons)
  $$('.coupon-copy').forEach(btn => btn.addEventListener('click', () => {
    const code = btn.closest('.coupon-card')?.querySelector('.coupon-code')?.textContent?.trim().split('\n').slice(-1)[0]?.trim();
    if (code) { navigator.clipboard.writeText(code).catch(()=>{}); const orig = btn.innerHTML; btn.textContent='✓'; setTimeout(()=>btn.innerHTML=orig,1500); }
  }));

  const tpl = document.body.dataset.template;
  if (tpl === 'index') {
    const npEl = $('.new-popular-section');
    if (npEl) new NewPopular(npEl);
  } else if (tpl === 'collection') {
    new CollectionPage();
  } else if (tpl === 'product') {
    new ProductPage();
  } else if (tpl === 'cart') {
    new CartPage();
  }

  // Announcement bar dismiss
  $('.announcement-close')?.addEventListener('click', () => $('.announcement-close')?.closest('.announcement-bar')?.remove());

  // Mobile bottom nav active state
  $$('.mobile-nav-item').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (location.pathname.endsWith(href) || (href === 'index.html' && location.pathname === '/')) a.classList.add('active');
  });

  // Header scroll shadow
  window.addEventListener('scroll', () => {
    document.querySelector('.site-header')?.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });
});
