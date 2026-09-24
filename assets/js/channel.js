/* =========================================================
   登録チャネルの切り替え（LINE / メール）
   ---------------------------------------------------------
   各ページの <head> で LP_CHANNEL を定義してください。

   <script>
     window.LP_CHANNEL = {
       mode: 'line',          // 'line' か 'mail'
       url : 'https://...'    // 登録先URL（LINE友だち追加 or フォーム）
     };
   </script>
   <script src="assets/js/channel.js" defer></script>

   これだけで、ボタン文言・本文中の「LINE／メール」・
   「友だち追加／アドレス登録」がまとめて入れ替わります。

   HTML側の書き方：
     <span class="ch" data-line="LINE" data-mail="メール">LINE</span>
     <a href="#" class="btn" data-cta>…</a>       ← href が url に差し替わる
     <span data-cta-label>LINEで銘柄を受け取る</span>  ← 文言が差し替わる
   ========================================================= */
(function () {
  'use strict';

  var cfg  = window.LP_CHANNEL || {};
  var mode = cfg.mode === 'mail' ? 'mail' : 'line';
  var url  = cfg.url || '';

  var LABEL = {
    line: 'LINEで銘柄を受け取る',
    mail: 'メールで銘柄を受け取る'
  };

  function apply() {
    document.documentElement.setAttribute('data-channel', mode);

    /* 本文中の言い回し */
    var words = document.querySelectorAll('.ch');
    for (var i = 0; i < words.length; i++) {
      var v = words[i].getAttribute('data-' + mode);
      if (v !== null) words[i].textContent = v;
    }

    /* ボタンの文言 */
    var labels = document.querySelectorAll('[data-cta-label]');
    for (var j = 0; j < labels.length; j++) labels[j].textContent = LABEL[mode];

    /* 登録先URL（ページ内アンカーはそのまま残す） */
    if (url) {
      var links = document.querySelectorAll('a[data-cta]');
      for (var k = 0; k < links.length; k++) links[k].setAttribute('href', url);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();
