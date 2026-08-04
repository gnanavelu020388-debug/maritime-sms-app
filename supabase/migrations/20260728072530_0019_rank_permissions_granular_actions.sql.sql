/*
# Migrate rank_permissions to granular per-action checkboxes

## Purpose
The original rank_permissions.apps JSONB stored a coarse "level" string
per app (e.g. "cook_operational"). This migration migrates those to a
granular per-action boolean model so Company Admins can toggle individual
actions within each app — e.g. "View Inventory & Stores" on, but
"Approve Food Orders" off — matching the hierarchical checkbox UI.

## Changes

### rank_permissions.apps JSONB structure (in-place migration)
Old shape:
  { "galley": { "visible": true, "level": "cook_operational" } }

New shape:
  {
    "galley": {
      "visible": true,
      "actions": {
        "view_inventory": true,
        "log_daily_meals": true,
        "draft_requisitions": true,
        "approve_food_orders": false,
        "manage_stores": false
      }
    }
  }

The migration runs an UPDATE that uses jsonb_set to convert each app's
`level` string into an `actions` object with booleans derived from the
level. The `level` key is kept for backward compatibility but the UI
now reads/writes `actions`.

### Level → actions mapping
- galley:
  - full_admin       → all actions true
  - cook_operational → view_inventory, log_daily_meals, draft_requisitions
  - view_menu_only   → view_inventory only
  - hidden           → all false (visible=false)
- rest_hours:
  - approve_all   → view_own, log_own, view_others, edit_others, approve_others
  - edit_all      → view_own, log_own, view_others, edit_others
  - own_log_only  → view_own, log_own
  - hidden        → all false
- sms:
  - full_access → view, search, print, edit, upload, approve
  - view_only   → view, search, print
  - hidden      → all false
- hscq:
  - full_access → view, edit, approve, close
  - edit_all    → view, edit
  - view_only   → view
  - hidden      → all false
- certificates:
  - full_admin → view, add, edit, revoke, verify
  - view_only  → view
  - hidden     → all false

## Data Safety
- No columns are dropped or renamed. Only the JSONB `apps` column
  content is rewritten in-place via UPDATE.
- The `level` key is preserved for backward compatibility.

## Important Notes
1. Existing rows are migrated automatically.
2. New rows seeded after this migration will use the new actions shape.
3. The frontend now reads/writes the `actions` object; the `level`
   key is kept for reference but not used by the UI.
*/

