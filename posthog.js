/*
 * NOVAPA analytics — PostHog loader + registration funnel events.
 * Shared by every page via <script src="/posthog.js" defer></script>.
 *
 * Consent: integrates with the CookieYes banner already on the site.
 * Before analytics consent, PostHog runs with in-memory persistence
 * (no cookies / localStorage); once the visitor accepts the
 * "analytics" category, persistence is upgraded.
 */
(function () {
  var POSTHOG_KEY = 'phc_pKwTDgnhHKjG34dvXmjtw2NJzCsGkK3L6MfMp9TUvYkw';
  var POSTHOG_HOST = 'https://us.i.posthog.com';

  // --- Internal-traffic exclusion ---
  // Visit any page once with ?internal=1 to permanently mark this
  // browser as internal (Jason/CJ/testing) — analytics never loads again
  // on it. ?internal=0 clears the flag. Localhost never tracks.
  try {
    var q = location.search;
    if (q.indexOf('internal=1') !== -1) localStorage.setItem('novapa_internal', '1');
    if (q.indexOf('internal=0') !== -1) localStorage.removeItem('novapa_internal');
    if (localStorage.getItem('novapa_internal') === '1') return;
  } catch (e) { /* localStorage blocked — fall through, still track */ }
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname)) return;

  function cookieYesAnalyticsConsent() {
    var m = document.cookie.match(/(?:^|;\s*)cookieyes-consent=([^;]*)/);
    if (!m) return false;
    return decodeURIComponent(m[1]).indexOf('analytics:yes') !== -1;
  }

  function persistenceMode() {
    return cookieYesAnalyticsConsent() ? 'localStorage+cookie' : 'memory';
  }

  var script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = 'https://us-assets.i.posthog.com/static/array.js';
  script.onload = function () {
    window.posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      defaults: '2025-05-24',
      persistence: persistenceMode(),
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true
    });
    setupFunnelEvents();
  };
  document.head.appendChild(script);

  // Upgrade/downgrade persistence when the visitor changes CookieYes consent.
  document.addEventListener('cookieyes_consent_update', function () {
    if (window.posthog && window.posthog.set_config) {
      window.posthog.set_config({ persistence: persistenceMode() });
    }
  });

  function capture(event, props) {
    if (window.posthog && window.posthog.capture) window.posthog.capture(event, props);
  }

  function setupFunnelEvents() {
    var page = location.pathname;

    // --- Registration CTA clicks (any page) ---
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (href.indexOf('hisawyer.com') !== -1) {
        capture('sawyer_link_clicked', {
          cta_text: (a.textContent || '').trim().slice(0, 80),
          cta_href: href,
          page_path: page
        });
      } else if (href.indexOf('novapa_registration') !== -1 || href === '#register') {
        capture('registration_cta_clicked', {
          cta_text: (a.textContent || '').trim().slice(0, 80),
          cta_href: href,
          page_path: page
        });
      } else if (href.indexOf('booktix.com') !== -1) {
        capture('tickets_link_clicked', { page_path: page });
      } else if (href.indexOf('mailto:') === 0) {
        capture('email_link_clicked', { page_path: page });
      } else if (href.indexOf('tel:') === 0) {
        capture('phone_link_clicked', { page_path: page });
      }
    }, true);

    // --- Sawyer registration widget viewed (registration page only) ---
    var regSection = document.getElementById('register');
    if (regSection && 'IntersectionObserver' in window) {
      var seen = false;
      new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !seen) {
            seen = true;
            capture('registration_widget_viewed', { page_path: page });
            obs.disconnect();
          }
        });
      }, { threshold: 0.3 }).observe(regSection);
    }

    // --- Help-chatbot usage (pages posting to /api/chat) ---
    if (window.fetch) {
      var origFetch = window.fetch;
      window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var isChat = url.indexOf('/api/chat') !== -1;
        if (isChat) capture('assistant_message_sent', { page_path: page });
        var p = origFetch.apply(this, arguments);
        if (isChat) {
          p.then(function (res) {
            if (!res.ok) capture('assistant_message_failed', { page_path: page, status: res.status });
          }).catch(function () {
            capture('assistant_message_failed', { page_path: page, status: 'network_error' });
          });
        }
        return p;
      };
    }
  }
})();
