/* ==========================================================================
   api/donatepay-ipn.js — вебхук (IPN) от DonatePay для пополнения баланса.

   Как работает:
   1. Игрок на topup.html нажимает «Пополнить» — сайт создаёт «ожидающий
      платёж» в таблице donations и генерирует код (NC-XXXXXX), который
      игрок пишет в сообщении доната.
   2. DonatePay после оплаты шлёт POST на этот адрес (в настройках аккаунта
      DonatePay → Уведомления (IPN) → URL = https://<твой-домен>/api/donatepay-ipn).
   3. Функция проверяет подпись, находит код в сообщении доната и вызывает
      RPC credit_donation — баланс игрока начисляется (только service_role).

   Переменные окружения (Vercel → Settings → Environment Variables):
     SUPABASE_URL                 — Project URL из дашборда Supabase
     SUPABASE_SERVICE_ROLE_KEY    — Project Settings → API → service_role key
     DONATEPAY_SECRET             — секретный ключ из настроек DonatePay (IPN)

   ВАЖНО: подпись DonatePay = HMAC-SHA256(секрет, "type:op_id:amount:currency:message").
   Если подпись не сходится — сверь точную схему из готового примера в настройках
   DonatePay (IPN) и поправь buildSignature() ниже.
   ========================================================================== */

export const config = { api: { bodyParser: false } };

const crypto = require('crypto');

function buildSignature(secret, fields) {
  // DonatePay: поля склеиваются двоеточием в этом порядке
  const data = [
    fields.notification_type,
    fields.operation_id,
    fields.amount,
    fields.currency,
    fields.message,
  ].join(':');
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

async function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
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
  // Отдаём 405 на всё, кроме POST
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  const raw = await readRaw(req);
  const fields = Object.fromEntries(new URLSearchParams(raw));

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.DONATEPAY_SECRET || '';

  // Только уведомления о донатах
  if (fields.notification_type !== 'pay') {
    res.status(200).json({ ok: true, ignored: fields.notification_type });
    return;
  }

  // Проверка подписи (если задан секрет). Без секрета — dev-режим.
  if (secret) {
    const expected = buildSignature(secret, fields);
    const given = String(fields.signature || '');
    if (expected.toLowerCase() !== given.toLowerCase()) {
      res.status(401).json({ ok: false, error: 'bad signature' });
      return;
    }
  } else {
    console.warn('[donatepay-ipn] DONATEPAY_SECRET не задан — подпись не проверяется!');
  }

  if (!url || !serviceKey) {
    console.error('[donatepay-ipn] Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    res.status(500).json({ ok: false, error: 'not configured' });
    return;
  }

  const message = String(fields.message || '');
  // Код в сообщении: NC-XXXXXX (латинские буквы+цифры)
  const m = message.match(/(?:^|[^A-Z0-9])(NC-[A-Z0-9]{6})(?:[^A-Z0-9]|$)/i);
  const code = m ? m[1].toUpperCase() : null;

  if (!code) {
    // Донос без нашего кода — не начисляем, но подтверждаем приём
    res.status(200).json({ ok: true, error: 'code not found in message' });
    return;
  }

  const rpc = await callRpc(url, serviceKey, 'credit_donation', {
    p_code: code,
    p_amount: Number(fields.amount) || 0,
    p_operation_id: String(fields.operation_id || ''),
    p_message: message,
  });

  if (!rpc.ok) {
    console.error('[donatepay-ipn] credit_donation failed:', rpc.status, JSON.stringify(rpc.data));
  }

  // DonatePay ждёт 200, чтобы не слать повторно
  res.status(200).json({ ok: true });
}
