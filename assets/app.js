const BONUS_CAP = 120;

const emptyMark = '<span class="empty">—</span>';
const esc = s => String(s).replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const fmt = v => (v == null || v === '') ? emptyMark : esc(v);
const fmtWager = n => (n == null) ? emptyMark : esc(n) + 'x';
const initials = name => {
  const parts = String(name).trim().split(/\s+/);
  return (parts[0]?.[0] || '?').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
};

function renderBonus(text) {
  if (text == null || text === '') return emptyMark;
  const s = String(text);
  if (s.length <= BONUS_CAP) return esc(s);
  // Truncate at a word boundary near the cap so the ellipsis doesn't split a word.
  let cut = s.lastIndexOf(' ', BONUS_CAP);
  if (cut < BONUS_CAP * 0.6) cut = BONUS_CAP;
  const head = esc(s.slice(0, cut).trimEnd());
  return `${head}<button type="button" class="bonus-more" data-full="${esc(s)}" aria-label="Show full bonus">…</button>`;
}

const VIEW_STORAGE_KEY = 'casino-view';
const DEFAULT_VIEW = 'table';

const metaEl = document.getElementById('meta');
const resultsEl = document.getElementById('results');
const bannerEl = document.getElementById('banner');
const btnEl = document.getElementById('scrape-btn');
const btnLabel = btnEl.querySelector('.btn-label');
const urlInput = document.getElementById('url');
const filterInput = document.getElementById('filter');
const formEl = document.getElementById('scrape-form');
const modalEl = document.getElementById('bonus-modal');
const modalBodyEl = document.getElementById('modal-body');
const modalCloseEl = modalEl.querySelector('.modal-close');
const viewBtns = Array.from(document.querySelectorAll('.view-btn'));

let allCasinos = [];
let currentView = (() => {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    return v === 'table' || v === 'cards' ? v : DEFAULT_VIEW;
  } catch { return DEFAULT_VIEW; }
})();

function showBanner(kind, msg) {
  bannerEl.hidden = false;
  bannerEl.className = `banner ${kind}`;
  bannerEl.textContent = msg;
}
function clearBanner() { bannerEl.hidden = true; }

function friendlyError(raw) {
  const msg = String(raw || '').trim();
  if (!msg) return "Something went wrong. Please try again.";

  // HTTP status from the source site (scraper surfaces "Fetch failed: 403 Forbidden").
  const httpMatch = msg.match(/Fetch failed:\s*(\d{3})/i);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    if (status === 403 || status === 401) return "That site blocked our request. Try one of the recommended sources instead.";
    if (status === 404) return "That page doesn't exist. Check the URL and try again.";
    if (status === 429) return "That site is rate-limiting us. Wait a few minutes or try a different source.";
    if (status >= 500) return "The source site is having problems. Try again later.";
    return `Couldn't load that page (error ${status}). Try a different URL.`;
  }

  if (/robots\.txt disallows/i.test(msg)) return "That site's robots.txt doesn't allow scraping. Try a different source.";
  if (/anti-bot page detected/i.test(msg)) return "That site put up a bot-detection wall. Try one of the recommended sources.";
  if (/page body too short/i.test(msg)) return "That page returned almost no content — it's likely blocking us. Try a different source.";
  if (/LLM returned 0 casinos/i.test(msg)) return "No casino bonuses were found on that page. The layout may have changed, or try a different source.";
  if (/LLM did not return casinos array/i.test(msg) || /Unexpected token/i.test(msg) || /JSON/i.test(msg) && /parse/i.test(msg)) {
    return "The AI couldn't make sense of that page. Try again, or pick a different source.";
  }
  if (/OPENAI_API_KEY/i.test(msg)) return "The scraper isn't configured on the server (missing API key). Contact the admin.";
  if (/Invalid URL/i.test(msg)) return "That URL doesn't look valid. Make sure it starts with http:// or https://.";
  if (/Only http\(s\) URLs/i.test(msg)) return "Only http:// and https:// URLs are supported.";
  if (/Request body too large/i.test(msg)) return "That request was too large. Try a shorter URL.";
  if (/fetch failed/i.test(msg) || /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(msg)) {
    return "Couldn't reach that site. Check the URL and your internet connection.";
  }
  if (/No data yet/i.test(msg)) return msg; // Already friendly.

  return "Something went wrong while scraping. Try again or pick a different source.";
}

function openBonusModal(text) {
  modalBodyEl.textContent = text;
  if (typeof modalEl.showModal === 'function') {
    modalEl.showModal();
  } else {
    modalEl.setAttribute('open', '');
  }
}

function closeBonusModal() {
  if (typeof modalEl.close === 'function') {
    modalEl.close();
  } else {
    modalEl.removeAttribute('open');
  }
}

