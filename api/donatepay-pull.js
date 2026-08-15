/* ==========================================================================
   api/donatepay-pull.js — получение донатов напрямую из API DonatePay.

   Зачем: DonatePay может быть без настроенного IPN-вебхука (или он не
   достучался). Эта функция сама ходит в GET /api/v1/transactions,
   ищет в сообщениях (comment) наши коды NC-XXXXXX и начисляет баланс
   через RPC credit_donation (идемпотентно по operation_id).

   Используется в двух режимах:
   - по расписанию: crons в vercel.json -> /api/donatepay-pull (раз в 2 мин);
   - вручную: topup.html кнопка «Проверить оплату» дёргает этот же
     endpoint перед чтением таблицы donations (мгновенный чек без ожидания крона).

   Переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
   DONATEPAY_SECRET (= access_token из API DonatePay, он же секрет IPN).

   Документация API: https://donatepay.eu/page/api
     GET /api/v1/transactions?access_token=..&type=donation&status=success&limit=100
     Ответ: данные с полями id, what, sum, comment, created_at, status, type ...
   ========================================================================== */

const API_BASE = 'https://donatepay.eu/api/v1';
const CODE_RE = /(?:^|[^A-Z0-9])(NC-[A-Z0-9]{6})(?:[^A-Z0-9]|$)/i;

async function getTransactions(token) {
  const q = new URLSearchParams({
    access_token: token,
    limit: '100',
    order: 'DESC',
    type: 'donation',
    status: 'success',
  });
  const res = await fetch(API_BASE + '/transactions?' + q.toString());
  if (!res.ok) {
    throw new Error('DonatePay HTTP ' + res.status);
  }
  const json = await res.json();
  if (json && (json.status === 429 || json.message === 'Too many attempts')) {
    throw new Error('DonatePay 429: too many attempts');
  }
  const list = Array.isArray(json) ? json : (json && Array.isArray(json.data) ? json.data : []);
  return list;
}

async function callRpc(url, serviceKey, fn, body) {
  const res = await fetch(url + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': 'Bearer ' + serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = text; }
  return { ok: res.ok, status: res.status, data };
}

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = process.env.DONATEPAY_SECRET;

  if (!url || !serviceKey || !token) {
    res.status(500).json({ ok: false, error: 'not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DONATEPAY_SECRET)' });
    return;
  }

  let transactions;
  try {
    transactions = await getTransactions(token);
  } catch (e) {
    console.error('[donatepay-pull] fetch failed:', e.message);
    res.status(502).json({ ok: false, error: e.message });
    return;
  }

  let credited = 0;
  let ignored = 0;
  let errors = 0;

  for (const t of transactions) {
    const message = String(t.comment || (t.vars ? JSON.stringify(t.vars) : '') || '');
    const m = message.match(CODE_RE);
    const code = m ? m[1].toUpperCase() : null;

    if (!code) {
      ignored++; // донат без нашего кода — не привязываем
      continue;
    }

    const rpc = await callRpc(url, serviceKey, 'credit_donation', {
      p_code: code,
      p_amount: Number(t.sum) || 0,
      p_operation_id: String(t.id || ''),
      p_message: message,
    });

    if (rpc.ok) {
      credited++;
    } else {
      // «Платёж не найден» / «Уже начислено» — обычные случаи, не ошибка
      errors++;
      console.warn('[donatepay-pull] credit failed tx#' + t.id + ':', rpc.status, JSON.stringify(rpc.data));
    }
  }

  res.status(200).json({ ok: true, scanned: transactions.length, credited, ignored, errors });
}
