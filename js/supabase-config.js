/* ==========================================================================
   supabase-config.js — конфигурация Supabase (облачная БД)
   Сайт работает в двух режимах:
   - enabled: true  -> авторизация и данные идут через Supabase
   - enabled: false -> всё работает как раньше (localStorage), чтобы не ломать сайт

   КАК ПОДКЛЮЧИТЬ (один раз, ~5 минут):
   1. Открой https://supabase.com  и нажми  «Start your project»
      (или сразу https://supabase.com/dashboard)
   2. «New project» -> имя проекта (например novacraft),
      придумай пароль БД, регион — лучше Frankfurt.
   3. В левом меню открой «SQL Editor» -> «New query»,
      вставь туда всё содержимое файла supabase-schema.sql и нажми Run.
      Это создаст таблицы (профили, уведомления, комментарии, тикеты).
   4. В левом меню: «Project Settings» -> «API»
      (на старых дашбордах: Settings -> API).
      Скопируй оттуда:
        Project URL  -> в поле url ниже
        anon public key -> в поле anonKey ниже
   5. Поставь enabled: true.
   6. Залей сайт на Vercel — всё остальное уже работает.
   ========================================================================== */

window.SUPABASE_CONFIG = {
  enabled: true,
  url: 'https://apcnsagskuheduzjbgyv.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwY25zYWdza3VoZWR1empiZ3l2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NzkwMjQsImV4cCI6MjEwMTM1NTAyNH0.ZIP9e05ScUi53m0-NviTG_8R91SjdCraKIUGv4SbLog',
};