function renderCards(casinos) {
  if (casinos.length === 0) {
    resultsEl.innerHTML = '<div class="cards"><div class="no-results">No casinos match your filter.</div></div>';
    return;
  }
  const inner = casinos.map((c, i) => {
    const delay = Math.min(i * 60, 600);
    const nameTitle = c.name ? ` title="${esc(c.name)}"` : '';
    return `
      <article class="card" style="animation-delay:${delay}ms">
        <div class="card-head">
          <div class="chip" aria-hidden="true">${esc(initials(c.name))}</div>
          <h2 class="name"${nameTitle}>${fmt(c.name)}</h2>
        </div>
        <p class="bonus">${renderBonus(c.welcome_bonus)}</p>
        <div class="stats">
          <span class="stat">Wagering<strong>${fmtWager(c.wagering_requirement)}</strong></span>
          <span class="stat">Min deposit<strong>${fmt(c.min_deposit)}</strong></span>
        </div>
        <div class="card-foot">
          <a class="src" href="${esc(c.source_url)}" target="_blank" rel="noopener nofollow">Source</a>
        </div>
      </article>
    `;
  }).join('');
  resultsEl.innerHTML = `<div class="cards">${inner}</div>`;
}

function renderTable(casinos) {
  if (casinos.length === 0) {
    resultsEl.innerHTML = '<div class="cards"><div class="no-results">No casinos match your filter.</div></div>';
    return;
  }
  const rows = casinos.map(c => `
    <tr>
      <td class="td-name">${fmt(c.name)}</td>
      <td class="td-bonus">${renderBonus(c.welcome_bonus)}</td>
      <td class="td-wager"><strong>${fmtWager(c.wagering_requirement)}</strong></td>
      <td class="td-min"><strong>${fmt(c.min_deposit)}</strong></td>
      <td><a class="src" href="${esc(c.source_url)}" target="_blank" rel="noopener nofollow">Source</a></td>
    </tr>
  `).join('');
  resultsEl.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Casino</th>
            <th>Welcome bonus</th>
            <th>Wagering</th>
            <th>Min deposit</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderCurrent(casinos) {
  (currentView === 'table' ? renderTable : renderCards)(casinos);
}

function setView(view) {
  if (view !== 'cards' && view !== 'table') return;
  currentView = view;
  try { localStorage.setItem(VIEW_STORAGE_KEY, view); } catch {}
  viewBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  applyFilter();
}

function applyFilter() {
  const q = filterInput.value.trim().toLowerCase();
  const list = q
    ? allCasinos.filter(c =>
        [c.name, c.welcome_bonus, c.min_deposit].some(v =>
          v != null && String(v).toLowerCase().includes(q)
        )
      )
    : allCasinos;
  renderCurrent(list);
}

function setData(data) {
  allCasinos = data.casinos || [];
  const when = new Date(data.scraped_at).toLocaleString();
  metaEl.classList.remove('loading');
  metaEl.textContent = `${allCasinos.length} casinos · scraped ${when}`;
  applyFilter();
}

async function doScrape(url) {
  clearBanner();
  btnEl.disabled = true;
  btnEl.classList.add('loading');
  btnLabel.textContent = 'Scraping…';
  metaEl.classList.add('loading');
  metaEl.textContent = 'Scraping';
  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    setData(body);
    showBanner('ok', `Scraped ${body.casinos.length} casinos from ${body.source}`);
  } catch (err) {
    metaEl.classList.remove('loading');
    showBanner('err', friendlyError(err.message));
  } finally {
    btnEl.disabled = false;
    btnEl.classList.remove('loading');
    btnLabel.textContent = 'Scrape';
  }
}

formEl.addEventListener('submit', e => {
  e.preventDefault();
  doScrape(urlInput.value.trim());
});

const initialQuery = new URLSearchParams(location.search).get('q');
if (initialQuery) filterInput.value = initialQuery;

filterInput.addEventListener('input', () => {
  const url = new URL(location.href);
  const q = filterInput.value.trim();
  if (q) url.searchParams.set('q', q);
  else url.searchParams.delete('q');
  history.replaceState(null, '', url);
  applyFilter();
});

viewBtns.forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

resultsEl.addEventListener('click', e => {
  const btn = e.target.closest('.bonus-more');
  if (!btn) return;
  openBonusModal(btn.dataset.full || '');
});

modalCloseEl.addEventListener('click', closeBonusModal);

// Close on backdrop click (native <dialog> fires click on the dialog element itself).
modalEl.addEventListener('click', e => {
  if (e.target === modalEl) closeBonusModal();
});

// Reflect restored view in the toggle buttons on first paint.
viewBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === currentView)));

// Initial load: show whatever's in data.json.
fetch('data.json', { cache: 'no-cache' })
  .then(r => {
    if (!r.ok) throw new Error('No data yet — click Scrape to fetch results.');
    return r.json();
  })
  .then(setData)
  .catch(err => {
    metaEl.classList.remove('loading');
    metaEl.textContent = '';
    resultsEl.innerHTML = '';
    showBanner('err', friendlyError(err.message));
  });
