// VERC RAG chat widget. Injected on every page; talks to /api/chat.
(function () {
  var leaf = '<svg viewBox="0 0 24 24" fill="none" stroke="#08110b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c4-2 7-6 7-11 0-2-.5-4-1.5-6-2 1-3.5 2.5-4.5 4.5C12 7 11.5 5 11 3 8 4 6 7 6 11c0 5 3 9 6 11Z"/><path d="M12 22V11"/></svg>';

  var btn = document.createElement('button');
  btn.className = 'verc-chat-btn';
  btn.setAttribute('aria-label', 'Запитати про VERC');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#08110b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Запитати про VERC';

  var panel = document.createElement('div');
  panel.className = 'verc-chat';
  panel.innerHTML =
    '<div class="verc-chat-head">' +
      '<span class="mark">' + leaf + '</span>' +
      '<div><h4>Асистент VERC</h4><p>Питання про проєкт та CBD</p></div>' +
      '<button class="verc-chat-close" aria-label="Закрити">×</button>' +
    '</div>' +
    '<div class="verc-chat-body"></div>' +
    '<div class="verc-chat-foot">' +
      '<form class="verc-chat-form">' +
        '<textarea class="verc-chat-input" rows="1" placeholder="Напишіть питання…"></textarea>' +
        '<button type="submit" class="verc-chat-send" aria-label="Надіслати"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg></button>' +
      '</form>' +
      '<div class="verc-disclaimer">Інформаційно, не є медичною порадою.</div>' +
    '</div>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var body = panel.querySelector('.verc-chat-body');
  var form = panel.querySelector('.verc-chat-form');
  var input = panel.querySelector('.verc-chat-input');
  var sendBtn = panel.querySelector('.verc-chat-send');
  var history = [];
  var greeted = false;

  function open() {
    panel.classList.add('open');
    btn.classList.add('hidden');
    if (!greeted) {
      addBot('Вітаю! Я асистент проєкту VERC. Запитайте мене про модель «Producer Therapy», законодавство щодо CBD, цикл будівництва чи будь-що з бази знань.');
      greeted = true;
    }
    input.focus();
  }
  function close() {
    panel.classList.remove('open');
    btn.classList.remove('hidden');
  }
  btn.addEventListener('click', open);
  panel.querySelector('.verc-chat-close').addEventListener('click', close);

  function scroll() { body.scrollTop = body.scrollHeight; }

  function addUser(text) {
    var el = document.createElement('div');
    el.className = 'verc-msg user';
    el.textContent = text;
    body.appendChild(el);
    scroll();
  }
  function addBot(text) {
    var el = document.createElement('div');
    el.className = 'verc-msg bot';
    el.textContent = text;
    body.appendChild(el);
    scroll();
    return el;
  }
  function addSources(sources) {
    if (!sources || !sources.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'verc-sources';
    sources.forEach(function (s) {
      var a = document.createElement('a');
      a.href = s.url;
      a.textContent = s.title.length > 40 ? s.title.slice(0, 38) + '…' : s.title;
      wrap.appendChild(a);
    });
    body.appendChild(wrap);
    scroll();
  }

  function showTyping() {
    var el = document.createElement('div');
    el.className = 'verc-typing';
    el.innerHTML = '<span>●</span><span>●</span><span>●</span>';
    body.appendChild(el);
    scroll();
    return el;
  }

  function autogrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  }
  input.addEventListener('input', autogrow);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    addUser(q);
    input.value = '';
    autogrow();
    sendBtn.disabled = true;
    var typing = showTyping();

    try {
      var res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, history: history }),
      });
      var data = await res.json();
      typing.remove();
      if (data.error) {
        addBot('Вибачте, сталася помилка. Спробуйте ще раз пізніше.');
      } else {
        addBot(data.answer);
        addSources(data.sources);
        history.push({ role: 'user', content: q });
        history.push({ role: 'assistant', content: data.answer });
        if (history.length > 8) history = history.slice(-8);
      }
    } catch (err) {
      typing.remove();
      addBot('Не вдалося звʼязатися з сервером. Перевірте зʼєднання.');
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  });
})();
