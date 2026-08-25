/* ==========================================================================
   Field naming, shared between the browser client and the seed script.

   The browser works in camelCase ('companyId', 'nextFollowUp'); the database
   is snake_case. The translation is mechanical, so it is derived rather than
   written out per field — a per-entity mapping table is a list of things that
   can silently disagree with the schema, and this cannot.

   It lives in its own module because supabase/seed.mjs needs exactly the same
   rules when it loads data/*.json into a fresh project, and two copies of a
   naming convention is one copy too many.
   ========================================================================== */

/* Only where the two sides genuinely disagree. 'start' and 'end' are reserved
   words in SQL, so those columns are start_date and end_date; everything else
   follows the convention exactly. */
export const RENAMES = {
  exhibitions: { start: 'start_date', end: 'end_date' },
};

export const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
export const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

export function toColumn(table, key) {
  return RENAMES[table]?.[key] ?? snake(key);
}

export function toField(table, column) {
  const renames = RENAMES[table];
  if (renames) {
    for (const [field, col] of Object.entries(renames)) {
      if (col === column) return field;
    }
  }
  return camel(column);
}

/* Empty string is how the UI represents "no follow-up set". It is not a date,
   and Postgres will say so. */
export const DATE_FIELDS = new Set(['nextFollowUp']);

/* Columns a client may write, per table. Anything else in a patch is dropped
   before it reaches PostgREST, so a stray key fails here — where the message
   is readable — rather than as a schema-cache error three layers down.

   created_at and updated_at are absent on purpose: they belong to the database
   and its triggers. */
export const WRITABLE = {
  profiles:   ['id', 'authUserId', 'name', 'email', 'role', 'title', 'region', 'active'],
  exhibitions:['id', 'code', 'name', 'city', 'venue', 'start', 'end', 'active',
               'visitors', 'boothCost', 'focus'],
  products:   ['id', 'name', 'category', 'family'],
  companies:  ['id', 'name', 'industry', 'size', 'city', 'state', 'country',
               'website', 'accountType', 'segment'],
  contacts:   ['id', 'companyId', 'name', 'designation', 'authority', 'email',
               'phone', 'linkedin', 'city', 'country', 'createdBy'],
  leads:      ['id', 'code', 'contactId', 'companyId', 'exhibitionId', 'ownerId',
               'stage', 'products', 'productIds', 'application', 'problem',
               'quantity', 'budget', 'timeline', 'authority', 'currentSolution',
               'competitor', 'value', 'source', 'engagement', 'capturedAt',
               'nextFollowUp', 'nextBestAction', 'nextBestActionWhy', 'consent',
               'tags', 'notes'],
  activities: ['id', 'leadId', 'companyId', 'type', 'title', 'body', 'actorId', 'at'],
  notifications: ['id', 'recipientId', 'severity', 'type', 'title', 'body',
                  'leadId', 'at', 'read'],
  audit_log:  ['id', 'action', 'entity', 'entityId', 'detail', 'actor', 'actorId', 'at'],
};

export function toRow(table, obj) {
  const allowed = WRITABLE[table];
  const row = {};
  for (const [key, value] of Object.entries(obj)) {
    if (allowed && !allowed.includes(key)) continue;
    row[toColumn(table, key)] = DATE_FIELDS.has(key) && value === '' ? null : value;
  }
  return row;
}

export function fromRow(table, row) {
  const obj = {};
  for (const [column, value] of Object.entries(row)) {
    const key = toField(table, column);
    if (value === null && DATE_FIELDS.has(key)) { obj[key] = ''; continue; }
    obj[key] = value;
  }
  // PostgREST can return a numeric as a string depending on its precision, and
  // the views do arithmetic on lead.value: '240000' + 1 is not 240001.
  if (obj.value !== undefined)     obj.value     = Number(obj.value) || 0;
  if (obj.boothCost !== undefined) obj.boothCost = Number(obj.boothCost) || 0;
  if (obj.visitors !== undefined)  obj.visitors  = Number(obj.visitors) || 0;
  return obj;
}
