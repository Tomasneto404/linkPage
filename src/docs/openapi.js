// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * The OpenAPI description of this API, served at /api/openapi.json and
 * rendered by the Swagger UI at /api/docs.
 *
 * Written by hand. Every route is here, and tests/openapi.test.js walks the
 * live Express router to prove it: a route with no entry fails the suite, and
 * so does an entry for a route that no longer exists. That check is what makes
 * a hand-written document safe to keep.
 */

const { CURRENT_VERSION } = require('../config/env');
const schemas = require('./schemas');

// ─── Builders ─────────────────────────────────────────────────────────────────

const ref = name => ({ $ref: `#/components/schemas/${name}` });

/** A JSON response body. */
const json = (schema, description = 'Success') => ({
  description,
  content: { 'application/json': { schema } },
});

const arrayOf = name => ({ type: 'array', items: ref(name) });

const pathParam = (name, description, type = 'integer') => ({
  name, in: 'path', required: true, schema: { type }, description,
});

const queryParam = (name, description, schema = { type: 'string' }) => ({
  name, in: 'query', required: false, schema, description,
});

/** Request body as JSON. */
const jsonBody = (properties, required = []) => ({
  required: true,
  content: {
    'application/json': {
      schema: { type: 'object', properties, ...(required.length ? { required } : {}) },
    },
  },
});

/** Request body as multipart, for the routes that accept uploads. */
const formBody = (properties, required = []) => ({
  required: true,
  content: {
    'multipart/form-data': {
      schema: { type: 'object', properties, ...(required.length ? { required } : {}) },
    },
  },
});

const NO_CONTENT = { description: 'Done. No body.' };

/**
 * One operation. `auth` is 'admin' for the token-gated majority, 'public-gate'
 * for a route behind the optional public password, and 'open' otherwise.
 */
