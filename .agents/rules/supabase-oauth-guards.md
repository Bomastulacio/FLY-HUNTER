---
description: Reglas para proteger rutas en el lado del cliente (SPA/Astro) con Supabase Auth.
---
# Supabase OAuth Guards

Al implementar middleware o protección de rutas en el lado del cliente (ej. Astro `<script is:inline>` o Vanilla JS) para Supabase Auth:
1. NUNCA redirecciones inmediatamente evaluando `supabase.auth.getSession()` si la página acaba de cargar de un flujo OAuth.
2. SIEMPRE chequea primero si la URL contiene un token de acceso: `if (window.location.hash.includes('access_token'))`.
3. Si hay un hash, DEBES pausar la redirección y esperar al evento `SIGNED_IN` mediante `supabase.auth.onAuthStateChange()`.
4. Si no hay hash, puedes proceder normalmente con `getSession()`.
