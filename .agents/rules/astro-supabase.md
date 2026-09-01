# Astro & Supabase RLS Rules

## 1. Astro CSS Scoping for Dynamic Content
**Context:** When working with `.astro` files, Astro automatically scopes CSS to the component.
**Rule:** If you inject HTML dynamically via JavaScript (e.g., `element.innerHTML = '<div class="dynamic-class">...'`), the scoped CSS will **NOT** apply to the injected elements. 
**Action:** You MUST wrap the CSS classes intended for dynamically injected HTML with the `:global()` modifier in the `<style>` block.
*Example:* 
```css
/* Bad for dynamic HTML */
.country-pill { color: red; }

/* Good for dynamic HTML */
:global(.country-pill) { color: red; }
```

## 2. Supabase Row Level Security (RLS) for Upserts
**Context:** When using `.upsert()` from `@supabase/supabase-js`, the operation acts as both an `INSERT` and an `UPDATE`.
**Rule:** If RLS is enabled on a table, a `FOR ALL` policy with only a `USING` clause is not always sufficient or safely applied by default for inserts. If the `WITH CHECK` clause is missing or misconfigured, it will result in a `new row violates row-level security policy` error.
**Action:** Always create explicit and separate policies for `SELECT`, `INSERT`, and `UPDATE` when dealing with authenticated user data, explicitly defining `WITH CHECK` for writes.
*Example:*
```sql
CREATE POLICY "Permitir SELECT a dueños" ON my_table FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Permitir INSERT a dueños" ON my_table FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Permitir UPDATE a dueños" ON my_table FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```