UPDATE rank_permissions
SET apps = (
  SELECT jsonb_object_agg(app_key, app_val)
  FROM (
    SELECT
      app_key,
      CASE
        -- Galley
        WHEN app_key = 'galley' AND app_val->>'level' = 'full_admin' THEN
          jsonb_set(app_val, '{actions}', '{"view_inventory":true,"log_daily_meals":true,"draft_requisitions":true,"approve_food_orders":true,"manage_stores":true}'::jsonb)
        WHEN app_key = 'galley' AND app_val->>'level' = 'cook_operational' THEN
          jsonb_set(app_val, '{actions}', '{"view_inventory":true,"log_daily_meals":true,"draft_requisitions":true,"approve_food_orders":false,"manage_stores":false}'::jsonb)
        WHEN app_key = 'galley' AND app_val->>'level' = 'view_menu_only' THEN
          jsonb_set(app_val, '{actions}', '{"view_inventory":true,"log_daily_meals":false,"draft_requisitions":false,"approve_food_orders":false,"manage_stores":false}'::jsonb)
        WHEN app_key = 'galley' AND app_val->>'level' = 'hidden' THEN
          jsonb_set(jsonb_set(app_val, '{visible}', 'false'::jsonb), '{actions}', '{"view_inventory":false,"log_daily_meals":false,"draft_requisitions":false,"approve_food_orders":false,"manage_stores":false}'::jsonb)
        -- Rest Hours
        WHEN app_key = 'rest_hours' AND app_val->>'level' = 'approve_all' THEN
          jsonb_set(app_val, '{actions}', '{"view_own":true,"log_own":true,"view_others":true,"edit_others":true,"approve_others":true}'::jsonb)
        WHEN app_key = 'rest_hours' AND app_val->>'level' = 'edit_all' THEN
          jsonb_set(app_val, '{actions}', '{"view_own":true,"log_own":true,"view_others":true,"edit_others":true,"approve_others":false}'::jsonb)
        WHEN app_key = 'rest_hours' AND app_val->>'level' = 'own_log_only' THEN
          jsonb_set(app_val, '{actions}', '{"view_own":true,"log_own":true,"view_others":false,"edit_others":false,"approve_others":false}'::jsonb)
        WHEN app_key = 'rest_hours' AND app_val->>'level' = 'hidden' THEN
          jsonb_set(jsonb_set(app_val, '{visible}', 'false'::jsonb), '{actions}', '{"view_own":false,"log_own":false,"view_others":false,"edit_others":false,"approve_others":false}'::jsonb)
        -- SMS
        WHEN app_key = 'sms' AND app_val->>'level' = 'full_access' THEN
          jsonb_set(app_val, '{actions}', '{"view":true,"search":true,"print":true,"edit":true,"upload":true,"approve":true}'::jsonb)
        WHEN app_key = 'sms' AND app_val->>'level' = 'view_only' THEN
          jsonb_set(app_val, '{actions}', '{"view":true,"search":true,"print":true,"edit":false,"upload":false,"approve":false}'::jsonb)
        WHEN app_key = 'sms' AND app_val->>'level' = 'hidden' THEN
          jsonb_set(jsonb_set(app_val, '{visible}', 'false'::jsonb), '{actions}', '{"view":false,"search":false,"print":false,"edit":false,"upload":false,"approve":false}'::jsonb)
        -- HSCQ
        WHEN app_key = 'hscq' AND app_val->>'level' = 'full_access' THEN
          jsonb_set(app_val, '{actions}', '{"view":true,"edit":true,"approve":true,"close":true}'::jsonb)
        WHEN app_key = 'hscq' AND app_val->>'level' = 'edit_all' THEN
          jsonb_set(app_val, '{actions}', '{"view":true,"edit":true,"approve":false,"close":false}'::jsonb)
        WHEN app_key = 'hscq' AND app_val->>'level' = 'view_only' THEN
          jsonb_set(app_val, '{actions}', '{"view":true,"edit":false,"approve":false,"close":false}'::jsonb)
        WHEN app_key = 'hscq' AND app_val->>'level' = 'hidden' THEN
          jsonb_set(jsonb_set(app_val, '{visible}', 'false'::jsonb), '{actions}', '{"view":false,"edit":false,"approve":false,"close":false}'::jsonb)
        -- Certificates
        WHEN app_key = 'certificates' AND app_val->>'level' = 'full_admin' THEN
          jsonb_set(app_val, '{actions}', '{"view":true,"add":true,"edit":true,"revoke":true,"verify":true}'::jsonb)
        WHEN app_key = 'certificates' AND app_val->>'level' = 'view_only' THEN
          jsonb_set(app_val, '{actions}', '{"view":true,"add":false,"edit":false,"revoke":false,"verify":false}'::jsonb)
        WHEN app_key = 'certificates' AND app_val->>'level' = 'hidden' THEN
          jsonb_set(jsonb_set(app_val, '{visible}', 'false'::jsonb), '{actions}', '{"view":false,"add":false,"edit":false,"revoke":false,"verify":false}'::jsonb)
        -- Fallback: keep existing but add empty actions
        ELSE
          CASE
            WHEN app_val ? 'actions' THEN app_val
            ELSE jsonb_set(app_val, '{actions}', '{}'::jsonb)
          END
      END AS app_val
    FROM jsonb_each(rank_permissions.apps) AS e(app_key, app_val)
  ) sub
);