function op({ tag, summary, description, auth = 'admin', params, body, responses, deprecated }) {
  const out = {
    tags: [tag],
    summary,
    ...(description ? { description } : {}),
    ...(deprecated ? { deprecated: true } : {}),
    ...(params ? { parameters: params } : {}),
    ...(body ? { requestBody: body } : {}),
    responses: { ...responses },
  };

  if (auth === 'admin') {
    // Either credential opens an admin route: an administrator's session, or
    // the admin token. Two schemes in one array means "any of these".
    out.security = [{ AdminToken: [] }, { SessionCookie: [] }];
    out.responses['401'] = { $ref: '#/components/responses/Unauthorised' };
  } else if (auth === 'user') {
    out.security = [{ SessionCookie: [] }];
    out.responses['401'] = { $ref: '#/components/responses/Unauthenticated' };
  } else {
    // Documented as needing nothing, which is what the router enforces.
    out.security = [];
    if (auth === 'public-gate') {
      out.responses['401'] = {
        description: 'The public page is password-protected and no password was supplied.',
      };
    }
  }
  return out;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const TAGS = {
  links:    'Links',
  groups:   'Groups & sections',
  icons:    'Icon library',
  requests: 'Link requests',
  settings: 'Settings',
  auth:     'Authentication',
  users:    'Accounts',
  mine:     'Your own page',
  insight:  'Analytics & audit',
  system:   'System',
  visitor:  'Visitor-facing',
};

const paths = {
  // ── Links ─────────────────────────────────────────────────────────────────
  '/api/links': {
    get: op({
      tag: TAGS.links, auth: 'public-gate',
      summary: 'List links',
      description: 'Only links a visitor may see: nothing hidden, and nothing in a locked group '
                 + 'that has not been unlocked. Every link comes back with the admin token, or '
                 + 'with an administrator\'s session *and* `?view=admin`. The session alone is '
                 + 'not enough, because a browser sends it on the public page\'s fetch too.',
      params: [queryParam('view', 'Send `admin`, with an administrator\'s session, for every link.',
                          { type: 'string', enum: ['admin'] })],
      responses: { 200: json(arrayOf('Link')) },
    }),
    post: op({
      tag: TAGS.links,
      summary: 'Create a link',
      description: 'Send either a `url` or a `file`. A `.md` file renders as a page when opened.',
      body: formBody({
        name:        { type: 'string' },
        url:         { type: 'string', description: 'Required unless a file is attached.' },
        description: { type: 'string' },
        slug:        { type: 'string', description: 'Optional custom URL; must be unique.' },
        auto_open:   {
          type: 'boolean',
          description: 'Open this document automatically when its group is opened. '
                     + 'Markdown links only; anything else is a 400.',
        },
        groups:      ref('GroupAssignment'),
        icon_id:     { type: 'integer', description: 'Use an icon already in the library.' },
        image:       { type: 'string', format: 'binary', description: 'Custom icon.' },
        file:        { type: 'string', format: 'binary', description: 'Attachment, up to 100 MB.' },
      }, ['name']),
      responses: {
        201: json(ref('Link'), 'Created'),
        400: json(ref('Error'), 'Missing name, no url or file, or a slug that is taken or reserved'),
      },
    }),
  },
  '/api/links/{id}': {
    put: op({
      tag: TAGS.links,
      summary: 'Update a link',
      description: 'Omit `slug` to leave it alone; send it empty to clear it.',
      params: [pathParam('id', 'Link id')],
      body: formBody({
        name:         { type: 'string' },
        url:          { type: 'string' },
        description:  { type: 'string' },
        slug:         { type: 'string' },
        auto_open:    { type: 'boolean', description: 'Markdown links only.' },
        groups:       ref('GroupAssignment'),
        icon_id:      { type: 'integer' },
        image:        { type: 'string', format: 'binary' },
        file:         { type: 'string', format: 'binary' },
        remove_image: { type: 'string', enum: ['true', 'false'] },
        remove_file:  { type: 'string', enum: ['true', 'false'] },
      }, ['name']),
      responses: { 200: json(ref('Link')), 400: json(ref('Error')), 404: json(ref('Error'), 'No such link') },
    }),
    delete: op({
      tag: TAGS.links,
      summary: 'Delete a link',
      description: 'Takes its clicks, memberships and attached file with it. '
                 + 'A library icon is left alone.',
      params: [pathParam('id', 'Link id')],
      responses: { 204: NO_CONTENT, 404: json(ref('Error'), 'No such link') },
    }),
  },
  '/api/links/{id}/visibility': {
    post: op({
      tag: TAGS.links,
      summary: 'Hide or show a link',
      params: [pathParam('id', 'Link id')],
      body: jsonBody({ hidden: { type: 'boolean' } }, ['hidden']),
      responses: { 200: json(ref('Link')), 404: json(ref('Error')) },
    }),
  },
  '/api/links/{id}/clicks': {
    get: op({
      tag: TAGS.insight,
      summary: 'Click history for one link',
      params: [pathParam('id', 'Link id')],
      responses: {
        200: json({
          type: 'object',
          properties: {
            recentClicks: { type: 'array', items: { type: 'object' } },
            topIps:       { type: 'array', items: { type: 'object' } },
          },
        }),
      },
    }),
  },
  '/api/links/{id}/file': {
    get: op({
      tag: TAGS.links,
      summary: 'Read an attached text file',
      description: 'For the in-place editor. Only text-ish types, and only up to 5 MB.',
      params: [pathParam('id', 'Link id')],
      responses: {
        200: json({
          type: 'object',
          properties: { content: { type: 'string' }, size: { type: 'integer' } },
        }),
        404: json(ref('Error'), 'No file attached, or missing on disk'),
        413: json(ref('Error'), 'Too large to edit'),
        415: json(ref('Error'), 'Not a text-editable type'),
      },
    }),
    put: op({
      tag: TAGS.links,
      summary: 'Overwrite an attached text file',
      params: [pathParam('id', 'Link id')],
      body: jsonBody({ content: { type: 'string' } }, ['content']),
      responses: {
        200: json({ type: 'object', properties: { size: { type: 'integer' } } }),
        404: json(ref('Error')), 413: json(ref('Error')), 415: json(ref('Error')),
      },
    }),
  },
  '/api/links/reorder': {
    post: op({
      tag: TAGS.links,
      summary: 'Reorder every link',
      body: jsonBody({ order: { type: 'array', items: { type: 'integer' } } }, ['order']),
      responses: { 204: NO_CONTENT, 400: json(ref('Error'), 'order must be an array of ids') },
    }),
  },
  '/api/links/bulk-delete': {
    post: op({
      tag: TAGS.links,
      summary: 'Delete several links at once',
      body: jsonBody({ ids: { type: 'array', items: { type: 'integer' } } }, ['ids']),
      responses: { 200: json({ type: 'object', properties: { deleted: { type: 'integer' } } }) },
    }),
  },
  '/api/links/export': {
    get: op({
      tag: TAGS.links,
      summary: 'Export every link and the group hierarchy',
      description: 'Re-importing this on a clean instance recreates the same structure.',
      responses: { 200: json({ type: 'object' }, 'The export document (version 4)') },
    }),
  },
  '/api/links/import': {
    post: op({
      tag: TAGS.links,
      summary: 'Import links',
      description: 'Groups and sections are created as needed. Links whose URL is already '
                 + 'here are skipped, and a slug that would collide is dropped rather than '
                 + 'failing the row.',
      body: jsonBody({
        links:  { type: 'array', items: { type: 'object' } },
        groups: { type: 'array', items: { type: 'object' } },
      }, ['links']),
      responses: {
        200: json({
          type: 'object',
          properties: {
            imported: { type: 'integer' }, skipped: { type: 'integer' },
            groups_created: { type: 'integer' }, sections_created: { type: 'integer' },
            errors: { type: 'array', items: { type: 'string' } },
          },
        }),
        400: json(ref('Error'), 'The body has no links array'),
      },
    }),
  },

  // ── Groups & sections ─────────────────────────────────────────────────────
  '/api/groups': {
    get: op({
      tag: TAGS.groups, auth: 'open',
      summary: 'List groups',
      description: 'Public. A protected group is listed so its tab can be shown, but '
                 + 'its sections are withheld until it is unlocked.',
      responses: { 200: json(arrayOf('Group')) },
    }),
    post: op({
      tag: TAGS.groups,
      summary: 'Create a group',
      body: jsonBody({
        name:        { type: 'string' },
        color:       { type: 'string', example: '#0071e3' },
        password:    { type: 'string', description: 'Setting one makes the group protected.' },
        unlock_mode: { type: 'string', enum: ['session', 'persistent'] },
      }, ['name']),
      responses: { 201: json(ref('Group'), 'Created'), 400: json(ref('Error')) },
    }),
  },
  '/api/groups/{id}': {
    put: op({
      tag: TAGS.groups,
      summary: 'Update a group',
      params: [pathParam('id', 'Group id')],
      body: jsonBody({
        name:        { type: 'string' },
        color:       { type: 'string' },
        password:    { type: 'string', description: 'Empty string clears the protection.' },
        unlock_mode: { type: 'string', enum: ['session', 'persistent'] },
      }, ['name']),
      responses: { 200: json(ref('Group')), 400: json(ref('Error')), 404: json(ref('Error')) },
    }),
    delete: op({
      tag: TAGS.groups,
      summary: 'Delete a group',
      description: 'Its sections go too. Links survive, simply no longer in it.',
      params: [pathParam('id', 'Group id')],
      responses: { 204: NO_CONTENT, 404: json(ref('Error')) },
    }),
  },
  '/api/groups/reorder': {
    post: op({
      tag: TAGS.groups,
      summary: 'Reorder groups',
      body: jsonBody({ order: { type: 'array', items: { type: 'integer' } } }, ['order']),
      responses: { 204: NO_CONTENT, 400: json(ref('Error')) },
    }),
  },
  '/api/groups/{id}/sections': {
    post: op({
      tag: TAGS.groups,
      summary: 'Create a section in a group',
      description: 'Pass `parent_section_id` for a subsection. One level only.',
      params: [pathParam('id', 'Group id')],
      body: jsonBody({
        name:              { type: 'string' },
        parent_section_id: { type: 'integer', nullable: true },
      }, ['name']),
      responses: { 201: json(ref('Section'), 'Created'), 400: json(ref('Error')), 404: json(ref('Error')) },
    }),
  },
  '/api/groups/{id}/unlock': {
    post: op({
      tag: TAGS.groups, auth: 'open',
      summary: 'Unlock a protected group',
      description: 'Sets a cookie the visitor\'s later requests carry. Rate-limited.',
      params: [pathParam('id', 'Group id')],
      body: jsonBody({ password: { type: 'string' } }, ['password']),
      responses: {
        200: json({ type: 'object', properties: { ok: { type: 'boolean' } } }),
        401: json(ref('Error'), 'Wrong password'),
        429: json(ref('Error'), 'Too many attempts'),
      },
    }),
  },
  '/api/groups/{id}/lock': {
    post: op({
      tag: TAGS.groups, auth: 'open',
      summary: 'Lock a group again',
      description: 'Clears this visitor\'s unlock cookie.',
      params: [pathParam('id', 'Group id')],
      responses: { 200: json({ type: 'object', properties: { ok: { type: 'boolean' } } }) },
    }),
  },
  '/api/sections/{id}': {
    put: op({
      tag: TAGS.groups,
      summary: 'Rename a section',
      params: [pathParam('id', 'Section id')],
      body: jsonBody({ name: { type: 'string' } }, ['name']),
      responses: { 200: json(ref('Section')), 400: json(ref('Error')), 404: json(ref('Error')) },
    }),
    delete: op({
      tag: TAGS.groups,
      summary: 'Delete a section',
      params: [pathParam('id', 'Section id')],
      responses: { 204: NO_CONTENT, 404: json(ref('Error')) },
    }),
  },
  '/api/sections/reorder': {
    post: op({
      tag: TAGS.groups,
      summary: 'Reorder sections within a group',
      body: jsonBody({ order: { type: 'array', items: { type: 'integer' } } }, ['order']),
      responses: { 204: NO_CONTENT, 400: json(ref('Error')) },
    }),
  },

  // ── Icon library ──────────────────────────────────────────────────────────
  '/api/icons': {
    get: op({
      tag: TAGS.icons,
      summary: 'List library icons',
      responses: { 200: json(arrayOf('Icon')) },
    }),
    post: op({
      tag: TAGS.icons,
      summary: 'Upload an icon',
      body: formBody({ image: { type: 'string', format: 'binary' } }, ['image']),
      responses: { 201: json(ref('Icon'), 'Created'), 400: json(ref('Error'), 'Not an allowed image type') },
    }),
  },
  '/api/icons/{id}': {
    delete: op({
      tag: TAGS.icons,
      summary: 'Delete an icon',
      description: 'Removes the file too. Links pointing at it lose their custom icon.',
      params: [pathParam('id', 'Icon id')],
      responses: { 204: NO_CONTENT, 404: json(ref('Error')) },
    }),
  },
  '/api/icons/bulk-delete': {
    post: op({
      tag: TAGS.icons,
      summary: 'Delete several icons',
      body: jsonBody({ ids: { type: 'array', items: { type: 'integer' } } }, ['ids']),
      responses: { 200: json({ type: 'object', properties: { deleted: { type: 'integer' } } }) },
    }),
  },
  '/api/icons/export': {
    get: op({
      tag: TAGS.icons,
      summary: 'Export the library',
      description: 'Image bytes are inlined as base64 so the document stands alone.',
      responses: { 200: json({ type: 'object' }) },
    }),
  },
  '/api/icons/import': {
    post: op({
      tag: TAGS.icons,
      summary: 'Import a library export',
      body: jsonBody({ icons: { type: 'array', items: { type: 'object' } } }, ['icons']),
      responses: {
        200: json({
          type: 'object',
          properties: {
            imported: { type: 'integer' }, skipped: { type: 'integer' },
            errors: { type: 'array', items: { type: 'string' } },
          },
        }),
        400: json(ref('Error')),
      },
    }),
  },
  '/api/favicon-preview': {
    get: op({
      tag: TAGS.icons,
      summary: 'Fetch a site\'s favicon without saving it',
      description: 'Used by the admin form to show what an icon will look like.',
      params: [queryParam('url', 'The site to look at')],
      responses: {
        200: { description: 'The image bytes', content: { 'image/*': { schema: { type: 'string', format: 'binary' } } } },
        400: json(ref('Error'), 'Missing or invalid url'),
        404: json(ref('Error'), 'Nothing found'),
      },
    }),
  },

  // ── Link requests ─────────────────────────────────────────────────────────
  '/api/link-requests': {
    get: op({
      tag: TAGS.requests,
      summary: 'List requests',
      params: [queryParam('status', 'pending (default), approved, rejected, or all')],
      responses: {
        200: json({
          type: 'object',
          properties: {
            pending_count: { type: 'integer' },
            requests: arrayOf('LinkRequest'),
          },
        }),
      },
    }),
    post: op({
      tag: TAGS.requests, auth: 'open',
      summary: 'Submit a request',
      description: 'Open to visitors, and only while the feature is switched on. Rate-limited, '
                 + 'and gated by a password when one is set (header `X-Request-Password`).\n\n'
                 + '`kind=link` proposes a URL, `kind=file` attaches a document, and '
                 + '`kind=change` proposes new values for `target_link_id` — optionally with a '
                 + 'replacement file, when that link already holds one.\n\n'
                 + 'Uploads from visitors are capped at 25 MB and may not be types a browser '
                 + 'executes (no .html, .svg, .xml or .json).',
      body: formBody({
        kind:           { type: 'string', enum: ['link', 'file', 'change'], default: 'link' },
        name:           { type: 'string' },
        url:            { type: 'string' },
        description:    { type: 'string' },
        note:           { type: 'string' },
        group_id:       { type: 'integer', description: 'Required for link and file requests.' },
        section_id:     { type: 'integer' },
        target_link_id: { type: 'integer', description: 'Required for a change request.' },
        image:          { type: 'string', format: 'binary', description: 'Icon. Raster only.' },
        file:           { type: 'string', format: 'binary' },
      }),
      responses: {
        201: json({ type: 'object', properties: { id: { type: 'integer' }, ok: { type: 'boolean' } } }, 'Submitted'),
        400: json(ref('Error'), 'Validation failed'),
        401: json(ref('Error'), 'A request password is set and was wrong or missing'),
        403: json(ref('Error'), 'Requests are switched off'),
        429: json(ref('Error'), 'Too many submissions'),
      },
    }),
  },
  '/api/link-requests/{id}/approve': {
    post: op({
      tag: TAGS.requests,
      summary: 'Approve a request',
      description: 'A file request is published outright: the new link takes the upload as its '
                 + 'attachment. For other kinds this only marks the row, optionally recording '
                 + 'which link it produced.',
      params: [pathParam('id', 'Request id')],
      body: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { link_id: { type: 'integer' } } } } } },
      responses: {
        200: json({ type: 'object', properties: { ok: { type: 'boolean' }, link: ref('Link') } }),
        400: json(ref('Error'), 'The request has no valid group to publish into'),
        404: json(ref('Error')),
      },
    }),
  },
  '/api/link-requests/{id}/attach': {
    post: op({
      tag: TAGS.requests,
      summary: 'Approve by adding the existing link to the requested group',
      description: 'For when the URL is already published and a second copy would be wrong.',
      params: [pathParam('id', 'Request id')],
      responses: {
        200: json({ type: 'object', properties: { ok: { type: 'boolean' }, added: { type: 'boolean' }, link: ref('Link') } }),
        400: json(ref('Error')),
        404: json(ref('Error')),
        409: json(ref('Error'), 'No published link matches this URL'),
      },
    }),
  },
  '/api/link-requests/{id}/apply': {
    post: op({
      tag: TAGS.requests,
      summary: 'Apply a change request',
      description: 'Writes the proposed values onto the target link. A proposed file replaces '
                 + 'the current one, and the file it replaced is deleted.',
      params: [pathParam('id', 'Request id')],
      responses: {
        200: json({ type: 'object', properties: { ok: { type: 'boolean' }, link: ref('Link') } }),
        400: json(ref('Error'), 'Not a change request'),
        404: json(ref('Error')),
        409: json(ref('Error'), 'The target link no longer exists'),
      },
    }),
  },
  '/api/link-requests/{id}/reject': {
    post: op({
      tag: TAGS.requests,
      summary: 'Reject a request',
      description: 'An unpublished upload is deleted from disk. Not undoable.',
      params: [pathParam('id', 'Request id')],
      responses: { 200: json({ type: 'object', properties: { ok: { type: 'boolean' } } }), 404: json(ref('Error')) },
    }),
  },
  '/api/link-requests/{id}': {
    delete: op({
      tag: TAGS.requests,
      summary: 'Delete a request',
      description: 'As with rejecting, an upload that was never published goes with it.',
      params: [pathParam('id', 'Request id')],
      responses: { 204: NO_CONTENT, 404: json(ref('Error')) },
    }),
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  '/api/settings': {
    get: op({
      tag: TAGS.settings, auth: 'open',
      summary: 'Read public settings',
      description: 'No token: the public page needs these to render. Secrets are reported '
                 + 'only as booleans — never the values.',
      responses: { 200: json(ref('Settings')) },
    }),
  },
  '/api/settings/site-title': {
    post: op({
      tag: TAGS.settings, summary: 'Set the site title',
      body: jsonBody({ title: { type: 'string', description: 'Empty clears it.' } }),
      responses: { 200: json({ type: 'object', properties: { site_title: { type: 'string', nullable: true } } }) },
    }),
  },
  '/api/settings/logo/{variant}': {
    post: op({
      tag: TAGS.settings, summary: 'Upload a logo',
      params: [pathParam('variant', 'light or dark', 'string')],
      body: formBody({ logo: { type: 'string', format: 'binary' } }, ['logo']),
      responses: { 200: json({ type: 'object' }), 400: json(ref('Error'), 'Bad variant or no file') },
    }),
    delete: op({
      tag: TAGS.settings, summary: 'Remove a logo',
      params: [pathParam('variant', 'light or dark', 'string')],
      responses: { 200: json({ type: 'object' }), 400: json(ref('Error')) },
    }),
  },
  '/api/settings/brand-icon': {
    post: op({
      tag: TAGS.settings,
      summary: 'Set the header glyph',
      description: 'Either upload `icon`, or send JSON with an `icon_id` from the library.',
      body: formBody({
        icon:    { type: 'string', format: 'binary' },
        icon_id: { type: 'integer' },
      }),
      responses: { 200: json({ type: 'object' }), 400: json(ref('Error')) },
    }),
    delete: op({
      tag: TAGS.settings, summary: 'Remove the header glyph',
      responses: { 200: json({ type: 'object' }) },
    }),
  },
  '/api/settings/favicon': {
    post: op({
      tag: TAGS.settings, summary: 'Upload the browser tab icon',
      body: formBody({ favicon: { type: 'string', format: 'binary' } }, ['favicon']),
      responses: { 200: json({ type: 'object' }), 400: json(ref('Error')) },
    }),
    delete: op({
      tag: TAGS.settings, summary: 'Remove the browser tab icon',
      responses: { 200: json({ type: 'object' }) },
    }),
  },
  '/api/settings/wallpaper/{variant}': {
    post: op({
      tag: TAGS.settings,
      summary: 'Set the public page wallpaper',
      description: 'One image per theme, up to 15 MB. Replacing one deletes the file it '
                 + 'replaced. How heavily it is veiled sits in `/api/settings/wallpaper-fog`.',
      params: [pathParam('variant', 'light or dark', 'string')],
      body: formBody({ wallpaper: { type: 'string', format: 'binary' } }, ['wallpaper']),
      responses: {
        200: json({ type: 'object', properties: { wallpaper_url: { type: 'string' } } }),
        400: json(ref('Error'), 'Bad variant, no file, or not an image'),
      },
    }),
    delete: op({
      tag: TAGS.settings,
      summary: 'Remove the wallpaper for one theme',
      params: [pathParam('variant', 'light or dark', 'string')],
      responses: {
        200: json({ type: 'object', properties: { wallpaper_url: { type: 'string', nullable: true } } }),
        400: json(ref('Error'), 'Bad variant'),
      },
    }),
  },
  '/api/settings/wallpaper-fog': {
    post: op({
      tag: TAGS.settings,
      summary: 'Set how heavily the wallpaper is fogged',
      description: '0 leaves the photograph alone; 100 is all but the plain background. '
                 + 'One number drives both the veil and the blur, so the two cannot be set '
                 + 'to a combination that looks wrong.',
      body: jsonBody({ fog: { type: 'integer', minimum: 0, maximum: 100, default: 60 } }, ['fog']),
      responses: {
        200: json({ type: 'object', properties: { wallpaper_fog: { type: 'integer' } } }),
        400: json(ref('Error'), 'Not a number, or outside 0–100'),
      },
    }),
  },
  '/api/settings/bar-opacity': {
    post: op({
      tag: TAGS.settings,
      summary: 'Set how solid the sticky bars are',
      description: 'One number from 0 to 100 for the header, the group tab strip and the '
                 + 'footer together. 0 is completely see-through — no tint and no blur, since '
                 + 'a bar that blurs without tinting is a smear rather than a window. 100 is '
                 + 'flat colour.',
      body: jsonBody({ opacity: { type: 'integer', minimum: 0, maximum: 100, default: 82 } }, ['opacity']),
      responses: {
        200: json({ type: 'object', properties: { bar_opacity: { type: 'integer' } } }),
        400: json(ref('Error'), 'Not a number, or outside 0–100'),
      },
    }),
  },
  '/api/settings/theme': {
    post: op({
      tag: TAGS.settings,
      summary: 'Set theme options',
      body: jsonBody({
        default_theme:       { type: 'string', enum: ['light', 'dark', 'system'] },
        theme_light_variant: { type: 'string' },
        theme_dark_variant:  { type: 'string' },
        accent_color:        { type: 'string', example: '#0071e3' },
        accent_dark_adjust:  { type: 'boolean' },
        accent_glow:         { type: 'boolean' },
        mobile_nav_position: { type: 'string', enum: ['top', 'bottom'] },
      }),
      responses: { 200: json({ type: 'object' }), 400: json(ref('Error'), 'A value is outside its allowed set') },
    }),
  },
  '/api/settings/pinned-group': {
    post: op({
      tag: TAGS.settings, summary: 'Pin the group visitors land on',
      body: jsonBody({ group_id: { type: 'integer', nullable: true, description: 'null shows All.' } }),
      responses: { 200: json({ type: 'object' }), 400: json(ref('Error')) },
    }),
  },
  '/api/settings/save-favicons': {
    post: op({
      tag: TAGS.settings, summary: 'Toggle saving fetched favicons into the library',
      body: jsonBody({ enabled: { type: 'boolean' } }, ['enabled']),
      responses: { 200: json({ type: 'object' }) },
    }),
  },
  '/api/settings/footer-enabled': {
    post: op({
      tag: TAGS.settings, summary: 'Toggle the developer credit footer',
      body: jsonBody({ enabled: { type: 'boolean' } }, ['enabled']),
      responses: { 200: json({ type: 'object' }) },
    }),
  },
  '/api/settings/group-tab-color': {
    post: op({
      tag: TAGS.settings, summary: 'Toggle group-coloured tabs',
      body: jsonBody({ enabled: { type: 'boolean' } }, ['enabled']),
      responses: { 200: json({ type: 'object' }) },
    }),
  },
  '/api/settings/group-tabs-loop': {
    post: op({
      tag: TAGS.settings, summary: 'Toggle endless looping of the group tab strip',
      body: jsonBody({ enabled: { type: 'boolean' } }, ['enabled']),
      responses: { 200: json({ type: 'object' }) },
    }),
  },
  '/api/settings/user-quota': {
    post: op({
      tag: TAGS.settings,
      summary: 'How much each member may store',
      description: 'In megabytes. Applies to every account without an allowance of its own. '
                 + 'Counts attachments, icons and fetched favicons.',
      body: jsonBody({ megabytes: { type: 'number', minimum: 0, example: 100 } }, ['megabytes']),
      responses: {
        200: json({ type: 'object', properties: { user_storage_quota: { type: 'integer' } } }),
        400: json(ref('Error')),
      },
    }),
  },
  '/api/settings/markdown-open-mode': {
    post: op({
      tag: TAGS.settings,
      summary: 'Choose how a markdown link opens',
      body: jsonBody({ mode: { type: 'string', enum: ['modal', 'tab'], default: 'modal' } }, ['mode']),
      responses: {
        200: json({ type: 'object', properties: { markdown_open_mode: { type: 'string' } } }),
        400: json(ref('Error'), 'Mode must be tab or modal'),
      },
    }),
  },
  '/api/settings/requests-enabled': {
    post: op({
      tag: TAGS.settings, summary: 'Switch visitor link requests on or off',
      body: jsonBody({ enabled: { type: 'boolean' } }, ['enabled']),
      responses: { 200: json({ type: 'object' }) },
    }),
  },
  '/api/settings/public-password': {
    post: op({
      tag: TAGS.settings, summary: 'Set the password for the whole public page',
      body: jsonBody({ password: { type: 'string' } }, ['password']),
      responses: { 200: json({ type: 'object' }), 400: json(ref('Error')) },
    }),
    delete: op({
      tag: TAGS.settings, summary: 'Remove the public page password',
      responses: { 200: json({ type: 'object' }) },
    }),
  },
  '/api/settings/request-password': {
    post: op({
      tag: TAGS.settings, summary: 'Set the password for submitting requests',
      body: jsonBody({ password: { type: 'string' } }, ['password']),
      responses: { 200: json({ type: 'object' }), 400: json(ref('Error')) },
    }),
    delete: op({
      tag: TAGS.settings, summary: 'Remove the request password',
      responses: { 200: json({ type: 'object' }) },
    }),
  },

  // ── Authentication ────────────────────────────────────────────────────────
  '/api/auth/login': {
    post: op({
      tag: TAGS.auth, auth: 'open',
      summary: 'Sign in',
      description: 'Sets an HttpOnly session cookie. Every failure answers the same way, '
                 + 'so this cannot be used to find out which addresses have accounts.',
      body: jsonBody({
        email:    { type: 'string', format: 'email' },
        password: { type: 'string', format: 'password' },
        remember: { type: 'boolean', default: true,
                    description: 'False issues a cookie that ends with the browser session. '
                               + 'The server-side expiry is the same either way.' },
      }, ['email', 'password']),
      responses: {
        200: json({ type: 'object', properties: { user: ref('User') } }),
        401: json(ref('Error'), 'Wrong email or password'),
        429: json(ref('Error'), 'Too many failed attempts'),
      },
    }),
  },
  '/api/auth/logout': {
    post: op({
      tag: TAGS.auth, auth: 'open',
      summary: 'Sign out',
      description: 'Deletes the session server-side and clears the cookie. Answers the '
                 + 'same whether or not there was a session.',
      responses: { 200: json({ type: 'object', properties: { ok: { type: 'boolean' } } }) },
    }),
  },
  '/api/auth/logout-all': {
    post: op({
      tag: TAGS.auth, auth: 'user',
      summary: 'Sign out everywhere else',
      description: 'Ends every other session for this account and keeps the current one.',
      responses: {
        200: json({ type: 'object', properties: { ended: { type: 'integer' } } }),
      },
    }),
  },
  '/api/auth/me': {
    get: op({
      tag: TAGS.auth, auth: 'open',
      summary: 'Who is signed in',
      description: 'Answers 200 with a null user when nobody is, rather than 401 — every '
                 + 'page load asks this, including anonymous ones.',
      responses: {
        200: json({
          type: 'object',
          properties: {
            authenticated: { type: 'boolean' },
            user:          { ...ref('User'), nullable: true },
            via:           { type: 'string', nullable: true, enum: ['session', 'token', null] },
          },
        }),
      },
    }),
  },
  '/api/auth/providers': {
    get: op({
      tag: TAGS.auth, auth: 'open',
      summary: 'Ways to sign in',
      description: 'One entry today, for a password. An external identity provider would '
                 + 'appear here, so the sign-in page needs no change to offer it.',
      responses: { 200: json({ type: 'object' }) },
    }),
  },
  '/api/auth/password': {
    post: op({
      tag: TAGS.auth, auth: 'user',
      summary: 'Change your own password',
      description: 'Ends every other session for the account: a password is changed when '
                 + 'it might be known, and the sessions it opened would outlive the change.',
      body: jsonBody({
        current_password: { type: 'string', format: 'password' },
        new_password:     { type: 'string', format: 'password' },
      }, ['current_password', 'new_password']),
      responses: {
        200: json({ type: 'object' }),
        400: json(ref('Error'), 'The new password is too short'),
        401: json(ref('Error'), 'The current password is wrong'),
        429: json(ref('Error'), 'Too many attempts'),
      },
    }),
  },
  '/api/auth/sessions': {
    get: op({
      tag: TAGS.auth, auth: 'user',
      summary: 'Where you are signed in',
      responses: { 200: json({ type: 'object' }) },
    }),
  },
  '/api/auth/sessions/{id}': {
    delete: op({
      tag: TAGS.auth, auth: 'user',
      summary: 'End one of your sessions',
      params: [pathParam('id', 'The short id from GET /api/auth/sessions.', 'string')],
      responses: {
        200: json({ type: 'object' }),
        404: json(ref('Error'), 'No such session'),
      },
    }),
  },
  '/api/auth/verify': {
    post: op({
      tag: TAGS.auth, auth: 'open',
      summary: 'Check an admin token',
      description: 'Rate-limited, and the comparison is constant-time.',
      body: jsonBody({ token: { type: 'string' } }, ['token']),
      responses: {
        200: json({ type: 'object', properties: { valid: { type: 'boolean' } } }),
        429: json(ref('Error'), 'Too many attempts'),
      },
    }),
  },
  '/api/auth/verify-public': {
    post: op({
      tag: TAGS.auth, auth: 'open',
      summary: 'Check the public page password',
      body: jsonBody({ password: { type: 'string' } }, ['password']),
      responses: {
        200: json({ type: 'object', properties: { valid: { type: 'boolean' } } }),
        429: json(ref('Error')),
      },
    }),
  },
  '/api/auth/rotate-token': {
    post: op({
      tag: TAGS.auth,
      summary: 'Issue a new admin token',
      description: 'The old token stops working immediately. The new one is returned once '
                 + 'and never again — store it before closing the response.',
      responses: { 200: json({ type: 'object', properties: { token: { type: 'string' } } }) },
    }),
  },

  // ── Accounts ──────────────────────────────────────────────────────────────
  '/api/users': {
    get: op({
      tag: TAGS.users, summary: 'List accounts',
      responses: { 200: json({ type: 'object' }) },
    }),
  },
  '/api/users/{id}': {
    get: op({
      tag: TAGS.users, summary: 'One account',
      params: [pathParam('id', 'User id.')],
      responses: { 200: json(ref('User')), 404: json(ref('Error')) },
    }),
    patch: op({
      tag: TAGS.users, summary: 'Change an account',
      description: 'Not the password, which has its own route, and not the email, which is '
                 + 'the account\'s identity. Refuses to demote or disable the last '
                 + 'administrator who can still sign in, and refuses to change your own role.',
      params: [pathParam('id', 'User id.')],
      body: jsonBody({
        display_name:     { type: 'string' },
        role:             { type: 'string', enum: ['admin', 'user'] },
        is_active:        { type: 'boolean' },
        storage_quota_mb: { type: 'number', nullable: true,
                            description: "This account's own allowance, or null for the instance's." },
      }),
      responses: {
        200: json(ref('User')),
        404: json(ref('Error')),
        409: json(ref('Error'), 'Would leave no administrator, or is your own role'),
      },
    }),
    delete: op({
      tag: TAGS.users, summary: 'Delete an account',
      description: 'Takes its sessions and tokens with it.',
      params: [pathParam('id', 'User id.')],
      responses: {
        200: json({ type: 'object' }),
        404: json(ref('Error')),
        409: json(ref('Error'), 'Would leave no administrator, or is your own account'),
      },
    }),
  },
  '/api/users/{id}/password': {
    post: op({
      tag: TAGS.users, summary: 'Set somebody\'s password',
      description: 'For an administrator helping somebody standing next to them. Ends that '
                 + 'account\'s sessions and marks the password as needing changing. A reset '
                 + 'link is the better path.',
      params: [pathParam('id', 'User id.')],
      body: jsonBody({ password: { type: 'string', format: 'password' } }, ['password']),
      responses: { 200: json({ type: 'object' }), 400: json(ref('Error')), 404: json(ref('Error')) },
    }),
  },
  '/api/users/{id}/logout-all': {
    post: op({
      tag: TAGS.users, summary: 'Sign somebody out everywhere',
      params: [pathParam('id', 'User id.')],
      responses: { 200: json({ type: 'object' }), 404: json(ref('Error')) },
    }),
  },
  '/api/users/{id}/reset-link': {
    post: op({
      tag: TAGS.users, summary: 'Issue a password-reset link',
      description: 'Returns a URL to hand over. This app sends no email, so delivering it is '
                 + 'the administrator\'s job. Any earlier reset for the account is revoked, '
                 + 'and the URL is returned once — only its hash is kept.',
      params: [pathParam('id', 'User id.')],
      responses: { 201: json({ type: 'object' }), 404: json(ref('Error')) },
    }),
  },
  '/api/invites': {
    get: op({
      tag: TAGS.users, summary: 'List invites',
      description: 'With a status worked out for each: pending, redeemed, revoked or expired.',
      responses: { 200: json({ type: 'object' }) },
    }),
    post: op({
      tag: TAGS.users, summary: 'Create an invite',
      description: 'The link comes back once and cannot be recovered afterwards. Issue '
                 + 'another if it is lost.',
      body: jsonBody({
        role:            { type: 'string', enum: ['admin', 'user'], default: 'user' },
        label:           { type: 'string', description: 'A note about who it is for.' },
        expires_in_days: { type: 'integer', minimum: 1, maximum: 30, default: 7 },
      }),
      responses: { 201: json({ type: 'object' }) },
    }),
  },
  '/api/invites/{id}': {
    delete: op({
      tag: TAGS.users, summary: 'Revoke an invite',
      description: 'Keeps the row, so the record of who issued what survives. A revoked '
                 + 'invite then fails exactly as an expired one does.',
      params: [pathParam('id', 'Invite id.')],
      responses: {
        200: json({ type: 'object' }),
        404: json(ref('Error')),
        409: json(ref('Error'), 'Already used'),
      },
    }),
  },
  '/api/tokens/{token}': {
    get: op({
      tag: TAGS.auth, auth: 'open',
      summary: 'Check an invite or reset link',
      description: 'Says only whether the link is good and what it is for. Never who it was '
                 + 'meant for or who issued it — a link can be forwarded.',
      params: [pathParam('token', 'The secret from the link.', 'string')],
      responses: { 200: json({ type: 'object' }), 404: json(ref('Error')) },
    }),
  },
  '/api/tokens/{token}/redeem': {
    post: op({
      tag: TAGS.auth, auth: 'open',
      summary: 'Accept an invite, or finish a password reset',
      description: 'Signs the person in afterwards. Expired, revoked, already used and never '
                 + 'existed all answer identically, so this cannot be used to probe which '
                 + 'links once existed.',
      params: [pathParam('token', 'The secret from the link.', 'string')],
      body: jsonBody({
        password:     { type: 'string', format: 'password' },
        email:        { type: 'string', format: 'email', description: 'Invites only.' },
        display_name: { type: 'string', description: 'Invites only.' },
      }, ['password']),
      responses: {
        200: json({ type: 'object', properties: { user: ref('User') } }),
        400: json(ref('Error'), 'The link is not valid, or the password is too short'),
        409: json(ref('Error'), 'That address already has an account'),
        429: json(ref('Error'), 'Too many attempts'),
      },
    }),
  },

  // ── Your own page ─────────────────────────────────────────────────────────
  '/api/my/data': {
    get: op({
      tag: TAGS.mine, auth: 'user',
      summary: 'Everything of yours, at once',
      description: 'Your groups (with their sections), your links, and how much of your '
                 + 'storage allowance they use. Shaped like the shared groups and links, '
                 + 'with `owner: "me"`, so a page can merge the two and render them alike. '
                 + 'Ids are your own and may coincide with shared ones.',
      responses: { 200: json({ type: 'object' }) },
    }),
  },
  '/api/my/storage': {
    get: op({
      tag: TAGS.mine, auth: 'user', summary: 'How much of your allowance you are using',
      responses: { 200: json(ref('Storage')) },
    }),
  },
  '/api/my/icons': {
    get: op({
      tag: TAGS.mine, auth: 'user', summary: 'The shared icon library, to pick from',
      description: 'Read-only. These images are already public under /uploads.',
      responses: { 200: json({ type: 'object' }) },
    }),
  },
  '/api/my/favicon-preview': {
    get: op({
      tag: TAGS.mine, auth: 'user',
      summary: 'The icon a web address would get',
      description: 'Fetched by this server before the link is saved, under the same rules a '
                 + 'saved favicon is: public addresses only, never through Google. Returns '
                 + 'the image, stores nothing, and is throttled.',
      params: [queryParam('url', 'The web address to look up.')],
      responses: {
        200: { description: 'The image' },
        400: json(ref('Error'), 'Not a web address'),
        404: json(ref('Error'), 'No usable icon there'),
        429: json(ref('Error'), 'Too many previews'),
      },
    }),
  },
  '/api/my/groups': {
    post: op({
      tag: TAGS.mine, auth: 'user', summary: 'Add a group of your own',
      body: jsonBody({ name: { type: 'string' }, color: { type: 'string', example: '#0071e3' } }, ['name']),
      responses: {
        201: json({ type: 'object' }), 400: json(ref('Error')),
        409: json(ref('Error'), 'You already have as many groups as allowed'),
      },
    }),
  },
  '/api/my/groups/reorder': {
    post: op({
      tag: TAGS.mine, auth: 'user', summary: 'Put your groups in order',
      description: 'Ids that are not yours are ignored, never written.',
      body: jsonBody({ order: { type: 'array', items: { type: 'integer' } } }, ['order']),
      responses: { 200: json({ type: 'object' }), 400: json(ref('Error')) },
    }),
  },
  '/api/my/groups/{id}': {
    put: op({
      tag: TAGS.mine, auth: 'user', summary: 'Rename or recolour one of your groups',
      params: [pathParam('id', 'Id of one of your own')],
      body: jsonBody({ name: { type: 'string' }, color: { type: 'string' } }, ['name']),
      responses: { 200: json({ type: 'object' }), 400: json(ref('Error')), 404: json(ref('Error')) },
    }),
    delete: op({
      tag: TAGS.mine, auth: 'user', summary: 'Delete one of your groups',
      description: 'Its sections go with it. Its links do not — they are only unfiled.',
      params: [pathParam('id', 'Id of one of your own')],
      responses: { 200: json({ type: 'object' }), 404: json(ref('Error')) },
    }),
  },
  '/api/my/groups/{id}/sections': {
    post: op({
      tag: TAGS.mine, auth: 'user', summary: 'Add a section to one of your groups',
      params: [pathParam('id', 'Id of one of your own')],
      body: jsonBody({
        name:              { type: 'string' },
        parent_section_id: { type: 'integer', nullable: true, description: 'One level of nesting.' },
      }, ['name']),
      responses: {
        201: json({ type: 'object' }), 400: json(ref('Error')),
        404: json(ref('Error'), 'Not your group, or not a valid parent'),
        409: json(ref('Error')),
      },
    }),
  },
  '/api/my/sections/reorder': {
    post: op({
      tag: TAGS.mine, auth: 'user', summary: 'Put your sections in order',
      body: jsonBody({ order: { type: 'array', items: { type: 'integer' } } }, ['order']),
      responses: { 200: json({ type: 'object' }), 400: json(ref('Error')) },
    }),
  },
  '/api/my/sections/{id}': {
    put: op({
      tag: TAGS.mine, auth: 'user', summary: 'Rename one of your sections',
      params: [pathParam('id', 'Id of one of your own')],
      body: jsonBody({ name: { type: 'string' } }, ['name']),
      responses: { 200: json({ type: 'object' }), 400: json(ref('Error')), 404: json(ref('Error')) },
    }),
    delete: op({
      tag: TAGS.mine, auth: 'user', summary: 'Delete one of your sections',
      description: 'Links filed under it move up to the group rather than leaving it.',
      params: [pathParam('id', 'Id of one of your own')],
      responses: { 200: json({ type: 'object' }), 404: json(ref('Error')) },
    }),
  },
  '/api/my/links': {
    post: op({
      tag: TAGS.mine, auth: 'user', summary: 'Add a link of your own',
      description: 'A web address, or an attached file. Files are stored privately and '
                 + 'count against your allowance. A favicon is fetched for a web address '
                 + 'after the response, and stored privately too.',
      body: formBody({
        name:        { type: 'string' },
        url:         { type: 'string', description: 'Omit when attaching a file.' },
        description: { type: 'string' },
        groups:      { type: 'string', description: 'JSON array of `{ group_id, section_id }`.' },
        icon_id:     { type: 'integer', description: 'A shared library icon.' },
        image:       { type: 'string', format: 'binary', description: 'Your own icon, under 2 MB.' },
        file:        { type: 'string', format: 'binary', description: 'An attachment, under 25 MB.' },
      }, ['name']),
      responses: {
        201: json({ type: 'object' }), 400: json(ref('Error')),
        409: json(ref('Error'), 'You already have as many links as allowed'),
        413: json(ref('Error'), 'Over your storage allowance'),
      },
    }),
  },
  '/api/my/links/reorder': {
    post: op({
      tag: TAGS.mine, auth: 'user', summary: 'Put your links in order',
      body: jsonBody({ order: { type: 'array', items: { type: 'integer' } } }, ['order']),
      responses: { 200: json({ type: 'object' }), 400: json(ref('Error')) },
    }),
  },
  '/api/my/links/{id}': {
    put: op({
      tag: TAGS.mine, auth: 'user', summary: 'Change one of your links',
      params: [pathParam('id', 'Id of one of your own')],
      body: formBody({
        name:         { type: 'string' },
        url:          { type: 'string' },
        description:  { type: 'string' },
        groups:       { type: 'string' },
        icon_id:      { type: 'integer' },
        image:        { type: 'string', format: 'binary' },
        file:         { type: 'string', format: 'binary' },
        remove_image: { type: 'string', enum: ['1'] },
        remove_file:  { type: 'string', enum: ['1'] },
      }, ['name']),
      responses: {
        200: json({ type: 'object' }), 400: json(ref('Error')), 404: json(ref('Error')),
        413: json(ref('Error'), 'Over your storage allowance'),
      },
    }),
    delete: op({
      tag: TAGS.mine, auth: 'user', summary: 'Delete one of your links',
      description: 'Its files go with it, and the space they used is freed.',
      params: [pathParam('id', 'Id of one of your own')],
      responses: { 200: json({ type: 'object' }), 404: json(ref('Error')) },
    }),
  },
  '/api/my/links/{id}/icon': {
    get: op({
      tag: TAGS.mine, auth: 'user', summary: 'Your link\'s uploaded icon',
      params: [pathParam('id', 'Id of one of your own')],
      responses: { 200: { description: 'The image' }, 404: json(ref('Error')) },
    }),
  },
  '/api/my/links/{id}/favicon': {
    get: op({
      tag: TAGS.mine, auth: 'user', summary: 'Your link\'s fetched favicon',
      params: [pathParam('id', 'Id of one of your own')],
      responses: { 200: { description: 'The image' }, 404: json(ref('Error')) },
    }),
  },
  '/api/my/links/{id}/file': {
    get: op({
      tag: TAGS.mine, auth: 'user', summary: 'Your link\'s attached file',
      description: 'A markdown file is rendered as a page, under the same no-script policy '
                 + 'shared documents use. Add `?raw=1` for the source.',
      params: [pathParam('id', 'Id of one of your own')],
      responses: { 200: { description: 'The file' }, 404: json(ref('Error')) },
    }),
  },

  // ── Analytics & audit ─────────────────────────────────────────────────────
  '/api/stats': {
    get: op({
      tag: TAGS.insight, summary: 'Click totals per link',
      responses: { 200: json(arrayOf('LinkStats')) },
    }),
  },
  '/api/analytics': {
    get: op({
      tag: TAGS.insight,
      summary: 'Aggregated analytics over a period',
      params: [queryParam('days', 'How far back to look', { type: 'integer', default: 30 })],
      responses: { 200: json({ type: 'object' }, 'Daily volume, top links and top visitors') },
    }),
  },
  '/api/audit': {
    get: op({
      tag: TAGS.insight,
      summary: 'Read the audit log',
      params: [
        queryParam('limit',  'How many entries', { type: 'integer' }),
        queryParam('type',   'Filter by entity type'),
        queryParam('search', 'Free-text filter'),
      ],
      responses: { 200: json(arrayOf('AuditEntry')) },
    }),
    delete: op({
      tag: TAGS.insight, summary: 'Clear the audit log',
      responses: { 204: NO_CONTENT },
    }),
  },
  '/api/audit/export': {
    get: op({
      tag: TAGS.insight,
      summary: 'Export the audit log',
      params: [queryParam('format', 'csv or json')],
      responses: {
        200: {
          description: 'The log as a download',
          content: { 'text/csv': { schema: { type: 'string' } }, 'application/json': { schema: { type: 'array', items: ref('AuditEntry') } } },
        },
      },
    }),
  },
  '/api/ip-tags': {
    get: op({
      tag: TAGS.insight, summary: 'List IP attribution tags',
      responses: { 200: json(arrayOf('IpTag')) },
    }),
    post: op({
      tag: TAGS.insight, summary: 'Name an IP address',
      body: jsonBody({ ip_address: { type: 'string' }, tag: { type: 'string' } }, ['ip_address', 'tag']),
      responses: { 200: json(ref('IpTag')), 400: json(ref('Error')) },
    }),
  },
  '/api/ip-tags/{ip}': {
    delete: op({
      tag: TAGS.insight, summary: 'Remove an IP tag',
      params: [pathParam('ip', 'The IP address, URL-encoded', 'string')],
      responses: { 204: NO_CONTENT, 404: json(ref('Error')) },
    }),
  },

  // ── System ────────────────────────────────────────────────────────────────
  '/api/version': {
    get: op({
      tag: TAGS.system,
      summary: 'Installed version, and whether a newer one exists',
      responses: { 200: json({ type: 'object', properties: { current: { type: 'string' }, latest: { type: 'string', nullable: true } } }) },
    }),
  },
  '/api/changelog': {
    get: op({
      tag: TAGS.system, summary: 'Release notes, parsed from CHANGELOG.md',
      responses: { 200: json({ type: 'array', items: { type: 'object' } }) },
    }),
  },
  '/api/markdown/preview': {
    post: op({
      tag: TAGS.system,
      summary: 'Render markdown to HTML',
      description: 'The same renderer a `.md` link is served through, so the editor\'s preview '
                 + 'cannot drift from what a reader sees. Escapes first: raw HTML in the input '
                 + 'comes back as text.',
      body: jsonBody({ text: { type: 'string' } }, ['text']),
      responses: {
        200: json({ type: 'object', properties: { html: { type: 'string' } } }),
        400: json(ref('Error'), 'No text supplied'),
        413: json(ref('Error'), 'Too large to preview'),
      },
    }),
  },
  '/api/openapi.json': {
    get: op({
      tag: TAGS.system,
      summary: 'This document',
      description: 'The OpenAPI description of everything above. Gated like the API it '
                 + 'describes, so a public instance does not hand out a map of its surface.',
      responses: { 200: json({ type: 'object' }, 'An OpenAPI 3 document') },
    }),
  },
  '/api/docs': {
    get: op({
      tag: TAGS.system, auth: 'open',
      summary: 'The Swagger UI',
      description: 'Markup only, like `/admin` — it asks for the token itself and sends it '
                 + 'with every request, including the one that fetches the document. Swagger '
                 + 'UI is served from this instance rather than a CDN, so it works offline.',
      responses: { 200: { description: 'HTML', content: { 'text/html': { schema: { type: 'string' } } } } },
    }),
  },
  '/api/events': {
    get: op({
      tag: TAGS.system, auth: 'open',
      summary: 'Server-sent events stream',
      description: 'Pushes a nudge whenever the data changes, so open pages re-fetch. '
                 + 'Carries no data of its own.',
      responses: { 200: { description: 'An open `text/event-stream`', content: { 'text/event-stream': { schema: { type: 'string' } } } } },
    }),
  },

  // ── Visitor-facing ────────────────────────────────────────────────────────
  '/r/{id}': {
    get: op({
      tag: TAGS.visitor, auth: 'open',
      summary: 'Open a link by id, recording the click',
      description: 'Redirects to the target. A markdown attachment is rendered here instead. '
                 + 'Hidden links and locked groups send a visitor back to `/`.',
      params: [
        pathParam('id', 'Link id'),
        queryParam('theme', 'light or dark, for a rendered markdown page'),
      ],
      responses: {
        200: { description: 'A rendered markdown document', content: { 'text/html': { schema: { type: 'string' } } } },
        302: { description: 'Redirect to the target, or to `/` when not allowed' },
        400: { description: 'The id is not a number' },
        404: { description: 'No such link' },
        429: { description: 'Too many visits from this address' },
      },
    }),
  },
  '/f/{slug}': {
    get: op({
      tag: TAGS.visitor, auth: 'open',
      summary: 'Open a link by its custom URL',
      description: 'Same gate and same click tracking as `/r/{id}`. A file is served here '
                 + 'rather than redirected to, so the slug stays in the address bar, and a '
                 + 'markdown file is rendered as a page.',
      params: [
        pathParam('slug', 'The link\'s custom URL', 'string'),
        queryParam('theme', 'light or dark, matching the site theme'),
        queryParam('embed', 'Set to 1 to drop the page chrome, for showing it in a frame'),
      ],
      responses: {
        200: { description: 'The file, or a rendered markdown page', content: { 'text/html': { schema: { type: 'string' } }, 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
        302: { description: 'Redirect to the target, or to `/` when not allowed' },
        404: { description: 'No link has that slug' },
        429: { description: 'Too many visits from this address' },
      },
    }),
  },
  '/admin': {
    get: op({
      tag: TAGS.visitor, auth: 'open',
      summary: 'The admin single-page app',
      description: 'Serves the shell only. It asks for the token itself and sends it with '
                 + 'every API call from then on.',
      responses: { 200: { description: 'HTML', content: { 'text/html': { schema: { type: 'string' } } } } },
    }),
  },
};

// ─── The document ─────────────────────────────────────────────────────────────

const DESCRIPTION = `
The HTTP API behind LinkPage.

**Authenticating.** Almost everything here needs the admin token in an
\`X-Admin-Token\` header. It is printed to the console when the server starts,
and lives in \`data/admin-token.txt\`. Paste it into **Authorize** above and the
*Try it out* buttons will send it for you.

**What is open.** A handful of routes answer without a token, because the public
page needs them: reading settings and groups, unlocking a protected group,
submitting a link request, and the visitor-facing \`/r/{id}\` and \`/f/{slug}\`.
Listing links is open too, but returns only what that visitor may see.

**Uploads** go as \`multipart/form-data\`. Admin uploads may be up to 100 MB;
anything a visitor sends through a link request is capped at 25 MB and may not
be a type the browser would execute.
`.trim();

/** Builds the document. A function, so the version is read at call time. */
function buildOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title:       'LinkPage API',
      version:     CURRENT_VERSION,
      description: DESCRIPTION,
      license:     { name: 'AGPL-3.0-or-later', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
    },
    servers: [{ url: '/', description: 'This instance' }],
    tags: [
      { name: TAGS.links,    description: 'The cards themselves, and import/export.' },
      { name: TAGS.groups,   description: 'How links are filed, and who may see them.' },
      { name: TAGS.icons,    description: 'Shared images, which own their files on disk.' },
      { name: TAGS.requests, description: 'What visitors ask for, and how it is reviewed.' },
      { name: TAGS.settings, description: 'Branding, theme, and the feature switches.' },
      { name: TAGS.auth,     description: 'Signing in, tokens and passwords.' },
      { name: TAGS.users,    description: 'Accounts, invites and password resets.' },
      { name: TAGS.mine,     description: 'A signed-in member\'s own links, groups and sections.' },
      { name: TAGS.insight,  description: 'Clicks, analytics, the audit log and IP tags.' },
      { name: TAGS.system,   description: 'Version, changelog, markdown rendering and the event stream.' },
      { name: TAGS.visitor,  description: 'The addresses a visitor actually opens.' },
    ],
    paths,
    components: {
      schemas,
      securitySchemes: {
        AdminToken: {
          type: 'apiKey', in: 'header', name: 'X-Admin-Token',
          description: 'The admin token, printed at startup and stored in '
                     + 'data/admin-token.txt. It predates accounts and stays as the way '
                     + 'in when nobody can sign in.',
        },
        SessionCookie: {
          type: 'apiKey', in: 'cookie', name: 'lp_sess',
          description: 'The session cookie set by POST /api/auth/login. HttpOnly, so a '
                     + 'browser sends it automatically and page scripts cannot read it. '
                     + 'State-changing requests carrying it must also come from this origin.',
        },
      },
      responses: {
        Unauthorised: {
          description: 'Not an administrator: no admin token, and no session for an admin account.',
          content: { 'application/json': { schema: ref('Error') } },
        },
        Unauthenticated: {
          description: 'Nobody is signed in.',
          content: { 'application/json': { schema: ref('Error') } },
        },
      },
    },
  };
}

module.exports = { buildOpenApiSpec };
