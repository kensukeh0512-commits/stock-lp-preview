/* =========================================================
   メール登録フォーム（名前・メールアドレス）
   ---------------------------------------------------------
   各ページの <head> で LP_FORM を定義してください。

   <script>
     window.LP_FORM = {
       action : '',                             // 配信スタンドの受信URL
       method : 'post',
       fields : { name: 'name', email: 'email' },
       thanks : 'thanks.html'
     };
   </script>
   <script src="assets/js/entry-form.js" defer></script>

   fields は配信スタンド側の項目名です。サービスごとに違うため
   （name1 / entry.xxxx など）、設定で差し替えられるようにしています。

   action が空のあいだは送信せず、サンキューページへ遷移するだけです。
   クライアント確認用の挙動なので、配信スタンドが決まったら必ず設定して
   ください。設定するまで、入力内容はどこにも送られません。

   HTML側の書き方：
     <form data-entry novalidate>
       <input data-f="name"  ...  aria-describedby="e-name">
       <p class="err" id="e-name" hidden></p>
       <input data-f="email" ...  aria-describedby="e-mail">
       <p class="err" id="e-mail" hidden></p>
       <button type="submit">…</button>
     </form>
   ========================================================= */
(function () {
  'use strict';

  var cfg    = window.LP_FORM || {};
  var fields = cfg.fields || {};
  var thanks = cfg.thanks || 'thanks.html';

  /* 厳密に弾くと正当なアドレスまで落とすので、明らかな誤りだけを見る */
  var RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  var MSG = {
    name : 'お名前をご入力ください。',
    empty: 'メールアドレスをご入力ください。',
    bad  : 'メールアドレスの形式をご確認ください。'
  };

  function note(input, msg) {
    var id = input.getAttribute('aria-describedby');
    var box = id ? document.getElementById(id) : null;
    if (msg) {
      input.setAttribute('aria-invalid', 'true');
      if (box) { box.textContent = msg; box.hidden = false; }
    } else {
      input.removeAttribute('aria-invalid');
      if (box) { box.hidden = true; box.textContent = ''; }
    }
  }

  function check(nm, em) {
    var bad = null;
    if (!nm.value.replace(/[\s　]/g, '')) {
      note(nm, MSG.name); bad = bad || nm;
    } else { note(nm, ''); }

    var v = em.value.trim();
    if (!v) {
      note(em, MSG.empty); bad = bad || em;
    } else if (!RE.test(v)) {
      note(em, MSG.bad); bad = bad || em;
    } else { note(em, ''); }
    return bad;
  }

  function setup(f) {
    var nm = f.querySelector('[data-f="name"]');
    var em = f.querySelector('[data-f="email"]');
    if (!nm || !em) return;

    if (fields.name)  nm.setAttribute('name', fields.name);
    if (fields.email) em.setAttribute('name', fields.email);

    if (cfg.action) {
      f.setAttribute('action', cfg.action);
      f.setAttribute('method', cfg.method || 'post');
    }

    /* 一度エラーを出した項目は、直したらすぐ消す */
    [nm, em].forEach(function (i) {
      i.addEventListener('input', function () {
        if (i.getAttribute('aria-invalid')) note(i, '');
      });
    });

    f.addEventListener('submit', function (ev) {
      var bad = check(nm, em);
      if (bad) {
        ev.preventDefault();
        bad.focus();
        return;
      }
      if (window.LP_TRACK && window.LP_TRACK.push) {
        window.LP_TRACK.push('lp_form_submit', { lp_cta_name: 'entry-form' });
      }
      /* 送信先が未設定のあいだは、送らずにサンキューページへ */
      if (!cfg.action) {
        ev.preventDefault();
        var to = thanks;
        var v = window.LP_TRACK && window.LP_TRACK.variant;
        if (v && to.indexOf('variant=') < 0) {
          to += (to.indexOf('?') >= 0 ? '&' : '?') + 'variant=' + encodeURIComponent(v);
        }
        window.location.href = to;
      }
    });
  }

  function init() {
    var forms = document.querySelectorAll('form[data-entry]');
    for (var i = 0; i < forms.length; i++) setup(forms[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
