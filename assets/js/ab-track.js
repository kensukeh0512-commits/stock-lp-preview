/* =========================================================
   A/B パターンの計測フック
   ---------------------------------------------------------
   このリポジトリには現在 GA4 / GTM / 広告タグが一切入っていません。
   そのため本ファイルは「タグを入れれば即つながる受け口」です。
   単体では外部送信を行いません（勝手に計測しません）。

   使い方
     <script>window.LP_VARIANT = 'B';</script>
     <script src="../assets/js/ab-track.js" defer></script>

   やること
     1. URLの ?variant= を読み、なければ LP_VARIANT を使う
     2. 判定したパターンを sessionStorage に保存（遷移先へ引き継ぐ）
     3. dataLayer に lp_view / lp_cta_click を push
     4. CTAの遷移先に variant を自動で付与
     5. window.LP_TRACK で手動計測もできるようにする

   GTM 側では dataLayer の lp_view / lp_cta_click をトリガーにし、
   variant を GA4 のカスタムディメンションへ渡してください。

   読み込んでいるページ
     /          LP_VARIANT = 'A'
     /b/        LP_VARIANT = 'B'
     /thanks.html  LP_VARIANT なし（?variant= と同じタブの記録から判定）

   判定した値は登録フォーム（entry-form.js）と
   電話申込フォーム（apply-form.js）が一緒に保存します。
   そのため、このファイルだけでは外部送信は起きませんが、
   自前のスプレッドシートには登録元として残ります。
   ========================================================= */
(function () {
  'use strict';

  var KEY = 'lp_variant';

  function param(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
      return null;
    }
  }

  function store(k, v) {
    try { window.sessionStorage.setItem(k, v); } catch (e) {}
  }

  function load(k) {
    try { return window.sessionStorage.getItem(k); } catch (e) { return null; }
  }

  /* ── 1. パターンの判定 ───────────────────────────── */
  var variant =
    param('variant') ||
    window.LP_VARIANT ||
    load(KEY) ||
    'unknown';
  variant = String(variant).toUpperCase().slice(0, 8);
  store(KEY, variant);

  /* 流入元（SMS文面の出し分けを見るため） */
  var src = param('utm_source') || param('src') || '';
  var cmp = param('utm_campaign') || '';
  if (src) store('lp_src', src);
  if (cmp) store('lp_cmp', cmp);

  var device = window.matchMedia && window.matchMedia('(max-width:767px)').matches
    ? 'mobile' : 'desktop';

  /* ── 2. dataLayer へ流す ────────────────────────── */
  window.dataLayer = window.dataLayer || [];

  function push(event, extra) {
    var d = {
      event: event,
      lp_variant: variant,
      lp_device: device,
      lp_page: window.location.pathname,
      lp_src: src || load('lp_src') || '',
      lp_campaign: cmp || load('lp_cmp') || ''
    };
    if (extra) {
      for (var k in extra) { if (extra.hasOwnProperty(k)) d[k] = extra[k]; }
    }
    window.dataLayer.push(d);
    return d;
  }

  push('lp_view');

  /* ── 3. CTAクリック ─────────────────────────────── */
  function ctaLabel(a) {
    return (a.getAttribute('data-cta-name') || a.textContent || '')
      .replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  /* 遷移先に variant を引き継ぐ（サンキューページ側で到達を見分けるため） */
  function withVariant(href) {
    if (!href) return href;
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) return href;
    if (/[?&]variant=/.test(href)) return href;
    return href + (href.indexOf('?') >= 0 ? '&' : '?') + 'variant=' + encodeURIComponent(variant);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var ctas = document.querySelectorAll('[data-cta]');
    for (var i = 0; i < ctas.length; i++) {
      (function (a, idx) {
        var raw = a.getAttribute('href');
        if (raw && raw.charAt(0) !== '#') a.setAttribute('href', withVariant(raw));
        a.addEventListener('click', function () {
          push('lp_cta_click', {
            lp_cta_position: a.getAttribute('data-cta-pos') || String(idx + 1),
            lp_cta_label: ctaLabel(a),
            lp_cta_href: a.getAttribute('href') || ''
          });
        });
      })(ctas[i], i);
    }
  });

  /* ── 4. 手動用 ─────────────────────────────────── */
  window.LP_TRACK = {
    variant: variant,
    device: device,
    /* 登録フォームが一緒に保存する。同じ判定を2か所に書かないため、
       sessionStorage から読み直すのではなくここから渡す。 */
    src: src || load('lp_src') || '',
    campaign: cmp || load('lp_cmp') || '',
    push: push
  };
})();
